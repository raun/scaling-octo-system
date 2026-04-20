import { VirtualFileSystem } from "../lessons/VirtualFileSystem";
import { LessonRuntime, RuntimeResult } from "./interface";

/**
 * WebContainers runtime for JavaScript/Node.js execution in the browser.
 * Note: WebContainers only work in Chromium-based browsers.
 */
export class NodeRuntime implements LessonRuntime {
  private container: import("@webcontainer/api").WebContainer | null = null;
  private ready = false;

  async initialize(): Promise<void> {
    try {
      const { WebContainer } = await import("@webcontainer/api");
      this.container = await WebContainer.boot();
      this.ready = true;
    } catch (e) {
      console.warn(
        "WebContainers not available (requires Chromium-based browser):",
        e
      );
      throw e;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async run(command: string): Promise<RuntimeResult> {
    if (!this.container) throw new Error("Runtime not initialized");

    const process = await this.container.spawn("sh", ["-c", command]);

    let stdout = "";
    const outputReader = process.output.getReader();

    // Read all output
    while (true) {
      const { done, value } = await outputReader.read();
      if (done) break;
      stdout += value;
    }

    const exitCode = await process.exit;
    return { stdout, stderr: "", exitCode };
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.container) throw new Error("Runtime not initialized");

    // Ensure parent directories exist
    const parts = path.split("/");
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join("/");
      await this.container.spawn("mkdir", ["-p", dir]);
    }

    await this.container.fs.writeFile(path, content);
  }

  async syncFromVFS(vfs: VirtualFileSystem): Promise<void> {
    if (!this.container) throw new Error("Runtime not initialized");

    // Build file tree for mounting
    const tree: Record<string, { file: { contents: string } }> = {};
    for (const [path, content] of vfs.entries()) {
      tree[path] = { file: { contents: content } };
    }
    await this.container.mount(tree);
  }

  async reset(): Promise<void> {
    // WebContainers don't have a simple reset; we'd need to clear files
    // For now, just clear the workspace
    if (!this.container) return;
    try {
      await this.container.spawn("sh", [
        "-c",
        "rm -rf /workspace/* 2>/dev/null || true",
      ]);
    } catch {
      // ignore
    }
  }
}
