import { VirtualFileSystem } from "../lessons/VirtualFileSystem";

export interface RuntimeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface LessonRuntime {
  initialize(): Promise<void>;
  run(command: string): Promise<RuntimeResult>;
  writeFile(path: string, content: string): Promise<void>;
  syncFromVFS(vfs: VirtualFileSystem): Promise<void>;
  reset(): Promise<void>;
  isReady(): boolean;
}

export function createRuntime(
  language: "python" | "javascript"
): LessonRuntime {
  if (language === "python") {
    const { PythonRuntime } = require("./brython-runtime") as typeof import("./brython-runtime");
    return new PythonRuntime();
  }
  if (language === "javascript") {
    const { NodeRuntime } = require("./webcontainer-runtime") as typeof import("./webcontainer-runtime");
    return new NodeRuntime();
  }
  throw new Error(`Unsupported language: ${language}`);
}
