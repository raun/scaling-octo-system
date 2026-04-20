/* eslint-disable @typescript-eslint/no-explicit-any */
import { VirtualFileSystem } from "../lessons/VirtualFileSystem";
import { LessonRuntime, RuntimeResult } from "./interface";

function getBrython(): any {
  return (window as any).__BRYTHON__;
}

function brythonLoaded(): boolean {
  return typeof window !== "undefined" && !!(window as any).__BRYTHON__;
}

/**
 * Python execution using Brython — transpiles Python to JavaScript in the browser.
 * Each execution gets a unique module ID to prevent caching issues.
 */
export class PythonRuntime implements LessonRuntime {
  private ready = false;
  private files: Map<string, string> = new Map();
  private execCounter = 0;

  async initialize(): Promise<void> {
    if (typeof window === "undefined") {
      throw new Error("Brython requires a browser environment");
    }

    if (!brythonLoaded()) {
      await this.loadScript(
        "https://cdn.jsdelivr.net/npm/brython@3.13.0/brython.min.js"
      );
      await this.loadScript(
        "https://cdn.jsdelivr.net/npm/brython@3.13.0/brython_stdlib.js"
      );

      const br = getBrython();
      br.options = { debug: 0, indexedDB: false };
      (window as any).brython();
    }

    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async run(command: string): Promise<RuntimeResult> {
    if (!this.ready) throw new Error("Runtime not initialized");

    // Handle "python <filename>" commands — always read the LATEST file content
    let code = command;
    const pythonFileMatch = command.match(/^python3?\s+(.+)$/);
    if (pythonFileMatch) {
      const filename = pythonFileMatch[1].trim();
      const fileContent = this.files.get(filename);
      if (fileContent === undefined) {
        return {
          stdout: "",
          stderr: `python: can't open file '${filename}': [Errno 2] No such file or directory\n`,
          exitCode: 1,
        };
      }
      code = fileContent;
    }

    return this.executePython(code);
  }

  private executePython(code: string): RuntimeResult {
    // Escape the user code for embedding in a Python string
    const escapedCode = code
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");

    // Use a unique key to pass results via window (avoids Brython module namespace issues)
    this.execCounter++;
    const resultKey = `__brython_result_${this.execCounter}`;

    // Wrapper captures stdout/stderr and stores on JS window object
    const wrapper = `
import sys
from io import StringIO
from browser import window

_stdout = StringIO()
_stderr = StringIO()
_old_stdout = sys.stdout
_old_stderr = sys.stderr
sys.stdout = _stdout
sys.stderr = _stderr

try:
    exec('${escapedCode}')
except Exception as _e:
    import traceback
    _stderr.write(traceback.format_exc())
finally:
    sys.stdout = _old_stdout
    sys.stderr = _old_stderr

window.${resultKey} = {'stdout': _stdout.getvalue(), 'stderr': _stderr.getvalue()}
`;

    try {
      const br = getBrython();
      const execId = `_brython_run_${Date.now()}_${this.execCounter}`;
      br.runPythonSource(wrapper, execId);

      // Read results from window
      const result = (window as any)[resultKey];
      delete (window as any)[resultKey];

      const stdout = String(result?.stdout ?? "");
      const stderr = String(result?.stderr ?? "");

      return {
        stdout,
        stderr,
        exitCode: stderr ? 1 : 0,
      };
    } catch (e: unknown) {
      // Clean up
      delete (window as any)[resultKey];
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        stdout: "",
        stderr: errMsg + "\n",
        exitCode: 1,
      };
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async syncFromVFS(vfs: VirtualFileSystem): Promise<void> {
    this.files.clear();
    for (const [path, content] of vfs.entries()) {
      this.files.set(path, content);
    }
  }

  async reset(): Promise<void> {
    this.files.clear();
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }
}
