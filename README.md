# Interactive Code Lessons

An AI-authored interactive coding education platform. Lessons play as narrated coding walkthroughs — code appears in a live editor synced to audio, with terminal commands and output. Learners can **pause at any point**, edit the code, run it in their browser, and resume.

No servers required. The authoring pipeline runs locally as a CLI. The app deploys as a fully static site.

## How It Works

```
                                    ┌──────────────────────────┐
  npx tsx scripts/generate-lesson   │   Learner's Browser      │
  "Python list comprehensions"      │                          │
         │                          │  Monaco Editor (code)    │
         ▼                          │  xterm.js (terminal)     │
  ┌─────────────────┐  git push    │  Audio narration         │
  │ public/lessons/  │────────────▶│  Brython (Python→JS)   │
  │  lesson.json     │   deploy    │  WebContainers (JS)      │
  │  section-*.mp3   │             │                          │
  └─────────────────┘              └──────────────────────────┘
```

**Authoring** — A multi-agent AI pipeline generates complete lessons from a topic string. Agents plan the curriculum, write code and narration, validate code in cloud sandboxes, generate audio via TTS, and review the output for quality. All orchestrated by a Lead Agent with feedback loops.

**Playback** — The browser loads a lesson JSON (timestamped editor events + terminal events) and plays it back synced to audio. The learner sees code being written in real-time.

**Interaction** — When the learner pauses, the editor becomes writable and the terminal connects to an in-browser runtime (Brython for Python, WebContainers for JavaScript). They can edit code, run it, see output — then resume the lesson.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:3000
```

A sample lesson (Python List Comprehensions) is included. Click it from the catalog to try the playback engine.

## Generating Lessons

Requires API keys for the authoring pipeline:

```bash
export ANTHROPIC_API_KEY="sk-..."   # Required — powers all LLM agents
export OPENAI_API_KEY="sk-..."      # Required — TTS audio generation
```

### Single lesson

```bash
npx tsx scripts/generate-lesson.ts "Python decorators" --language python --difficulty beginner
```

### Batch (from a file)

```bash
# topics.txt — one topic per line
npx tsx scripts/generate-batch.ts --file topics.txt --language python --difficulty beginner
```

### Full course (AI plans the topics)

```bash
npx tsx scripts/generate-course.ts "Introduction to Python" --lessons 8 --difficulty beginner
```

All commands write output to `public/lessons/` and update `public/lessons/index.json`. Run `npm run dev` to preview, then deploy.

## Deploying

The app is a static Next.js export — no Node.js server needed in production.

```bash
npm run build    # Outputs to out/
```

Deploy the `out/` directory to any static host: Vercel, Netlify, GitHub Pages, S3 + CloudFront, or a plain nginx server.

## Project Structure

```
src/                              # Next.js app (static, deploys to production)
  app/
    page.tsx                      # Lesson catalog with search/filter
    lessons/[lessonId]/           # Lesson player page
  components/player/
    LessonPlayer.tsx              # Main player — playback + interactive mode
    MonacoEditor.tsx              # Code editor (Monaco)
    XTerminal.tsx                 # Terminal (xterm.js)
    FileExplorer.tsx              # File tree
    PlaybackControls.tsx          # Play/pause, seek, section markers
  lib/
    lessons/                      # Playback engine
      PlaybackController.ts       # Timer + audio sync, event dispatch
      VirtualFileSystem.ts        # In-memory file state
      types.ts                    # Lesson JSON format types
    runtime/                      # In-browser code execution
      brython-runtime.ts          # Python via Brython (Python→JS transpiler)
      webcontainer-runtime.ts     # JavaScript via WebContainers
      terminal-bridge.ts          # xterm.js ↔ runtime bridge

scripts/                          # Authoring CLI (runs locally, never deployed)
  generate-lesson.ts              # Generate one lesson
  generate-batch.ts               # Generate from a topics file
  generate-course.ts              # AI-planned course generation
  lib/
    lead-agent.ts                 # Pipeline orchestrator
    planner.ts                    # Lesson outline generation
    scripter.ts                   # Code events + narration generation
    validator.ts                  # E2B sandbox code execution
    tts.ts                        # OpenAI TTS integration
    assembler.ts                  # Final lesson assembly + file output
    plan-reviewer.ts              # Reviews lesson outlines
    script-reviewer.ts            # Reviews code-narration sync
    final-reviewer.ts             # End-to-end quality gate
    prompts/                      # System prompts for each agent

public/lessons/                   # Generated lesson data (committed to repo)
  index.json                      # Lesson catalog manifest
  python-list-comprehensions/     # Example lesson
    lesson.json                   # Timestamped events + checkpoints
    section-*.mp3                 # Audio per section
    metadata.json                 # Title, description, tags
```

## Authoring Pipeline

The AI authoring pipeline is a multi-agent system with review loops:

```
Topic → Planner ⇄ Plan Reviewer → Scripter ⇄ Script Reviewer → Validator → TTS → Assembler ⇄ Final Reviewer → lesson.json + audio
```

Each `⇄` is a feedback loop — the reviewer can reject and request revisions (max 3 rounds for plan/script, 2 for final). The Lead Agent orchestrates the flow and routes feedback to the appropriate stage.

| Agent | Role |
|---|---|
| **Planner** | Generates a lesson outline (sections, objectives, code approach) |
| **Plan Reviewer** | Scores the outline on 5 pedagogical criteria |
| **Scripter** | Two-pass: generates code events, then narration referencing the code |
| **Script Reviewer** | Checks code-narration sync, edit sizing, checkpoint consistency |
| **Validator** | Runs code locally in temp directories, captures real output |
| **TTS** | Converts narration text to audio via OpenAI TTS |
| **Assembler** | Assigns timestamps, writes lesson files + updates catalog |
| **Final Reviewer** | End-to-end quality check, routes issues back to prior stages |

## Lesson Format

Lessons are JSON files containing timestamped events:

```json
{
  "version": 1,
  "id": "python-list-comprehensions",
  "title": "Python List Comprehensions",
  "language": "python",
  "totalDuration": 30,
  "sections": [
    {
      "id": "section-1",
      "label": "A simple for loop",
      "startTime": 0,
      "endTime": 12,
      "narration": "Let's start by writing a simple for loop...",
      "events": [
        { "t": 0.5, "type": "file_create", "path": "main.py", "content": "" },
        { "t": 2.0, "type": "edit", "path": "main.py", "edits": [{ "range": { "startLine": 1, "startCol": 1, "endLine": 1, "endCol": 1 }, "text": "numbers = [1, 2, 3]" }] },
        { "t": 9.0, "type": "terminal_input", "command": "python main.py" },
        { "t": 10.0, "type": "terminal_output", "output": "[1, 4, 9]\n" }
      ],
      "checkpoint": {
        "files": { "main.py": "numbers = [1, 2, 3]\n..." }
      }
    }
  ]
}
```

Checkpoints at the end of each section enable instant seeking — jump to any section without replaying from the start.

## Tech Stack

| Component | Technology |
|---|---|
| Frontend framework | Next.js 16 (static export) |
| Code editor | Monaco Editor |
| Terminal | xterm.js |
| Python execution | Brython (Python→JS transpiler, in-browser) |
| JavaScript execution | WebContainers (in-browser) |
| LLM agents | Claude (Anthropic API) |
| Text-to-speech | OpenAI TTS |
| Code validation | Local execution (child_process) |
| Styling | Tailwind CSS |
