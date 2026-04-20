import type { Terminal } from "@xterm/xterm";
import { LessonRuntime } from "./interface";

/**
 * Connects an xterm.js Terminal to an in-browser LessonRuntime.
 * Handles user input, command execution, and output display.
 * Returns a disconnect function.
 */
export function connectTerminalToRuntime(
  terminal: Terminal,
  runtime: LessonRuntime
): () => void {
  let currentLine = "";
  let isRunning = false;

  terminal.write("\r\n$ ");

  const disposable = terminal.onData((data) => {
    if (isRunning) return; // Ignore input while command is running

    if (data === "\r") {
      // Enter key
      terminal.write("\r\n");
      const command = currentLine.trim();
      currentLine = "";

      if (command === "") {
        terminal.write("$ ");
        return;
      }

      if (command === "clear") {
        terminal.clear();
        terminal.write("$ ");
        return;
      }

      isRunning = true;
      runtime
        .run(command)
        .then((result) => {
          if (result.stdout) {
            // Ensure proper line endings for xterm
            const output = result.stdout.replace(/\n/g, "\r\n");
            terminal.write(output);
            if (!output.endsWith("\r\n")) terminal.write("\r\n");
          }
          if (result.stderr) {
            const errOutput = result.stderr.replace(/\n/g, "\r\n");
            terminal.write(`\x1b[31m${errOutput}\x1b[0m`);
            if (!errOutput.endsWith("\r\n")) terminal.write("\r\n");
          }
        })
        .catch((e) => {
          terminal.write(`\x1b[31mError: ${e.message}\x1b[0m\r\n`);
        })
        .finally(() => {
          isRunning = false;
          terminal.write("$ ");
        });
    } else if (data === "\x7f" || data === "\b") {
      // Backspace
      if (currentLine.length > 0) {
        currentLine = currentLine.slice(0, -1);
        terminal.write("\b \b");
      }
    } else if (data === "\x03") {
      // Ctrl+C
      currentLine = "";
      terminal.write("^C\r\n$ ");
    } else if (data >= " " || data === "\t") {
      // Printable characters
      currentLine += data;
      terminal.write(data);
    }
  });

  // Return disconnect function
  return () => {
    disposable.dispose();
  };
}
