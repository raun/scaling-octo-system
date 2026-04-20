export interface EditRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface Edit {
  range: EditRange;
  text: string;
}

export interface FileCreateEvent {
  t: number;
  type: "file_create";
  path: string;
  content: string;
}

export interface EditEvent {
  t: number;
  type: "edit";
  path: string;
  edits: Edit[];
}

export interface TerminalInputEvent {
  t: number;
  type: "terminal_input";
  command: string;
}

export interface TerminalOutputEvent {
  t: number;
  type: "terminal_output";
  output: string;
}

export type LessonEvent =
  | FileCreateEvent
  | EditEvent
  | TerminalInputEvent
  | TerminalOutputEvent;

export interface Checkpoint {
  files: Record<string, string>;
  terminalHistory?: string;
}

export interface LessonSection {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  narration: string;
  events: LessonEvent[];
  checkpoint: Checkpoint;
}

export interface Lesson {
  version: number;
  id: string;
  title: string;
  language: string;
  totalDuration: number;
  sections: LessonSection[];
}

export interface LessonMeta {
  id: string;
  title: string;
  description: string;
  language: string;
  difficulty: string;
  tags: string[];
  totalDuration: number;
}

export interface LessonIndex {
  lessons: LessonMeta[];
}
