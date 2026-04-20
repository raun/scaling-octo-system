import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type {
  AssembledLesson,
  AssembledSection,
  AudioClip,
  LessonMeta,
  LessonOptions,
  LessonPlan,
  ScriptEvent,
  TimedEvent,
  ValidatedSection,
} from "./types";

const SECTION_GAP = 0.5;
const LESSONS_DIR = join(__dirname, "..", "..", "public", "lessons");

export class Assembler {
  assemble(
    plan: LessonPlan,
    options: LessonOptions,
    sections: ValidatedSection[],
    clips: AudioClip[]
  ): AssembledLesson {
    const clipMap = new Map(clips.map((c) => [c.sectionId, c]));
    let cursor = 0;
    let terminalHistory = "";
    // Track file state across sections for diffing
    const fileState: Map<string, string> = new Map();

    const assembledSections: AssembledSection[] = sections.map((section) => {
      const clip = clipMap.get(section.id);
      if (!clip) {
        throw new Error(`No audio clip found for section "${section.id}"`);
      }

      const startTime = cursor;
      const duration = clip.durationSeconds;
      const endTime = startTime + duration;

      // Convert steps (file snapshots + terminal) to Monaco events (edits + terminal)
      const events = stepsToEvents(section.steps, fileState);

      // Assign timestamps
      const editCutoff = startTime + duration * 0.7;
      const termStart = editCutoff;
      const timedEvents = assignTimestamps(
        events,
        startTime,
        editCutoff,
        termStart,
        endTime
      );

      // Build terminal history
      for (const step of section.steps) {
        if (step.type === "terminal") {
          terminalHistory += `$ ${step.command}\n${step.output}`;
        }
      }

      // Build checkpoint from current file state
      const checkpointFiles: Record<string, string> = {};
      for (const [path, content] of fileState) {
        checkpointFiles[path] = content;
      }

      cursor = endTime + SECTION_GAP;

      return {
        id: section.id,
        label: section.label,
        startTime: round(startTime),
        endTime: round(endTime),
        narration: section.narration,
        events: timedEvents,
        checkpoint: {
          files: checkpointFiles,
          terminalHistory: terminalHistory || undefined,
        },
      };
    });

    return {
      version: 1,
      id: slugify(plan.title),
      title: plan.title,
      language: options.language,
      totalDuration: round(cursor - SECTION_GAP),
      sections: assembledSections,
    };
  }

  writeToDisk(
    lesson: AssembledLesson,
    clips: AudioClip[],
    options: LessonOptions & { description?: string }
  ): string {
    const lessonDir = join(LESSONS_DIR, lesson.id);
    mkdirSync(lessonDir, { recursive: true });

    writeFileSync(
      join(lessonDir, "lesson.json"),
      JSON.stringify(lesson, null, 2)
    );

    const clipMap = new Map(clips.map((c) => [c.sectionId, c]));
    for (let i = 0; i < lesson.sections.length; i++) {
      const section = lesson.sections[i];
      const clip = clipMap.get(section.id);
      if (clip) {
        writeFileSync(join(lessonDir, `section-${i + 1}.mp3`), clip.buffer);
      }
    }

    const meta: LessonMeta = {
      id: lesson.id,
      title: lesson.title,
      description: options.description ?? "",
      language: lesson.language,
      difficulty: options.difficulty,
      tags: [],
      totalDuration: lesson.totalDuration,
    };
    writeFileSync(
      join(lessonDir, "metadata.json"),
      JSON.stringify(meta, null, 2)
    );

    updateIndex(meta);

    console.log(`[Assembler] Wrote lesson to ${lessonDir}`);
    return lessonDir;
  }
}

/**
 * Convert step-based format (full file snapshots + terminal) into
 * Monaco-compatible events (file_create, edit, terminal_input, terminal_output).
 *
 * This is the key transformation: the LLM provides full file content at each step,
 * and we compute the minimal diffs automatically. No more LLM-generated line/column numbers.
 */
function stepsToEvents(
  steps: ValidatedSection["steps"],
  fileState: Map<string, string>
): ScriptEvent[] {
  const events: ScriptEvent[] = [];

  for (const step of steps) {
    if (step.type === "code") {
      const prevContent = fileState.get(step.path);

      if (prevContent === undefined) {
        // First time seeing this file — create it
        events.push({
          type: "file_create",
          path: step.path,
          content: step.content,
        });
      } else if (prevContent !== step.content) {
        // File exists and content changed — compute diff
        const edit = computeDiff(prevContent, step.content);
        events.push({
          type: "edit",
          path: step.path,
          edits: [edit],
        });
      }
      // Update file state
      fileState.set(step.path, step.content);
    } else if (step.type === "terminal") {
      events.push({
        type: "terminal_input",
        command: step.command,
      });
      events.push({
        type: "terminal_output",
        output: step.output,
      });
    }
  }

  return events;
}

/**
 * Compute a single Monaco edit that transforms `oldContent` into `newContent`.
 * Finds the first and last differing lines and produces a replacement range.
 *
 * Monaco ranges are 1-indexed. To insert at a position, startLine must equal endLine
 * and startCol must equal endCol. To replace, the range covers the old text.
 */
function computeDiff(
  oldContent: string,
  newContent: string
): {
  range: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  text: string;
} {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Find first differing line (from the top)
  let top = 0;
  while (
    top < oldLines.length &&
    top < newLines.length &&
    oldLines[top] === newLines[top]
  ) {
    top++;
  }

  // Find matching lines from the bottom
  let oldBottom = oldLines.length - 1;
  let newBottom = newLines.length - 1;
  while (
    oldBottom >= top &&
    newBottom >= top &&
    oldLines[oldBottom] === newLines[newBottom]
  ) {
    oldBottom--;
    newBottom--;
  }

  // Now the changed region in old is [top..oldBottom], in new is [top..newBottom]
  const replacementLines = newLines.slice(top, newBottom + 1);
  const replacementText = replacementLines.join("\n");

  // Monaco ranges are 1-indexed
  if (oldBottom < top) {
    // Pure insertion — no old lines to replace.
    // Insert at end of line `top` (which is the line just before the insertion point).
    // If top == oldLines.length, we're appending at the end of the file.
    if (top >= oldLines.length) {
      // Append after last line
      const lastLine = oldLines.length;
      const lastCol = oldLines[lastLine - 1].length + 1;
      return {
        range: {
          startLine: lastLine,
          startCol: lastCol,
          endLine: lastLine,
          endCol: lastCol,
        },
        text: "\n" + replacementText,
      };
    } else {
      // Insert before line `top+1`
      return {
        range: {
          startLine: top + 1,
          startCol: 1,
          endLine: top + 1,
          endCol: 1,
        },
        text: replacementText + "\n",
      };
    }
  }

  // Replacement: old lines [top..oldBottom] are replaced by new lines [top..newBottom]
  const rangeStartLine = top + 1;
  const rangeStartCol = 1;
  const rangeEndLine = oldBottom + 1;
  const rangeEndCol = oldLines[oldBottom].length + 1;

  return {
    range: {
      startLine: rangeStartLine,
      startCol: rangeStartCol,
      endLine: rangeEndLine,
      endCol: rangeEndCol,
    },
    text: replacementText,
  };
}

/**
 * Assign timestamps to events, synced to the audio narration flow:
 *
 * - Code events (file_create, edit) go in the first 65% of the section.
 *   This is when the narrator explains what code is being written.
 * - Terminal events (input, output) go in the last 35% of the section.
 *   This is when the narrator says "let's run it and see what happens."
 * - terminal_input and terminal_output are paired with a 1.5s gap
 *   (simulates typing the command, then output appearing).
 * - Minimum 2s gap between code edits so the learner can read each change.
 */
function assignTimestamps(
  events: ScriptEvent[],
  startTime: number,
  editCutoff: number,
  termStart: number,
  endTime: number
): TimedEvent[] {
  if (events.length === 0) return [];

  const CODE_GAP = 2.0; // seconds between code edits
  const TERM_PAIR_GAP = 1.5; // seconds between terminal_input and terminal_output
  const TERM_GROUP_GAP = 3.0; // seconds between terminal run pairs
  const MARGIN = 1.0; // margin from section start

  const codeEvents = events.filter(
    (e) => e.type === "file_create" || e.type === "edit"
  );
  const termEvents = events.filter(
    (e) => e.type === "terminal_input" || e.type === "terminal_output"
  );

  const timed: TimedEvent[] = [];

  // --- Code events: spread across [startTime+MARGIN, editCutoff] ---
  if (codeEvents.length > 0) {
    const codeWindow = editCutoff - startTime - MARGIN;
    const codeGap =
      codeEvents.length > 1
        ? Math.max(CODE_GAP, codeWindow / (codeEvents.length - 1))
        : 0;

    codeEvents.forEach((event, i) => {
      const t = startTime + MARGIN + i * codeGap;
      timed.push({ t: round(Math.min(t, editCutoff)), ...event });
    });
  }

  // --- Terminal events: spread across [termStart, endTime-0.5] ---
  // Group into pairs: terminal_input followed by terminal_output
  if (termEvents.length > 0) {
    const pairs: { input: ScriptEvent; output?: ScriptEvent }[] = [];
    for (let i = 0; i < termEvents.length; i++) {
      if (termEvents[i].type === "terminal_input") {
        const output =
          i + 1 < termEvents.length &&
          termEvents[i + 1].type === "terminal_output"
            ? termEvents[i + 1]
            : undefined;
        pairs.push({ input: termEvents[i], output });
        if (output) i++; // skip the output, we've consumed it
      }
    }

    const termWindow = endTime - termStart - 0.5;
    const pairGap =
      pairs.length > 1
        ? Math.max(
            TERM_GROUP_GAP,
            termWindow / (pairs.length - 1)
          )
        : 0;

    pairs.forEach((pair, i) => {
      const inputT = termStart + i * pairGap;
      timed.push({ t: round(Math.min(inputT, endTime - 1)), ...pair.input });
      if (pair.output) {
        const outputT = inputT + TERM_PAIR_GAP;
        timed.push({
          t: round(Math.min(outputT, endTime - 0.5)),
          ...pair.output,
        });
      }
    });
  }

  // Sort by time (code events first, then terminal)
  timed.sort((a, b) => a.t - b.t);
  return timed;
}

function updateIndex(meta: LessonMeta): void {
  mkdirSync(LESSONS_DIR, { recursive: true });
  const indexPath = join(LESSONS_DIR, "index.json");

  let index: { lessons: LessonMeta[] } = { lessons: [] };
  if (existsSync(indexPath)) {
    try {
      const raw = JSON.parse(readFileSync(indexPath, "utf-8"));
      // Handle both { lessons: [...] } and [...] formats
      index = raw.lessons ? raw : { lessons: raw };
    } catch {
      index = { lessons: [] };
    }
  }

  const existing = index.lessons.findIndex((l) => l.id === meta.id);
  if (existing >= 0) {
    index.lessons[existing] = meta;
  } else {
    index.lessons.push(meta);
  }

  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
