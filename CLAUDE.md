# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI-authored interactive coding education platform. Lessons are timestamped event timelines (editor edits, terminal commands) synced to audio narration. Learners watch code unfold in a live editor, can pause to interact (edit code, run it in-browser via Pyodide/WebContainers), and resume.

Two distinct parts:
- **`src/`** — Next.js static app. Lesson playback, catalog with search/filter. Zero API routes. Deploys as static export.
- **`scripts/`** — CLI authoring pipeline. Multi-agent system (Planner → Plan Reviewer → Scripter → Script Reviewer → Validator → TTS → Assembler → Final Reviewer) orchestrated by a Lead Agent. Runs locally, outputs to `public/lessons/`.

## Commands

- **Dev server:** `npm run dev`
- **Build (static export):** `npm run build` (outputs to `out/`)
- **Lint:** `npm run lint`
- **Generate a lesson:** `npx tsx scripts/generate-lesson.ts "Topic" --language python --difficulty beginner`
- **Batch generate:** `npx tsx scripts/generate-batch.ts --file topics.txt --language python`
- **Generate a course:** `npx tsx scripts/generate-course.ts "Course Title" --lessons 5`

## Environment Variables (for authoring CLI only)

- `ANTHROPIC_API_KEY` — Required. Used by all LLM agents.
- `OPENAI_API_KEY` — Required for TTS audio generation.
- Python and/or Node.js installed locally — used by the Validator to run lesson code.

## Architecture

### Playback Engine (`src/lib/lessons/`)
- `types.ts` — Lesson format: events (file_create, edit, terminal_input, terminal_output), sections with checkpoints, metadata.
- `PlaybackController.ts` — Timer-based clock synced to per-section audio. Dispatches events to editor/terminal via callbacks. Handles play/pause/seek.
- `VirtualFileSystem.ts` — In-memory file state with change listeners and checkpoint restore.

### In-Browser Runtime (`src/lib/runtime/`)
- `interface.ts` — `LessonRuntime` interface + `createRuntime()` factory.
- `brython-runtime.ts` — Python execution via Brython (Python→JS transpiler, ~200KB). Handles `python <file>` commands.
- `webcontainer-runtime.ts` — JS/Node execution via WebContainers.
- `terminal-bridge.ts` — Connects xterm.js to runtime for interactive command input/output.

### Components (`src/components/player/`)
- `LessonPlayer.tsx` — Main container. Manages playback state, interactive mode (pause → edit → run → resume), and runtime lifecycle.
- `MonacoEditor.tsx` — Monaco wrapper with imperative handle for programmatic edits.
- `XTerminal.tsx` — xterm.js wrapper with display-only and interactive modes.
- `FileExplorer.tsx` — Tree view of VFS files.
- `PlaybackControls.tsx` — Play/pause, seek bar with section markers, section chips.

### Authoring Pipeline (`scripts/lib/`)
- `lead-agent.ts` — Orchestrator. Runs 6-phase pipeline with review loops.
- `planner.ts` / `scripter.ts` — Content generation agents (with `revise()` methods for review feedback).
- `plan-reviewer.ts` / `script-reviewer.ts` / `final-reviewer.ts` — Review agents with structured scoring.
- `validator.ts` — Runs code locally via child_process in temp directories, captures real output, retries on failure.
- `tts.ts` — OpenAI TTS API integration.
- `assembler.ts` — Timestamps events, writes lesson.json + audio + metadata to disk, updates index.json.
- `prompts/` — Markdown system prompts for each agent.

### Data Flow
```
CLI: topic → Planner → PlanReviewer → Scripter → ScriptReviewer → Validator → TTS → Assembler → FinalReviewer
Output: public/lessons/{id}/lesson.json + section-*.mp3 + metadata.json

Browser: lesson.json → PlaybackController → Monaco + xterm.js
         section-*.mp3 → HTMLAudioElement (per section)
         Pause → Pyodide/WebContainers → interactive terminal
```
