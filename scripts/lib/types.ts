// ============ Lesson Options ============

export interface LessonOptions {
  language: "python" | "javascript";
  difficulty: "beginner" | "intermediate" | "advanced";
  targetDuration: number; // in minutes
}

// ============ Planner Output ============

export interface LessonPlan {
  title: string;
  description: string;
  prerequisites: string[];
  sections: PlanSection[];
}

export interface PlanSection {
  label: string;
  objective: string;
  approach: string;
  builds_on_previous: boolean;
}

// ============ Scripter Output ============

export interface ScriptedLesson {
  sections: ScriptedSection[];
}

export interface ScriptedSection {
  id: string;
  label: string;
  narration: string;
  steps: ScriptStep[];
}

export type ScriptStep =
  | { type: "code"; path: string; content: string }
  | { type: "terminal"; command: string; output: string };

// Compiled events (after diff computation) used by the playback engine
export type ScriptEvent =
  | { type: "file_create"; path: string; content: string }
  | {
      type: "edit";
      path: string;
      edits: {
        range: {
          startLine: number;
          startCol: number;
          endLine: number;
          endCol: number;
        };
        text: string;
      }[];
    }
  | { type: "terminal_input"; command: string }
  | { type: "terminal_output"; output: string };

// ============ Review Output ============

export interface ReviewResult {
  approved: boolean;
  score?: Record<string, number>;
  quality_score?: number;
  feedback: ReviewFeedbackItem[];
  notes?: string;
}

export interface ReviewFeedbackItem {
  section?: string;
  category: string;
  severity: "blocker" | "warning" | "suggestion";
  issue: string;
  recommendation: string;
  route_to?: "plan" | "script" | "assembly";
}

// ============ Validated Output ============

export interface ValidatedSection {
  id: string;
  label: string;
  narration: string;
  steps: ScriptStep[];
  // steps have real terminal output from local execution
}

// ============ Audio ============

export interface AudioClip {
  sectionId: string;
  buffer: Buffer;
  durationSeconds: number;
}

// ============ Assembled Lesson ============

export interface AssembledLesson {
  version: number;
  id: string;
  title: string;
  language: string;
  totalDuration: number;
  sections: AssembledSection[];
}

export interface AssembledSection {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  narration: string;
  events: TimedEvent[];
  checkpoint: {
    files: Record<string, string>;
    terminalHistory?: string;
  };
}

export interface TimedEvent extends Record<string, unknown> {
  t: number;
  type: string;
}

// ============ Pipeline Logging ============

export interface PipelineLog {
  runId: string;
  topic: string;
  options: LessonOptions;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  steps: PipelineStep[];
  totalLLMCalls: number;
  totalLLMTokens: { input: number; output: number };
}

export interface PipelineStep {
  agent: string;
  action: string;
  round: number;
  startedAt: string;
  completedAt?: string;
  approved?: boolean;
  tokensUsed?: { input: number; output: number };
  error?: string;
}

// ============ Lesson Meta (for index.json) ============

export interface LessonMeta {
  id: string;
  title: string;
  description: string;
  language: string;
  difficulty: string;
  tags: string[];
  totalDuration: number;
}
