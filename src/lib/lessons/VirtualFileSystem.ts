export class VirtualFileSystem {
  private files: Map<string, string> = new Map();
  private listeners: Set<() => void> = new Set();

  createFile(path: string, content: string) {
    this.files.set(path, content);
    this.notify();
  }

  readFile(path: string): string | undefined {
    return this.files.get(path);
  }

  writeFile(path: string, content: string) {
    this.files.set(path, content);
    this.notify();
  }

  deleteFile(path: string) {
    this.files.delete(path);
    this.notify();
  }

  listFiles(): string[] {
    return Array.from(this.files.keys()).sort();
  }

  entries(): IterableIterator<[string, string]> {
    return this.files.entries();
  }

  clear() {
    this.files.clear();
    this.notify();
  }

  restoreFromCheckpoint(files: Record<string, string>) {
    this.files.clear();
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, content);
    }
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
