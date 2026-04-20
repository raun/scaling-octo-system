# Initial Plan: AI-Authored Interactive Coding Education Platform

## Overview

An interactive coding education platform where lessons are **not videos** — they are timestamped streams of editor/terminal events synced to an audio track. Learners watch a teacher's code changes unfold in a real editor while listening to narration. They can pause at any point, edit code, run commands, and resume.

All lessons are **authored automatically by AI**. A topic goes in, a fully playable lesson comes out — no human recording needed.

**Zero-server constraint:** The entire product runs without deploying or managing any servers. The AI authoring pipeline runs **locally as a CLI tool** — you run it on your machine, it generates lesson files (JSON + audio), and you commit them to the repo. The frontend is a **fully static Next.js app** deployed to Vercel (or any static host) that serves these pre-generated lesson files. Code execution for learners happens entirely in the browser (Pyodide for Python, WebContainers for JavaScript). No Docker, no WebSocket servers, no serverless functions, no persistent backend processes. The deployed application has zero API routes.

---

## Part 1: Lesson Data Format

The lesson format is the foundation everything else builds on. It must be expressive enough to represent real coding sessions, but simple enough for an LLM to generate reliably.

### Lesson JSON Schema

```json
{
  "version": 1,
  "id": "lesson-python-list-comprehensions",
  "title": "Python List Comprehensions",
  "language": "python",
  "audio": "lessons/python-list-comprehensions/audio.mp3",
  "totalDuration": 45.6,
  "sections": [
    {
      "id": "section-1",
      "label": "Setting up a simple for loop",
      "startTime": 0,
      "endTime": 12.3,
      "narration": "Let's start by writing a simple for loop that squares each number in a list.",
      "events": [
        {
          "t": 0.5,
          "type": "file_create",
          "path": "main.py",
          "content": ""
        },
        {
          "t": 1.2,
          "type": "edit",
          "path": "main.py",
          "edits": [
            {
              "range": { "startLine": 1, "startCol": 1, "endLine": 1, "endCol": 1 },
              "text": "numbers = [1, 2, 3, 4, 5]"
            }
          ]
        },
        {
          "t": 3.8,
          "type": "edit",
          "path": "main.py",
          "edits": [
            {
              "range": { "startLine": 2, "startCol": 1, "endLine": 2, "endCol": 1 },
              "text": "result = []\nfor n in numbers:\n    result.append(n ** 2)\nprint(result)"
            }
          ]
        },
        {
          "t": 8.0,
          "type": "terminal_input",
          "command": "python main.py"
        },
        {
          "t": 9.2,
          "type": "terminal_output",
          "output": "[1, 4, 9, 16, 25]\n"
        }
      ],
      "checkpoint": {
        "files": {
          "main.py": "numbers = [1, 2, 3, 4, 5]\nresult = []\nfor n in numbers:\n    result.append(n ** 2)\nprint(result)"
        },
        "terminalHistory": "$ python main.py\n[1, 4, 9, 16, 25]\n"
      }
    },
    {
      "id": "section-2",
      "label": "Converting to a list comprehension",
      "startTime": 12.3,
      "endTime": 25.0,
      "narration": "Now let's convert this for loop into a single-line list comprehension. We'll replace lines 2 through 4 with one expression.",
      "events": [
        {
          "t": 14.0,
          "type": "edit",
          "path": "main.py",
          "edits": [
            {
              "range": { "startLine": 2, "startCol": 1, "endLine": 4, "endCol": 28 },
              "text": "result = [n ** 2 for n in numbers]"
            }
          ]
        },
        {
          "t": 19.0,
          "type": "terminal_input",
          "command": "python main.py"
        },
        {
          "t": 20.2,
          "type": "terminal_output",
          "output": "[1, 4, 9, 16, 25]\n"
        }
      ],
      "checkpoint": {
        "files": {
          "main.py": "numbers = [1, 2, 3, 4, 5]\nresult = [n ** 2 for n in numbers]\nprint(result)"
        },
        "terminalHistory": "$ python main.py\n[1, 4, 9, 16, 25]\n"
      }
    }
  ]
}
```

### Key Design Decisions in the Format

1. **Timestamps are relative to audio start (in seconds).** Every event has a `t` field. The playback engine compares `audio.currentTime` to event timestamps.

2. **Edits use Monaco-compatible ranges.** `startLine`, `startCol`, `endLine`, `endCol` map directly to Monaco's `IRange` interface. This means the playback engine can call `editor.executeEdits()` directly with the event data — no transformation needed.

3. **Every section has a checkpoint.** A checkpoint is a full snapshot of every file's content and the terminal history at the end of that section. Checkpoints serve three purposes:
   - **Seeking**: Jump to any section without replaying from the start.
   - **Resume after learner interaction**: When the learner pauses, edits code, then resumes, the system resets to the next checkpoint.
   - **Validation**: During authoring, the checkpoint is the expected state — if executing the events doesn't produce this state, something is wrong.

4. **`terminal_input` and `terminal_output` are separate events.** During playback, input is "typed" into the terminal and output appears after a natural delay. During learner interaction, real execution replaces these.

5. **`version: 1` is present from day one.** The schema will evolve. Version it now.

### File Structure on Disk / Storage

```
lessons/
  python-list-comprehensions/
    lesson.json          # The event timeline
    audio.mp3            # Stitched narration audio
    metadata.json        # Title, description, tags, difficulty, estimated time
  python-decorators/
    lesson.json
    audio.mp3
    metadata.json
```

**Storage — static files in the repo:**

All lessons live in `public/lessons/` in the git repository. The authoring CLI writes directly there. When you deploy (e.g., `git push` → Vercel auto-deploys), lessons are served as static files alongside the app. No database, no object storage, no API to fetch lessons.

A `public/lessons/index.json` manifest file lists all available lessons (title, description, tags, language, difficulty). The app reads this at build time or on page load to render the catalog. The CLI updates this manifest whenever it generates a new lesson.

At large scale (500+ lessons, audio files pushing git repo size), move `public/lessons/` to Git LFS or a CDN. But start simple — a repo with 50 lessons (~50 JSON files + 50 audio files) is well under 1GB.

---

## Part 2: Playback Engine

The playback engine is the core of the learner experience. It syncs audio playback with editor/terminal events and handles the pause/resume/interact flow.

### Components

```
┌─────────────────────────────────────────────────────┐
│  Lesson Player (React component)                     │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  File Explorer │  │ Monaco Editor │  │  Terminal   │ │
│  │  (tree view)   │  │ (main panel)  │  │  (xterm.js) │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Playback Controls                                │ │
│  │  [Play/Pause] [Seek bar] [Section markers] [Speed]│ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │  Playback Controller (not visible)                │ │
│  │  - Manages audio element                          │ │
│  │  - Maintains event cursor (index into events[])   │ │
│  │  - Dispatches events to editor/terminal           │ │
│  │  - Handles pause/resume/seek state machine        │ │
│  └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Playback Controller Logic

```typescript
// Pseudocode for the core playback loop

class PlaybackController {
  private audio: HTMLAudioElement;
  private events: LessonEvent[];
  private cursor: number = 0;  // index of next event to apply
  private state: 'playing' | 'paused' | 'interactive';
  private editor: monaco.editor.IStandaloneCodeEditor;
  private terminal: Terminal;  // xterm.js

  // Called on every audio timeupdate (~4x per second) and via requestAnimationFrame
  tick() {
    if (this.state !== 'playing') return;
    const currentTime = this.audio.currentTime;

    // Apply all events up to the current audio time
    while (this.cursor < this.events.length && this.events[this.cursor].t <= currentTime) {
      this.applyEvent(this.events[this.cursor]);
      this.cursor++;
    }
  }

  applyEvent(event: LessonEvent) {
    switch (event.type) {
      case 'file_create':
        this.fileSystem.createFile(event.path, event.content);
        this.fileExplorer.refresh();
        break;
      case 'edit':
        // Switch to the right file tab if needed
        this.openFile(event.path);
        // Apply edits using Monaco's built-in edit API
        this.editor.executeEdits('playback', event.edits.map(e => ({
          range: new monaco.Range(e.range.startLine, e.range.startCol, e.range.endLine, e.range.endCol),
          text: e.text
        })));
        break;
      case 'terminal_input':
        // "Type" the command character by character for visual effect
        this.terminal.write(`$ ${event.command}\r\n`);
        break;
      case 'terminal_output':
        this.terminal.write(event.output);
        break;
    }
  }

  pause() {
    this.audio.pause();
    this.state = 'paused';
    // Editor and terminal are now interactive
    // Editor: remove readOnly flag
    // Terminal: connect to sandbox backend
    this.editor.updateOptions({ readOnly: false });
    this.sandbox.connect(this.terminal);
    this.state = 'interactive';
  }

  resume() {
    // Find the next checkpoint (start of next section)
    const nextSection = this.findNextSection(this.audio.currentTime);
    if (nextSection?.checkpoint) {
      // Restore the checkpoint state
      this.restoreCheckpoint(nextSection.checkpoint);
    }
    // Disconnect sandbox, make editor read-only again
    this.sandbox.disconnect();
    this.editor.updateOptions({ readOnly: true });
    // Resume audio
    this.state = 'playing';
    this.audio.play();
  }

  seekToSection(sectionId: string) {
    const section = this.sections.find(s => s.id === sectionId);
    // Restore checkpoint of the PREVIOUS section (the starting state for this one)
    const prevCheckpoint = this.getPreviousSectionCheckpoint(sectionId);
    if (prevCheckpoint) {
      this.restoreCheckpoint(prevCheckpoint);
    }
    // Set audio position and cursor
    this.audio.currentTime = section.startTime;
    this.cursor = this.events.findIndex(e => e.t >= section.startTime);
    this.state = 'playing';
    this.audio.play();
  }
}
```

### Virtual File System

The editor and file explorer operate on an in-memory virtual file system:

```typescript
class VirtualFileSystem {
  private files: Map<string, string> = new Map();

  createFile(path: string, content: string) { this.files.set(path, content); }
  readFile(path: string): string { return this.files.get(path) ?? ''; }
  updateFile(path: string, content: string) { this.files.set(path, content); }
  deleteFile(path: string) { this.files.delete(path); }
  listFiles(): string[] { return Array.from(this.files.keys()); }

  // Restore from a checkpoint snapshot
  restoreFromCheckpoint(files: Record<string, string>) {
    this.files.clear();
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, content);
    }
  }
}
```

During playback, the VFS is the source of truth. When the learner pauses and edits, changes go into the VFS. When they resume, the VFS is reset from the next checkpoint.

### File Explorer

A simple tree component that renders the VFS contents. It needs to:
- Show files and folders in a tree structure
- Highlight the currently active file
- Allow clicking to switch files in the editor
- Update reactively when the VFS changes (file_create events)

No library needed — this is a small recursive React component rendering the VFS file list as a tree.

### Editor Setup

Monaco Editor configuration:

```typescript
// Key Monaco setup
const editor = monaco.editor.create(container, {
  language: 'python',  // or 'javascript', from lesson.language
  theme: 'vs-dark',
  readOnly: true,       // Read-only during playback, writable when paused
  minimap: { enabled: false },
  automaticLayout: true,
  fontSize: 14,
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
});

// Multi-file support via Monaco models
function openFile(path: string, content: string) {
  const uri = monaco.Uri.parse(`file:///${path}`);
  let model = monaco.editor.getModel(uri);
  if (!model) {
    model = monaco.editor.createModel(content, detectLanguage(path), uri);
  }
  editor.setModel(model);
}
```

### Terminal Setup

xterm.js configuration:

```typescript
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  theme: { background: '#1e1e1e' },
});
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(container);
fitAddon.fit();

// During playback: terminal is display-only (just receives writes from playback controller)
// During interaction: terminal is connected to sandbox backend via WebSocket
```

---

## Part 3: AI Authoring Pipeline — Multi-Agent System

This is the system that takes a topic and produces a complete lesson (JSON + audio) without human involvement. It is implemented as a **multi-agent system** where each agent has a specialized role, and a **Lead Agent** orchestrates the entire process.

### Agent Roles

| Agent | Role | LLM Persona | Input | Output |
|---|---|---|---|---|
| **Lead Agent** | Orchestrator — manages workflow, routes data between agents, handles retries and escalation | Project manager with full pipeline visibility | Topic + constraints | Final lesson package |
| **Planner Agent** | Designs the lesson outline — sections, objectives, code approach | Expert curriculum designer | Topic, language, difficulty | Lesson plan JSON |
| **Plan Reviewer Agent** | Reviews the Planner's outline for pedagogical quality, pacing, and completeness | Senior educator / instructional designer | Lesson plan JSON | Approval or structured feedback |
| **Scripter Agent** | Generates code events and narration for each section (two-pass) | Expert programming instructor | Approved lesson plan | Sections with events + narration |
| **Script Reviewer Agent** | Reviews Scripter output for clarity, narration-code sync, and teachability | QA editor with coding + teaching expertise | Scripted sections | Approval or structured feedback |
| **Validator Agent** | Runs code in a sandbox to verify correctness, captures real output | Automated (not LLM-driven, except for fix retries) | Scripted sections | Validated sections with real output |
| **Assembler Agent** | Stitches audio, assigns timestamps, produces final lesson.json + audio.mp3 | Automated (ffmpeg + timestamp logic) | Validated sections + audio clips | Assembled lesson package |
| **Final Reviewer Agent** | Reviews the complete assembled lesson end-to-end for quality sign-off | Senior content reviewer | Complete lesson.json + audio.mp3 | Approval or structured feedback |

### Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          LEAD AGENT (Orchestrator)                            │
│                                                                                │
│  Input: "Python list comprehensions"                                          │
│                                                                                │
│  ┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌───────────────┐       │
│  │ 1.Planner │───▶│ 2.Plan       │───▶│3.Scripter│───▶│ 4.Script      │       │
│  │   Agent   │◀───│   Reviewer   │    │  Agent   │◀───│   Reviewer    │       │
│  │           │    │   Agent      │    │          │    │   Agent       │       │
│  └──────────┘    └──────────────┘    └──────────┘    └───────────────┘       │
│       ▲            feedback loop          ▲            feedback loop          │
│       │            until approved          │            until approved          │
│       │                                    │                                    │
│       │                                    ▼                                    │
│       │                              ┌───────────┐                             │
│       │                              │ 5.Validator│                             │
│       │                              │   Agent    │                             │
│       │                              └─────┬─────┘                             │
│       │                                    │                                    │
│       │                              ┌─────┴──────┐                            │
│       │                              │  5b. TTS    │                            │
│       │                              │ (ElevenLabs)│                            │
│       │                              └─────┬──────┘                            │
│       │                                    │                                    │
│       │                              ┌─────┴──────┐    ┌───────────────┐       │
│       │                              │ 6.Assembler │───▶│ 7.Final       │       │
│       │                              │   Agent     │◀───│   Reviewer    │       │
│       │                              └─────────────┘    │   Agent       │       │
│       │                                                  └───────────────┘       │
│       │                                                    │                     │
│       │                 feedback loop until approved        │                     │
│       │                 (can send back to ANY prior stage)  │                     │
│       │◄───────────────────────────────────────────────────┘                     │
│                                                                                  │
│  Output: lesson.json + audio.mp3 (approved)                                     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Step 1: Planner

The Planner takes a topic and generates a structured lesson outline. This is a single LLM call with structured output.

**Input:** Topic string + optional constraints (difficulty level, target duration, language)

**Prompt strategy:**
```
You are an expert programming instructor. Given a topic, create a lesson outline
that teaches the concept through progressive code examples.

Topic: {topic}
Language: {language}
Target duration: {duration} minutes
Difficulty: {difficulty}

Output a JSON lesson plan with this structure:
{
  "title": "Human-readable lesson title",
  "description": "One paragraph describing what the learner will understand after this lesson",
  "prerequisites": ["topics the learner should know"],
  "sections": [
    {
      "label": "Section title",
      "objective": "What the learner will understand after this section",
      "approach": "Brief description: what code to write, what to demonstrate",
      "builds_on_previous": true/false
    }
  ]
}

Rules:
- Start with the simplest possible example. Build complexity gradually.
- Each section should have ONE key concept. Do not combine multiple ideas.
- Always show the "wrong" or "verbose" way first, then improve it. This builds intuition.
- Include a section that shows a common mistake or gotcha.
- 3-6 sections total. Each section should be 15-45 seconds of narration.
- The final section should be a slightly more complex, real-world-ish example.
```

**Output:** Lesson plan JSON that feeds into the Plan Reviewer.

### Lead Agent (Orchestrator)

The Lead Agent is the central coordinator of the entire pipeline. It does not generate content itself — it manages the flow of data between agents, handles review feedback loops, and makes escalation decisions.

**Implementation:**

```typescript
class LeadAgent {
  private planner: PlannerAgent;
  private planReviewer: PlanReviewerAgent;
  private scripter: ScripterAgent;
  private scriptReviewer: ScriptReviewerAgent;
  private validator: ValidatorAgent;
  private tts: TTSService;
  private assembler: AssemblerAgent;
  private finalReviewer: FinalReviewerAgent;

  async generateLesson(topic: string, options: LessonOptions): Promise<LessonPackage> {
    const runId = generateRunId();
    const log = createPipelineLog(runId);

    // Phase 1: Plan with review loop
    log.phase('planning');
    const approvedPlan = await this.planWithReview(topic, options, log);

    // Phase 2: Script with review loop
    log.phase('scripting');
    const approvedScript = await this.scriptWithReview(approvedPlan, log);

    // Phase 3: Validate code (automated)
    log.phase('validation');
    const validatedSections = await this.validateAllSections(approvedScript, options.language, log);

    // Phase 4: Generate audio
    log.phase('tts');
    const audioClips = await this.generateAudio(validatedSections, log);

    // Phase 5: Assemble with final review loop
    log.phase('assembly');
    const lessonPackage = await this.assembleWithReview(
      approvedPlan, validatedSections, audioClips, log
    );

    log.complete(lessonPackage);
    return lessonPackage;
  }

  private async planWithReview(
    topic: string, options: LessonOptions, log: PipelineLog
  ): Promise<ApprovedPlan> {
    let plan = await this.planner.generatePlan(topic, options);
    
    for (let round = 0; round < 3; round++) {
      log.reviewRound('plan', round);
      const review = await this.planReviewer.review(plan, topic, options);
      
      if (review.approved) {
        log.approved('plan', round);
        return { plan, reviewNotes: review.notes };
      }

      log.revisionRequested('plan', round, review.feedback);
      plan = await this.planner.revise(plan, review.feedback);
    }

    // After 3 rounds, escalate — publish with warnings or halt
    throw new PipelineError('Plan failed review after 3 rounds', { plan, topic });
  }

  private async scriptWithReview(
    approvedPlan: ApprovedPlan, log: PipelineLog
  ): Promise<ApprovedScript> {
    let script = await this.scripter.generateScript(approvedPlan.plan);
    
    for (let round = 0; round < 3; round++) {
      log.reviewRound('script', round);
      const review = await this.scriptReviewer.review(script, approvedPlan.plan);
      
      if (review.approved) {
        log.approved('script', round);
        return { script, reviewNotes: review.notes };
      }

      log.revisionRequested('script', round, review.feedback);
      script = await this.scripter.revise(script, review.feedback);
    }

    throw new PipelineError('Script failed review after 3 rounds', { script });
  }

  private async assembleWithReview(
    plan: ApprovedPlan,
    sections: ValidatedSection[],
    audioClips: AudioClip[],
    log: PipelineLog
  ): Promise<LessonPackage> {
    let lesson = await this.assembler.assemble(plan.plan, sections, audioClips);
    
    for (let round = 0; round < 2; round++) {
      log.reviewRound('final', round);
      const review = await this.finalReviewer.review(lesson);
      
      if (review.approved) {
        log.approved('final', round);
        return lesson;
      }

      // Final reviewer can send feedback to ANY prior stage
      // The Lead Agent decides where to route it
      const routeTo = this.routeFeedback(review.feedback);
      log.rerouting('final', routeTo.stage, review.feedback);

      if (routeTo.stage === 'plan') {
        // Nuclear option: start over from planning
        throw new PipelineError('Final review requires re-planning', {
          feedback: review.feedback,
          lesson,
        });
      } else if (routeTo.stage === 'script') {
        // Re-script, re-validate, re-assemble
        const revisedScript = await this.scripter.revise(
          { sections }, review.feedback
        );
        const revalidated = await this.validateAllSections(
          { script: revisedScript }, plan.plan.language, log
        );
        const newAudio = await this.generateAudio(revalidated, log);
        lesson = await this.assembler.assemble(plan.plan, revalidated, newAudio);
      } else {
        // Assembly-level fix (timing, pacing)
        lesson = await this.assembler.revise(lesson, review.feedback);
      }
    }

    throw new PipelineError('Lesson failed final review', { lesson });
  }

  private routeFeedback(feedback: ReviewFeedback): { stage: 'plan' | 'script' | 'assembly' } {
    // Analyze feedback to determine which stage needs revision
    // "sections are in wrong order" → plan
    // "narration doesn't match code on line 5" → script
    // "pacing feels rushed in section 3" → assembly
    if (feedback.categories.includes('structure') || feedback.categories.includes('curriculum')) {
      return { stage: 'plan' };
    }
    if (feedback.categories.includes('code') || feedback.categories.includes('narration')) {
      return { stage: 'script' };
    }
    return { stage: 'assembly' };
  }
}
```

**Key orchestration decisions the Lead Agent makes:**
1. **When to stop review loops.** Max 3 rounds for plan/script, 2 for final. After that, escalate rather than loop forever.
2. **Where to route final review feedback.** The Final Reviewer might say "the code in section 2 is wrong" — that goes back to Scripter, not Assembler. The Lead Agent parses feedback categories to decide.
3. **Pipeline logging.** Every agent call, every review round, every revision is logged with timestamps. This creates an audit trail for debugging bad lessons and tuning prompts.

### Step 1b: Plan Reviewer Agent

The Plan Reviewer evaluates the Planner's output before any code is generated. This is the cheapest place to catch structural problems — fixing a bad outline is much cheaper than fixing a bad script.

**Review criteria (encoded in the reviewer's system prompt):**

```
You are a senior instructional designer reviewing a lesson outline.
Evaluate the plan against these criteria and provide structured feedback.

## Criteria

1. LEARNING PROGRESSION: Does each section build logically on the previous?
   - Is the first section simple enough for the target difficulty level?
   - Are there any conceptual jumps that are too large between sections?
   - Does the final section bring everything together?

2. SCOPE: Is the lesson appropriately scoped?
   - Is it trying to cover too many concepts? (max 1 concept per section)
   - Are there unnecessary tangents?
   - Can it be completed in the target duration?

3. PEDAGOGY: Does it follow good teaching practices?
   - Does it show the "before" (verbose/wrong way) before the "after" (better way)?
   - Does it include concrete, runnable examples (not abstract explanations)?
   - Is there a section covering a common mistake or gotcha?

4. COMPLETENESS: Does the outline cover what a learner would expect?
   - Are any critical sub-topics missing for this concept?
   - Would a learner feel the lesson was "complete" or "cut short"?

5. CODE FEASIBILITY: Can each section's described approach actually be implemented?
   - Are the described code examples realistic for the language?
   - Can each section be demonstrated in 15-45 seconds of narration?

## Output Format

{
  "approved": true/false,
  "score": {
    "learning_progression": 1-5,
    "scope": 1-5,
    "pedagogy": 1-5,
    "completeness": 1-5,
    "code_feasibility": 1-5
  },
  "feedback": [
    {
      "section": "section index or 'overall'",
      "category": "progression|scope|pedagogy|completeness|feasibility",
      "severity": "blocker|suggestion",
      "issue": "what's wrong",
      "recommendation": "how to fix it"
    }
  ],
  "notes": "optional overall comments"
}

Rules:
- Approve if there are no blockers (suggestions alone don't block).
- A score below 3 in any category is an automatic blocker.
- Be specific in recommendations — "make section 2 simpler" is not helpful,
  "split section 2 into two parts: first show X, then show Y" is.
```

**Planner revision prompt (when feedback is received):**

```
Your lesson plan received the following feedback from a reviewer.
Revise the plan to address all blocker issues.

Original plan: {plan JSON}
Feedback: {reviewer feedback JSON}

Rules:
- Address every item with severity "blocker". You may ignore "suggestion" items.
- Keep the same JSON structure.
- Do not add more than 6 sections total.
- Explain what you changed and why in a "revision_notes" field.
```

### Step 2: Scripter Agent

The Scripter is the most important and most complex step. It generates both the narration text and the code events for each section. This is where lesson quality lives or dies.

**Two-pass generation (critical for correctness):**

**Pass 1: Generate code progression**
```
Given this lesson plan, generate the code for each section.
For each section, provide:
1. The starting state of all files (or "same as previous section end")
2. The sequence of edits to make, as incremental changes
3. Any terminal commands to run and their expected output
4. The ending state of all files (checkpoint)

Rules:
- Edits must be INCREMENTAL. Do not replace entire files. Add/change/remove specific lines.
- Each edit should be small enough to follow while listening. Max 3-4 lines per edit.
- If a section builds on the previous, start from the previous section's checkpoint.
- Terminal commands must be valid. Expected output must be realistic.
- Use print statements / console.log liberally — learners need to SEE output.
```

**Pass 2: Generate narration that references the code**
```
Given this code progression, write narration for each section.
You will see the exact code and line numbers. Your narration must reference them accurately.

Rules:
- Narration should EXPLAIN, not just describe. "We're using a list comprehension here
  because it's more readable AND faster than a for loop" > "Now we write a list comprehension."
- Reference specific line numbers when pointing things out: "Notice on line 3, we..."
- Keep each section's narration to 2-4 sentences. Concise and clear.
- Use a conversational, encouraging tone. Not academic.
- Avoid filler: "Let's go ahead and...", "What we're going to do is..."
- Start each section by connecting it to the previous: "Now that we have the basic loop..."
```

**Why two passes instead of one?** Generating code and narration together leads to inconsistencies — the narration says "line 5" but the code is on line 3, or the narration describes code that doesn't match the events. By generating code first and narration second (with the code visible), the LLM can reference specific lines accurately.

**Output format from the Scripter:**

```json
{
  "sections": [
    {
      "id": "section-1",
      "label": "Setting up a simple for loop",
      "narration": "Let's start by creating a list of numbers and writing a for loop to square each one. This is the approach most beginners learn first.",
      "events": [
        { "type": "file_create", "path": "main.py", "content": "" },
        {
          "type": "edit",
          "path": "main.py",
          "edits": [
            {
              "range": { "startLine": 1, "startCol": 1, "endLine": 1, "endCol": 1 },
              "text": "numbers = [1, 2, 3, 4, 5]"
            }
          ]
        },
        {
          "type": "edit",
          "path": "main.py",
          "edits": [
            {
              "range": { "startLine": 2, "startCol": 1, "endLine": 2, "endCol": 1 },
              "text": "result = []\nfor n in numbers:\n    result.append(n ** 2)\nprint(result)"
            }
          ]
        },
        { "type": "terminal_input", "command": "python main.py" },
        { "type": "terminal_output", "output": "[1, 4, 9, 16, 25]\n" }
      ],
      "checkpoint": {
        "files": {
          "main.py": "numbers = [1, 2, 3, 4, 5]\nresult = []\nfor n in numbers:\n    result.append(n ** 2)\nprint(result)"
        }
      }
    }
  ]
}
```

### Step 2b: Script Reviewer Agent

The Script Reviewer examines the Scripter's output — both code events and narration — for quality, correctness, and sync. This catches issues before expensive validation (sandbox execution) and TTS (audio generation) steps.

**Review criteria (encoded in the reviewer's system prompt):**

```
You are a QA editor reviewing a scripted coding lesson. You have both coding
expertise and teaching experience. You are reviewing the raw script BEFORE
code execution and audio generation, so this is the cheapest place to catch problems.

## You receive:
- The approved lesson plan (for context on intent)
- The scripted sections (code events + narration for each section)

## Criteria

1. CODE-NARRATION SYNC: Does the narration accurately describe what's happening in the code?
   - If narration says "on line 3", is the relevant code actually on line 3?
   - If narration says "we add a for loop", does the next edit event add a for loop?
   - Does the narration reference variables/functions by their actual names in the code?
   - Are there any edit events that happen with NO corresponding narration explanation?

2. INCREMENTAL EDITS: Are code changes appropriately sized?
   - Each edit should be 1-4 lines. Larger edits are hard to follow during playback.
   - No edit should silently replace large blocks of code without narration explaining why.
   - Edits should be ordered logically (top-to-bottom within a section, unless there's a reason).

3. NARRATION QUALITY: Is the narration clear, concise, and educational?
   - Does it EXPLAIN why, not just describe what?
   - Is it free of filler phrases ("Let's go ahead and...", "What we're going to do is...")?
   - Does each section connect to the previous one?
   - Is the tone conversational and encouraging, not academic?

4. CODE QUALITY: Does the code look correct (pre-execution check)?
   - Are there obvious syntax errors?
   - Do variable names match across edits within a section?
   - Do imports appear before they're used?
   - Does the checkpoint state match what the edits would produce?

5. CHECKPOINT CONSISTENCY: Do checkpoints match the cumulative edits?
   - Apply all edits in order mentally — does the result match the checkpoint files?
   - Does each section's starting state match the previous section's checkpoint?

## Output Format

{
  "approved": true/false,
  "issues": [
    {
      "section_id": "section-1",
      "category": "sync|edits|narration|code|checkpoint",
      "severity": "blocker|warning|suggestion",
      "location": "narration|event[2]|checkpoint",
      "issue": "Narration says 'notice line 5' but the relevant code is on line 3",
      "recommendation": "Change narration to reference line 3, or restructure edits so the code lands on line 5"
    }
  ],
  "notes": "optional overall comments"
}

Rules:
- Approve if there are no blockers. Warnings are noted but don't block.
- Any code-narration sync issue is an automatic blocker.
- Any checkpoint inconsistency is an automatic blocker.
- Be precise: reference exact section IDs, event indices, and line numbers.
```

**Scripter revision prompt (when feedback is received):**

```
Your scripted lesson received the following feedback from a reviewer.
Revise the script to address all blocker and warning issues.

Original script: {script JSON}
Feedback: {reviewer feedback JSON}

Rules:
- Address every "blocker" issue. Address "warning" issues if the fix is straightforward.
- When fixing code-narration sync, prefer adjusting narration to match code
  (changing code risks breaking the progression).
- When fixing checkpoint inconsistency, recompute the checkpoint from the edits.
- Keep the same section structure unless the reviewer explicitly says to restructure.
- Include a "revision_notes" field explaining what you changed.
```

### Step 3a: TTS (Text-to-Speech)

Convert each section's narration text into an audio clip.

**Implementation:**

```typescript
import ElevenLabs from 'elevenlabs';  // or OpenAI TTS

async function generateSectionAudio(
  narration: string,
  voiceId: string
): Promise<{ buffer: Buffer; durationSeconds: number }> {
  const client = new ElevenLabs({ apiKey: process.env.ELEVENLABS_API_KEY });

  const audioBuffer = await client.textToSpeech.convert(voiceId, {
    text: narration,
    model_id: 'eleven_multilingual_v2',
    output_format: 'mp3_44100_128',
  });

  // Get duration using ffprobe
  const duration = await getAudioDuration(audioBuffer);  // ffprobe wrapper

  return { buffer: audioBuffer, durationSeconds: duration };
}
```

**Voice selection:** Pick ONE consistent voice for all lessons. Use ElevenLabs for quality or OpenAI TTS for simplicity/cost. Store the voice ID in config so all lessons sound the same.

**TTS provider comparison:**

| Provider | Quality | Cost | Latency | Notes |
|---|---|---|---|---|
| ElevenLabs | Best | ~$0.30/1K chars | Medium | Best for natural-sounding instruction |
| OpenAI TTS | Good | ~$0.015/1K chars | Fast | 20x cheaper, slightly robotic |
| Google Cloud TTS | Good | ~$0.016/1K chars | Fast | Many voice options |

For a lesson with ~500 words of narration (~2500 chars), ElevenLabs costs ~$0.75 and OpenAI costs ~$0.04. At scale, OpenAI TTS is likely the better default unless voice quality is a key differentiator.

### Step 3b: Validator

Run every code step in a cloud sandbox to verify correctness and capture actual terminal output. Since we deploy no servers, we use **E2B** (e2b.dev) — an API that spins up ephemeral cloud sandboxes on demand. No Docker, no infrastructure to manage. You make an API call, get a sandbox, run code, get output, sandbox auto-destroys.

**Why E2B instead of Docker:**
- No server to deploy or maintain
- Sandboxes are API calls — works from a local CLI, serverless function, or CI pipeline
- Supports Python, Node, and other runtimes out of the box
- Sandboxes are ephemeral and isolated (security built in)
- Pay-per-use (~$0.10/hour of sandbox time, lessons need seconds)

**Implementation:**

```typescript
import { Sandbox } from '@e2b/code-interpreter';

async function validateSection(
  section: LessonSection,
  language: string,
  previousCheckpoint: Checkpoint | null
): Promise<{ valid: boolean; correctedEvents: LessonEvent[]; actualOutputs: Map<string, string> }> {

  // Spin up an E2B cloud sandbox (no server needed — it's an API call)
  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
  });

  try {
    // If building on a previous section, restore that checkpoint
    if (previousCheckpoint) {
      for (const [path, content] of Object.entries(previousCheckpoint.files)) {
        await sandbox.files.write(path, content);
      }
    }

    // Walk through events, applying edits and running commands
    const actualOutputs = new Map<string, string>();
    let fileStates = new Map<string, string>(
      previousCheckpoint ? Object.entries(previousCheckpoint.files) : []
    );

    for (const event of section.events) {
      if (event.type === 'file_create') {
        await sandbox.files.write(event.path, event.content);
        fileStates.set(event.path, event.content);
      }
      else if (event.type === 'edit') {
        const currentContent = fileStates.get(event.path) ?? '';
        const newContent = applyEdits(currentContent, event.edits);
        fileStates.set(event.path, newContent);
        await sandbox.files.write(event.path, newContent);
      }
      else if (event.type === 'terminal_input') {
        const result = await sandbox.commands.run(event.command, { timeout: 10000 });
        actualOutputs.set(event.command, result.stdout + result.stderr);

        if (result.exitCode !== 0) {
          return { valid: false, correctedEvents: section.events, actualOutputs };
        }
      }
    }

    // Replace expected terminal_output events with actual output
    const correctedEvents = section.events.map(event => {
      if (event.type === 'terminal_output') {
        const inputEvent = findPrecedingInput(section.events, event);
        const actualOutput = actualOutputs.get(inputEvent.command);
        return { ...event, output: actualOutput ?? event.output };
      }
      return event;
    });

    return { valid: true, correctedEvents, actualOutputs };
  } finally {
    await sandbox.kill();  // Always clean up
  }
}
```

**Retry loop when validation fails:**

```typescript
async function validateWithRetry(
  section: LessonSection,
  language: string,
  previousCheckpoint: Checkpoint | null,
  maxRetries: number = 3
): Promise<LessonSection> {

  let currentSection = section;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await validateSection(currentSection, language, previousCheckpoint);

    if (result.valid) {
      return { ...currentSection, events: result.correctedEvents };
    }

    // Send error back to LLM for correction
    const correctedSection = await llmFixCode({
      section: currentSection,
      errors: result.actualOutputs,
      attempt: attempt + 1,
    });

    currentSection = correctedSection;
  }

  throw new Error(`Section "${section.label}" failed validation after ${maxRetries} attempts`);
}
```

**LLM fix prompt:**
```
The following section's code failed validation.

Section: {section.label}
Events: {section.events as JSON}
Error output: {error output}

Fix the code events so they produce the expected behavior. Keep the same
structure and teaching approach — only fix the broken code. Also update the
narration if it references specific output that changed.
```

### Step 4: Assembler

The Assembler takes all the pieces and produces the final lesson.json + audio.mp3.

**Implementation:**

```typescript
async function assemblelesson(
  plan: LessonPlan,
  validatedSections: ValidatedSection[],  // sections with corrected events
  audioClips: AudioClip[]                  // { buffer, durationSeconds } per section
): Promise<{ lessonJson: LessonJson; audioBuffer: Buffer }> {

  // 1. Concatenate audio clips into one file
  //    Add 0.5s silence between sections for natural pacing
  const silenceGap = 0.5;
  const concatenatedAudio = await concatenateAudio(audioClips, silenceGap);

  // 2. Calculate timestamps for each section
  let currentTime = 0;
  const timedSections = validatedSections.map((section, i) => {
    const startTime = currentTime;
    const duration = audioClips[i].durationSeconds;
    const endTime = startTime + duration;

    // Distribute events evenly across the section's time window
    // But with smarts: edits should happen slightly AFTER the narration mentions them
    const timedEvents = distributeEvents(section.events, startTime, endTime);

    currentTime = endTime + silenceGap;

    return {
      ...section,
      startTime,
      endTime,
      events: timedEvents,
    };
  });

  // 3. Build the lesson JSON
  const lessonJson: LessonJson = {
    version: 1,
    id: generateLessonId(plan.title),
    title: plan.title,
    language: plan.language,
    audio: `audio.mp3`,
    totalDuration: currentTime - silenceGap,  // subtract last gap
    sections: timedSections,
  };

  return { lessonJson, audioBuffer: concatenatedAudio };
}
```

**Event timing distribution logic:**

```typescript
function distributeEvents(
  events: LessonEvent[],
  startTime: number,
  endTime: number
): LessonEvent[] {
  const duration = endTime - startTime;
  const editEvents = events.filter(e => e.type === 'edit' || e.type === 'file_create');
  const terminalEvents = events.filter(e => e.type === 'terminal_input' || e.type === 'terminal_output');

  // Edits happen in the first 70% of the section (while narration explains)
  // Terminal commands happen in the last 30% (after the explanation)
  const editWindow = { start: startTime + 0.5, end: startTime + duration * 0.7 };
  const terminalWindow = { start: startTime + duration * 0.7, end: endTime - 0.3 };

  let timed: LessonEvent[] = [];

  // Spread edits evenly across edit window
  editEvents.forEach((event, i) => {
    const t = editWindow.start + (editWindow.end - editWindow.start) * (i / Math.max(editEvents.length - 1, 1));
    timed.push({ ...event, t: Math.round(t * 10) / 10 });
  });

  // Spread terminal events across terminal window
  // terminal_input and terminal_output should be ~1s apart
  terminalEvents.forEach((event, i) => {
    const t = terminalWindow.start + (terminalWindow.end - terminalWindow.start) * (i / Math.max(terminalEvents.length - 1, 1));
    timed.push({ ...event, t: Math.round(t * 10) / 10 });
  });

  // Sort by timestamp
  return timed.sort((a, b) => a.t - b.t);
}
```

**Audio concatenation (no ffmpeg dependency):**

Since we can't rely on ffmpeg being installed (serverless / local CLI), we have two options:

**Option A: Keep audio as separate clips (simplest, recommended)**

Don't concatenate at all. Store individual audio clips per section and let the browser play them sequentially:

```json
{
  "sections": [
    { "id": "section-1", "audio": "section-1.mp3", "audioDuration": 12.3, ... },
    { "id": "section-2", "audio": "section-2.mp3", "audioDuration": 8.7, ... }
  ]
}
```

The PlaybackController manages gapless playback between clips using the Web Audio API or by pre-loading the next clip while the current one plays. This is simpler, avoids any server-side audio processing, and makes seeking instant (jump to the right clip).

**Option B: Concatenate using a JS audio library**

If a single audio file is preferred, use a pure-JS MP3 encoder:

```typescript
import { Mp3Encoder } from 'lamejs';  // Pure JS, no native dependencies

async function concatenateAudio(clips: AudioClip[], gapSeconds: number): Promise<Buffer> {
  // Decode each MP3 clip to PCM using Web Audio API or audiobuffer-to-wav
  const pcmChunks: Float32Array[] = [];

  for (let i = 0; i < clips.length; i++) {
    const pcm = await decodeMp3ToPCM(clips[i].buffer);
    pcmChunks.push(pcm);

    // Add silence gap between clips (except after last)
    if (i < clips.length - 1) {
      const silenceSamples = Math.floor(44100 * gapSeconds);
      pcmChunks.push(new Float32Array(silenceSamples));
    }
  }

  // Re-encode to MP3
  return encodePCMToMp3(pcmChunks);
}
```

**Recommendation:** Start with Option A (separate clips). It's simpler, works everywhere, and avoids audio quality loss from re-encoding.

### Step 7: Final Reviewer Agent

The Final Reviewer is the last quality gate before a lesson is published. It reviews the **complete assembled lesson** — the lesson.json with timestamps and the audio file — as a holistic unit. This is the only reviewer that sees the fully assembled product.

**What the Final Reviewer checks (that earlier reviewers cannot):**

1. **Timing and pacing** — Are events distributed naturally across the audio? Does it feel rushed or too slow? Is there dead time where nothing happens on screen?
2. **Section transitions** — Do the gaps between sections feel natural? Is there a jarring jump in code state between sections?
3. **Overall coherence** — Does the lesson tell a complete story from start to finish? Does the final section feel like a satisfying conclusion?
4. **Audio-event alignment** — Do edits appear at appropriate times relative to when the narration describes them? (edits should appear ~0.5s AFTER the narration mentions them, not before)

**Review prompt:**

```
You are a senior content reviewer doing the final quality check on a coding lesson
before it is published to learners. You are reviewing the FULLY ASSEMBLED lesson,
including timing information. This is the last gate — if you approve, learners see it.

## You receive:
- The complete lesson.json (with timestamps, events, narration text, checkpoints)
- Audio duration per section
- The original topic and lesson plan (for context)

## Criteria

1. PACING: Review the timing of events relative to audio.
   - Events should not be bunched up (multiple edits within 0.5s feels like a flash).
   - Events should not have long gaps (>3s of narration with no visual change feels dead).
   - Terminal commands should appear after the narration describes them, not before.
   - Estimate: does the total duration feel right for the content?

2. SECTION TRANSITIONS: Review the gaps between sections.
   - Is the silence gap between sections appropriate (0.3-1.0s)?
   - Does the code state at the start of section N match the checkpoint of section N-1?

3. OVERALL QUALITY: Review the lesson as a whole.
   - Does the title accurately reflect what's taught?
   - Does the lesson deliver on the learning objectives from the plan?
   - Would a learner feel satisfied after completing this lesson?
   - Are there any sections that could be cut without losing value?

4. TECHNICAL CORRECTNESS (spot check):
   - Scan terminal outputs — do they look realistic?
   - Scan final checkpoint — does the code look correct?
   - Any obvious issues a learner would notice?

## Output Format

{
  "approved": true/false,
  "quality_score": 1-10,
  "feedback": [
    {
      "category": "pacing|transitions|quality|correctness",
      "severity": "blocker|warning|suggestion",
      "section": "section-id or 'overall'",
      "issue": "Section 3 has 5 edit events in a 2-second window — will feel like a flash",
      "recommendation": "Spread events more evenly, or split the narration into smaller parts",
      "route_to": "assembly|script|plan"
    }
  ],
  "notes": "optional overall comments"
}

Rules:
- Approve only if quality_score >= 7 and there are no blockers.
- For each feedback item, specify "route_to" — which stage should fix this:
  - "assembly" for timing/pacing issues (can be fixed without re-generating content)
  - "script" for narration/code issues (needs new content, then re-validate and re-assemble)
  - "plan" for structural issues (nuclear option — needs full re-generation)
- The Lead Agent uses "route_to" to decide where to send the feedback.
- Be pragmatic: a quality_score of 7 is "good enough to ship." Don't block for polish
  that won't meaningfully improve the learner experience.
```

**Escalation paths from the Final Reviewer:**

| Feedback type | Route to | What happens |
|---|---|---|
| Timing/pacing issues | Assembler | Assembler adjusts event timestamps, re-stitches audio gaps. No re-generation. |
| Narration wording or code issue | Scripter | Scripter revises affected sections → re-validate → re-TTS → re-assemble. |
| Wrong section order, missing concept | Planner | Full re-plan → re-script → re-validate → re-TTS → re-assemble. Expensive — rare. |

---

### Multi-Agent Communication Protocol

All agents communicate through structured JSON messages. The Lead Agent mediates every interaction — agents never talk directly to each other.

**Message format:**

```typescript
interface AgentMessage {
  from: AgentRole;        // 'lead' | 'planner' | 'plan_reviewer' | 'scripter' | 'script_reviewer' | 'validator' | 'assembler' | 'final_reviewer'
  to: AgentRole;
  type: 'request' | 'result' | 'feedback' | 'revision';
  payload: any;           // Agent-specific structured JSON
  metadata: {
    runId: string;        // Pipeline run ID
    round: number;        // Review round (0 = first attempt)
    timestamp: string;
    parentMessageId?: string;  // For threading revision chains
  };
}
```

**Pipeline state machine (managed by Lead Agent):**

```
                    ┌─────────┐
                    │  START   │
                    └────┬────┘
                         │
                    ┌────▼────┐
              ┌────▶│ PLANNING │◀────┐
              │     └────┬────┘     │
              │          │          │
              │     ┌────▼────┐     │
              │     │ PLAN     │    │ (revision)
              │     │ REVIEW   │────┘
              │     └────┬────┘
              │          │ (approved)
              │     ┌────▼─────┐
              │ ┌──▶│ SCRIPTING │◀────┐
              │ │   └────┬─────┘     │
              │ │        │           │
              │ │   ┌────▼─────┐    │
              │ │   │ SCRIPT    │    │ (revision)
              │ │   │ REVIEW    │────┘
              │ │   └────┬─────┘
              │ │        │ (approved)
              │ │   ┌────▼──────┐
              │ │   │ VALIDATION │──── (code fix retry, up to 3x)
              │ │   └────┬──────┘
              │ │        │
              │ │   ┌────▼──┐
              │ │   │  TTS   │
              │ │   └────┬──┘
              │ │        │
              │ │   ┌────▼─────┐
              │ │   │ ASSEMBLY  │◀────┐
              │ │   └────┬─────┘     │
              │ │        │           │
              │ │   ┌────▼─────┐    │
              │ └───│ FINAL     │    │ (assembly-level fix)
              │     │ REVIEW    │────┘
              └─────│           │
                    └────┬─────┘
                         │ (approved)
                    ┌────▼────┐
                    │ COMPLETE │
                    └─────────┘
```

**Pipeline logging and observability:**

Every agent call is logged by the Lead Agent:

```typescript
interface PipelineLog {
  runId: string;
  topic: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  steps: PipelineStep[];
  totalLLMCalls: number;
  totalLLMTokens: { input: number; output: number };
  totalCost: number;
}

interface PipelineStep {
  agent: AgentRole;
  action: 'generate' | 'review' | 'revise' | 'validate' | 'assemble';
  round: number;
  startedAt: string;
  completedAt: string;
  input: any;    // Truncated for storage
  output: any;   // Truncated for storage
  approved?: boolean;
  tokensUsed: { input: number; output: number };
}
```

This log is stored per lesson and is viewable in the admin UI. It answers: "Why does this lesson look the way it does?" and "Where did the pipeline spend the most tokens?"

---

## Part 4: In-Browser Execution (Learner Interaction) — Zero Servers

When the learner pauses playback and wants to run code, they need a real execution environment. Since we deploy no servers, **all execution happens in the browser** using WebAssembly runtimes.

### Architecture

```
┌─────────────────────────────────────────────────┐
│                    Browser                        │
│                                                   │
│  ┌──────────┐    ┌────────────────────────────┐  │
│  │  xterm.js │◄──▶│  In-Browser Runtime         │  │
│  │           │    │                              │  │
│  └──────────┘    │  Python → Pyodide (WASM)     │  │
│                   │  JS/Node → WebContainers      │  │
│  ┌──────────┐    │                              │  │
│  │  Monaco   │───▶│  VirtualFileSystem ←→ Runtime│  │
│  │  Editor   │    └────────────────────────────┘  │
│  └──────────┘                                     │
│                                                   │
│         No server. No WebSocket. No Docker.       │
└─────────────────────────────────────────────────┘
```

### Python Execution: Pyodide

Pyodide runs the full CPython interpreter compiled to WebAssembly. It executes entirely in the browser — no server round-trip.

```typescript
import { loadPyodide, PyodideInterface } from 'pyodide';

class PythonRuntime {
  private pyodide: PyodideInterface | null = null;

  async initialize() {
    this.pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/',
    });
    // Pre-load commonly needed packages
    await this.pyodide.loadPackage(['numpy', 'micropip']);
  }

  async run(code: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.pyodide) throw new Error('Runtime not initialized');

    // Redirect stdout/stderr
    this.pyodide.runPython(`
      import sys, io
      sys.stdout = io.StringIO()
      sys.stderr = io.StringIO()
    `);

    try {
      this.pyodide.runPython(code);
      const stdout = this.pyodide.runPython('sys.stdout.getvalue()');
      const stderr = this.pyodide.runPython('sys.stderr.getvalue()');
      return { stdout, stderr, exitCode: 0 };
    } catch (e: any) {
      const stderr = this.pyodide.runPython('sys.stderr.getvalue()');
      return { stdout: '', stderr: stderr + '\n' + e.message, exitCode: 1 };
    }
  }

  // Write a file to Pyodide's in-memory filesystem
  writeFile(path: string, content: string) {
    this.pyodide!.FS.writeFile(path, content);
  }

  // Sync all files from VFS into Pyodide's filesystem
  syncFromVFS(vfs: VirtualFileSystem) {
    for (const [path, content] of vfs.entries()) {
      // Ensure parent directories exist
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (dir) this.pyodide!.FS.mkdirTree(dir);
      this.pyodide!.FS.writeFile(path, content);
    }
  }

  // Install additional packages at runtime
  async installPackage(pkg: string) {
    const micropip = this.pyodide!.pyimport('micropip');
    await micropip.install(pkg);
  }

  reset() {
    // Cheapest reset: re-initialize the runtime
    // Pyodide doesn't support full state reset, so we reload if needed
    // For most lessons, just clearing files is enough
    this.pyodide!.runPython(`
      import sys
      # Clear all user-defined modules
      to_remove = [key for key in sys.modules if not key.startswith('_') and key not in ('sys', 'io', 'os')]
      for key in to_remove:
          del sys.modules[key]
    `);
  }
}
```

**Pyodide capabilities and limits:**
| What works | What doesn't |
|---|---|
| Full Python 3.11 stdlib | C extensions not compiled for WASM (most are available though) |
| numpy, pandas, scipy, matplotlib | Network requests (`requests` library — no real HTTP from WASM) |
| File I/O (in-memory filesystem) | Subprocesses (`subprocess.run()`) |
| `pip install` via micropip (for pure-Python packages) | Anything requiring OS-level access |

For an education product teaching Python fundamentals, data structures, algorithms, pandas, numpy — Pyodide covers >95% of use cases.

### JavaScript/Node Execution: WebContainers

WebContainers (by StackBlitz) run a full Node.js environment inside the browser. Like Pyodide but for the JavaScript ecosystem.

```typescript
import { WebContainer } from '@webcontainer/api';

class NodeRuntime {
  private container: WebContainer | null = null;

  async initialize() {
    this.container = await WebContainer.boot();
  }

  async run(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.container) throw new Error('Runtime not initialized');

    const process = await this.container.spawn('sh', ['-c', command]);

    let stdout = '';
    let stderr = '';

    process.output.pipeTo(new WritableStream({
      write(chunk) { stdout += chunk; }
    }));

    // Note: WebContainers merge stdout/stderr in some cases
    const exitCode = await process.exit;
    return { stdout, stderr, exitCode };
  }

  async writeFile(path: string, content: string) {
    await this.container!.fs.writeFile(path, content);
  }

  async syncFromVFS(vfs: VirtualFileSystem) {
    // WebContainers support mounting a file tree at once
    const tree: Record<string, any> = {};
    for (const [path, content] of vfs.entries()) {
      tree[path] = { file: { contents: content } };
    }
    await this.container!.mount(tree);
  }

  async installPackages(packages: string[]) {
    const installProcess = await this.container!.spawn('npm', ['install', ...packages]);
    await installProcess.exit;
  }
}
```

**WebContainers capabilities and limits:**
| What works | What doesn't |
|---|---|
| Full Node.js runtime | Only JavaScript/TypeScript (not Python) |
| npm install (real packages) | Native addons (C++ bindings) |
| File system, HTTP server, child processes | Raw TCP/UDP sockets |
| Running frameworks (Express, Next.js, etc.) | Only works in Chromium-based browsers |

### Unified Runtime Interface

Both runtimes expose the same interface so the playback engine doesn't care which one is active:

```typescript
interface LessonRuntime {
  initialize(): Promise<void>;
  run(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  writeFile(path: string, content: string): Promise<void>;
  syncFromVFS(vfs: VirtualFileSystem): Promise<void>;
  reset(): Promise<void>;
}

function createRuntime(language: 'python' | 'javascript'): LessonRuntime {
  if (language === 'python') return new PythonRuntime();
  if (language === 'javascript') return new NodeRuntime();
  throw new Error(`Unsupported language: ${language}`);
}
```

### Learner Interaction Lifecycle (No Server)

1. **On lesson load:** Runtime is initialized in the background (Pyodide takes ~3-5s to load WASM, WebContainers ~2s). Start loading immediately so it's ready when the learner pauses.
2. **On pause (learner interacts):** Sync current VFS state into the runtime. Connect xterm.js to the runtime's output. Editor becomes writable.
3. **Learner edits code:** Changes go into the VFS. On "Run", the file is synced to the runtime and executed.
4. **On resume:** Restore VFS from the next checkpoint. Disconnect runtime from terminal. Editor becomes read-only. (Runtime stays alive — no need to restart.)
5. **On lesson exit:** Runtime is destroyed (tab GC handles this).

### Pre-loading Strategy

Pyodide's initial WASM download is ~12MB (cached after first visit). To avoid a cold-start wait:

```typescript
// In the lesson page, start loading as soon as the page renders
// Don't wait for the learner to pause
useEffect(() => {
  const runtime = createRuntime(lesson.language);
  runtime.initialize().then(() => {
    setRuntimeReady(true);
  });
  return () => runtime.reset();
}, [lesson.language]);
```

After the first visit, the WASM binary is cached by the browser's HTTP cache / service worker. Subsequent loads take <1s.

### Terminal Integration (In-Browser)

xterm.js becomes a simple command input/output display — no WebSocket needed:

```typescript
function connectTerminalToRuntime(terminal: Terminal, runtime: LessonRuntime) {
  let currentLine = '';

  terminal.onData((data) => {
    if (data === '\r') {  // Enter key
      terminal.write('\r\n');
      const command = currentLine;
      currentLine = '';

      // Execute in the in-browser runtime
      runtime.run(command).then(result => {
        if (result.stdout) terminal.write(result.stdout);
        if (result.stderr) terminal.write(`\x1b[31m${result.stderr}\x1b[0m`);
        terminal.write('$ ');
      });
    } else if (data === '\x7f') {  // Backspace
      if (currentLine.length > 0) {
        currentLine = currentLine.slice(0, -1);
        terminal.write('\b \b');
      }
    } else {
      currentLine += data;
      terminal.write(data);
    }
  });

  terminal.write('$ ');
}

---

## Part 5: Frontend Application Structure

### Next.js App Structure

```
src/
  app/
    page.tsx                    # Landing / course catalog (reads public/lessons/index.json)
    lessons/
      [lessonId]/
        page.tsx                # Lesson player page

  components/
    player/
      LessonPlayer.tsx          # Main player container
      PlaybackController.ts     # Audio-event sync engine (class, not component)
      PlaybackControls.tsx      # Play/pause/seek UI
      MonacoEditor.tsx          # Monaco wrapper
      XTerminal.tsx             # xterm.js wrapper
      FileExplorer.tsx          # File tree
      VirtualFileSystem.ts      # In-memory file system

  lib/
    runtime/
      interface.ts              # LessonRuntime interface (shared by both runtimes)
      pyodide-runtime.ts        # PythonRuntime — Pyodide WASM in-browser execution
      webcontainer-runtime.ts   # NodeRuntime — WebContainers in-browser execution
      terminal-bridge.ts        # Connects xterm.js to in-browser runtime (no server)
    lessons/
      loader.ts                 # Load lesson JSON + audio from public/lessons/
      types.ts                  # TypeScript types for lesson format

public/
  lessons/
    index.json                  # Lesson catalog manifest (auto-generated by CLI)
    python-list-comprehensions/
      lesson.json
      section-1.mp3
      section-2.mp3
      metadata.json
    python-decorators/
      lesson.json
      section-1.mp3
      section-2.mp3
      metadata.json

scripts/
  generate-lesson.ts            # CLI entry point: npx tsx scripts/generate-lesson.ts "topic"
  lib/
    lead-agent.ts               # Lead Agent — orchestrates the full pipeline
    planner.ts                  # Planner Agent — generates lesson outlines
    plan-reviewer.ts            # Plan Reviewer Agent — reviews outlines
    scripter.ts                 # Scripter Agent — generates code events + narration
    script-reviewer.ts          # Script Reviewer Agent — reviews script quality + sync
    tts.ts                      # TTS — text-to-speech conversion
    validator.ts                # Validator Agent — E2B sandbox code execution
    assembler.ts                # Assembler Agent — produces final lesson files
    final-reviewer.ts           # Final Reviewer Agent — end-to-end quality gate
    types.ts                    # Shared types: AgentMessage, ReviewFeedback, etc.
    prompts/
      planner.md                # System prompt for Planner Agent
      plan-reviewer.md          # System prompt for Plan Reviewer Agent
      scripter-pass1.md         # System prompt for Scripter Pass 1 (code)
      scripter-pass2.md         # System prompt for Scripter Pass 2 (narration)
      script-reviewer.md        # System prompt for Script Reviewer Agent
      final-reviewer.md         # System prompt for Final Reviewer Agent
```

The authoring pipeline (`scripts/`) is completely separate from the deployed app (`src/`). The only connection is the `public/lessons/` directory — the CLI writes there, the app reads from there. This means:
- The deployed app has **zero API routes** and **zero server-side code**. It's a pure static site.
- The authoring pipeline never ships to production. It's a dev/build-time tool.
- `@anthropic-ai/sdk`, `elevenlabs`, and `@e2b/code-interpreter` are **devDependencies** only — they don't bloat the client bundle.

### Key Dependencies

```json
{
  "dependencies": {
    "next": "^14",
    "react": "^18",
    "@monaco-editor/react": "^4",
    "xterm": "^5",
    "xterm-addon-fit": "^0.8",
    "pyodide": "^0.25",
    "@webcontainer/api": "^1"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^18",
    "tsx": "^4",
    "@anthropic-ai/sdk": "^0.30",
    "elevenlabs": "^0.10",
    "@e2b/code-interpreter": "^1"
  }
}
```

Note: `@anthropic-ai/sdk`, `elevenlabs`, and `@e2b/code-interpreter` are **devDependencies** — they are only used by the authoring CLI (`scripts/`) and never ship to production.

---

## Part 5b: Deployment Architecture — Static Site + Local CLI

The product has a clean two-phase workflow: **generate locally, deploy statically**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   AUTHORING (your machine)                DEPLOYMENT (static host)      │
│                                                                         │
│   ┌────────────────────┐                  ┌──────────────────────┐     │
│   │  CLI: generate-     │   git push      │  Vercel / Netlify /  │     │
│   │  lesson.ts          │────────────────▶│  any static host     │     │
│   │                     │                  │                      │     │
│   │  Calls:             │  public/         │  Serves:             │     │
│   │  - Claude API       │  lessons/        │  - Next.js static    │     │
│   │  - ElevenLabs API   │  *.json          │    export            │     │
│   │  - E2B API          │  *.mp3           │  - Lesson files      │     │
│   │                     │                  │  - No API routes     │     │
│   │  Writes to:         │                  │  - No server code    │     │
│   │  public/lessons/    │                  │                      │     │
│   └────────────────────┘                  └──────────────────────┘     │
│                                                      │                  │
│                                                      ▼                  │
│                                           ┌──────────────────────┐     │
│                                           │  Learner's Browser    │     │
│                                           │                       │     │
│                                           │  Pyodide → Python     │     │
│                                           │  WebContainers → JS   │     │
│                                           │  Monaco + xterm.js    │     │
│                                           │  (all local, no calls │     │
│                                           │   back to any server) │     │
│                                           └──────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

### Workflow

```bash
# 1. Generate a lesson locally
npx tsx scripts/generate-lesson.ts "Python list comprehensions" --language python --difficulty beginner

# Pipeline runs: Planner → Plan Review → Scripter → Script Review → Validator → TTS → Assembler → Final Review
# Output: public/lessons/python-list-comprehensions/{lesson.json, section-*.mp3, metadata.json}
# Also updates: public/lessons/index.json (catalog manifest)

# 2. Preview locally
npm run dev
# Open http://localhost:3000/lessons/python-list-comprehensions

# 3. Deploy
git add public/lessons/
git commit -m "Add lesson: Python list comprehensions"
git push  # Vercel auto-deploys
```

### What runs where:

| Component | Runs on | When | Cost |
|---|---|---|---|
| AI authoring pipeline (all agents) | Your machine (CLI) | Before deploy | ~$0.30-0.90 per lesson (Claude API) |
| TTS audio generation | Your machine → ElevenLabs/OpenAI API | Before deploy | ~$0.04-0.75 per lesson |
| Code validation | Your machine → E2B API | Before deploy | ~$0.01 per lesson |
| Lesson files (JSON + audio) | Static files in git repo | At deploy time | Free (served as static assets) |
| Lesson playback (editor, terminal, audio) | Learner's browser | Runtime | Free |
| Code execution (learner interaction) | Learner's browser (Pyodide/WebContainers) | Runtime | Free |

**Total cost to run the deployed product: $0.** The only costs are per-lesson generation (external API calls during authoring) and static hosting (free tier on Vercel/Netlify for most use cases).

### Batch generation

Generate multiple lessons in one go:

```bash
# Generate from a topics file
cat topics.txt
# Python list comprehensions
# Python decorators
# JavaScript promises
# JavaScript async/await

npx tsx scripts/generate-batch.ts --file topics.txt --language python --difficulty beginner

# Or generate a whole course outline and then each lesson
npx tsx scripts/generate-course.ts "Introduction to Python" --lessons 10
```

### Static export

Since the deployed app has zero API routes and zero server-side code, it can be exported as a fully static site:

```javascript
// next.config.js
module.exports = {
  output: 'export',  // Generates static HTML/CSS/JS — deployable anywhere
};
```

This means the app can be hosted on **any static file server** — Vercel, Netlify, GitHub Pages, S3 + CloudFront, or even a simple nginx. No Node.js runtime needed in production.

---

## Part 6: Build Order & Milestones

### Milestone 1: Static Lesson Playback (Week 1-2)

**Goal:** Hardcode a lesson JSON, get the playback engine working.

- [ ] Set up Next.js project with TypeScript
- [ ] Define TypeScript types for the lesson format (`lib/lessons/types.ts`)
- [ ] Build VirtualFileSystem class
- [ ] Build PlaybackController class (audio sync + event dispatch)
- [ ] Integrate Monaco Editor (read-only playback, multi-file support)
- [ ] Integrate xterm.js (display-only, receives writes from playback)
- [ ] Build FileExplorer component
- [ ] Build PlaybackControls (play/pause/seek bar/section markers)
- [ ] Create one handwritten lesson JSON + pre-recorded audio for testing
- [ ] Wire it all together in LessonPlayer

**Done when:** You can load a lesson, hit play, and watch code appear in the editor while narration plays, with proper sync. Seeking to sections works via checkpoints.

### Milestone 2: Learner Interaction — In-Browser Execution (Week 2-3)

**Goal:** Learner can pause, edit code, run it in-browser, and resume. No server needed.

- [ ] Integrate Pyodide for Python execution (WASM loading, file sync, stdout/stderr capture)
- [ ] Integrate WebContainers for JavaScript execution
- [ ] Build unified LessonRuntime interface
- [ ] Build terminal bridge (xterm.js ↔ in-browser runtime, no WebSocket)
- [ ] Pre-load runtime on lesson page load (so it's ready when learner pauses)
- [ ] On pause: unlock editor, sync VFS to runtime, connect terminal
- [ ] On resume: restore checkpoint, disconnect runtime, continue playback
- [ ] Test the full play → pause → interact → resume flow

**Done when:** Learner can pause mid-lesson, modify the code, run it in the terminal (all in-browser), see output, and resume playback cleanly. Zero server calls during interaction.

### Milestone 3: AI Authoring Pipeline — Core Agents (Week 3-5)

**Goal:** Build the individual agents and get the basic pipeline working end-to-end without review loops.

- [ ] Define shared types (`AgentMessage`, `ReviewFeedback`, `PipelineLog`, etc.)
- [ ] Build Planner Agent (LLM call → lesson outline)
- [ ] Build Scripter Agent Pass 1 (LLM call → code events per section)
- [ ] Build Scripter Agent Pass 2 (LLM call → narration per section, referencing code)
- [ ] Build TTS integration (narration → audio clips with durations)
- [ ] Build Validator Agent (run code in E2B cloud sandbox, capture real output, retry on failure)
- [ ] Build Assembler Agent (stitch audio, assign timestamps, produce lesson.json)
- [ ] Build CLI entry point: `npx tsx scripts/generate-lesson.ts "Python list comprehensions"` (no reviews, straight pipeline)
- [ ] CLI writes output to `public/lessons/` and updates `public/lessons/index.json`
- [ ] Test with 5-10 different topics, iterate on prompts

**Done when:** Running the CLI with a topic produces a lesson.json + audio.mp3 that plays correctly in the player from Milestone 1. No review loops yet — just the straight pipeline.

### Milestone 4: Review Agents & Lead Agent Orchestration (Week 5-7)

**Goal:** Add review loops and the Lead Agent to improve lesson quality automatically.

- [ ] Build Plan Reviewer Agent with structured review criteria and scoring
- [ ] Build Script Reviewer Agent with code-narration sync checking
- [ ] Build Final Reviewer Agent with end-to-end quality scoring
- [ ] Build Lead Agent orchestrator with review feedback loops
- [ ] Implement revision prompts for Planner and Scripter (accept feedback, produce revised output)
- [ ] Implement feedback routing in Final Reviewer (route_to: assembly/script/plan)
- [ ] Add pipeline logging (every agent call, review round, token usage)
- [ ] Extract all agent system prompts into `prompts/` directory for easy iteration
- [ ] Test: run 10+ topics, compare quality with and without review loops
- [ ] Tune review thresholds (when to approve vs. request revision)

**Done when:** The pipeline produces noticeably better lessons with review loops enabled. Pipeline logs show review rounds catching and fixing real issues. Most lessons pass final review within 1-2 rounds.

### Milestone 5: CLI Polish, Course Catalog & Batch Generation (Week 7-8)

**Goal:** Streamlined authoring workflow and a polished learner-facing catalog.

- [ ] CLI progress output (show which agent is active, review rounds, approvals in terminal)
- [ ] Pipeline log saved to `public/lessons/{id}/pipeline-log.json` for debugging
- [ ] Batch generation script (`generate-batch.ts` — multiple topics from a file)
- [ ] Course generation script (`generate-course.ts` — auto-plan N lessons for a subject)
- [ ] Lesson catalog page (reads `public/lessons/index.json`, filterable by language/difficulty/tags)
- [ ] Lesson detail page polish (progress tracking, section navigation)
- [ ] Static export config (`next.config.js` → `output: 'export'`)
- [ ] Deploy to Vercel/Netlify/GitHub Pages

**Done when:** You can generate a batch of lessons from a topics file, preview them locally, `git push`, and learners see a polished course catalog with working interactive lessons — all from static hosting.

---

## Part 7: Key Risks & Mitigations

### Risk: LLM generates code that doesn't work
**Mitigation:** The Validator catches this. The retry loop sends errors back to the LLM. 3 attempts. If all fail, the section is flagged for human review rather than published broken.

### Risk: Narration references wrong line numbers
**Mitigation:** Two-pass Scripter. Code is generated first, narration second with code visible. The narration prompt includes the actual file content with line numbers.

### Risk: Audio-event sync feels unnatural
**Mitigation:** The Assembler's timing distribution is tunable. Start with even distribution, then refine: edits should start ~0.5s after the narration begins describing them (so the learner hears "let's add a for loop" and THEN sees it appear). This timing offset is a single parameter to tune.

### Risk: In-browser runtime cold start latency when learner pauses
**Mitigation:** Pre-load the runtime as soon as the lesson page renders (don't wait for the learner to pause). Pyodide WASM is ~12MB but is HTTP-cached after first visit. WebContainers boot in ~2s. With pre-loading, the runtime is ready before the learner ever hits pause. Add a subtle "Runtime ready" indicator so the learner knows they can interact.

### Risk: Pyodide / WebContainers can't run the lesson's code
**Mitigation:** Pyodide supports Python stdlib + numpy/pandas/scipy/matplotlib via micropip. WebContainers support full Node.js + npm. For an education product teaching fundamentals, this covers >95% of use cases. For lessons that need unsupported packages (e.g., TensorFlow, database drivers), the lesson metadata should declare `"interactionSupported": false` and the learner sees a view-only mode with pre-recorded output. This is a graceful degradation, not a failure.

### Risk: WebContainers only work in Chromium-based browsers
**Mitigation:** WebContainers require Chrome/Edge/Brave (no Firefox/Safari). For JavaScript lessons on unsupported browsers, fall back to a simpler eval-based execution (less capable but works everywhere). For Python, Pyodide works in all modern browsers. Document the browser requirement clearly.

### Risk: Generated lessons are technically correct but pedagogically bad
**Mitigation:** The multi-agent review system directly addresses this. The Plan Reviewer checks pedagogical structure before any code is generated. The Script Reviewer checks narration quality and teaching clarity. The Final Reviewer does a holistic quality check. Three layers of quality gates, each with specific pedagogical criteria in their system prompts.

### Risk: Review loops run forever (agents never agree)
**Mitigation:** Hard caps on review rounds: 3 for plan review, 3 for script review, 2 for final review. After the cap, the Lead Agent escalates (flags for human review) rather than looping. In practice, most lessons should pass within 1-2 rounds — if a topic consistently hits the cap, the system prompts need tuning, not more rounds.

### Risk: Review agents are too strict or too lenient
**Mitigation:** Start lenient and tighten over time. Initial threshold: approve if no blockers, even with warnings. Track approval rates per reviewer — if Plan Reviewer approves >95% on first pass, it's probably too lenient. If it rejects >50%, it's too strict. Tune by adjusting the scoring thresholds and blocker criteria in the system prompts. Keep prompts in separate `.md` files for easy iteration.

### Risk: Multi-agent pipeline is expensive (many API calls per lesson)
**Mitigation:** Count the calls: Plan (1) + Plan Review (1) + Scripter Pass 1 (1) + Scripter Pass 2 (1) + Script Review (1) + Final Review (1) = 6 LLM calls minimum, plus retries. Total per-lesson cost estimate: ~$0.30-0.90 LLM (Claude API) + ~$0.04-0.75 TTS + ~$0.01 E2B sandbox = **under $2 per lesson in the worst case**. This is acceptable — a single human-authored lesson would cost hours of instructor time. The deployed product costs $0 to run (static hosting + in-browser execution). The only ongoing cost is generating new lessons, which you control — you only pay when you run the CLI. Pipeline logging tracks token/API usage per run to monitor costs.

### Risk: Feedback routing in Final Review sends work to the wrong stage
**Mitigation:** The Lead Agent's `routeFeedback()` function categorizes feedback. Start with simple keyword-based routing (structure → plan, code/narration → script, timing → assembly). Log every routing decision. If misrouting is common, upgrade to an LLM call that classifies the feedback — but this adds another LLM call per feedback item, so only do it if simple heuristics fail.
