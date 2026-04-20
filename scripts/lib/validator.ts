import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  ScriptedSection,
  ScriptStep,
  ValidatedSection,
} from "./types";

const MAX_RETRIES = 3;
const MODEL = "claude-sonnet-4-6";

/**
 * Input mock helper that gets injected into Python files before execution.
 * Replaces `input()` with a smart function that detects whether the caller
 * expects a number (via int()/float() wrapping) and returns appropriate values.
 * Falls back to pre-scripted values from a queue.
 */
const PYTHON_INPUT_MOCK = `
import builtins as _builtins
import sys as _sys

_original_input = _builtins.input
_input_queue = []
_input_call_count = 0
_MAX_INPUTS = 150  # Safety: prevent infinite loops (high for guessing games)

def _mock_input(prompt=""):
    global _input_call_count
    _input_call_count += 1

    # Safety valve: if we've been called too many times, raise to break infinite loops
    if _input_call_count > _MAX_INPUTS:
        raise EOFError("Mock input exhausted after " + str(_MAX_INPUTS) + " calls")

    _sys.stdout.write(str(prompt))
    _sys.stdout.flush()

    if _input_queue:
        val = _input_queue.pop(0)
    else:
        val = str(_input_call_count * 3)

    # Check if the caller wraps us in int() or float()
    frame = _sys._getframe(1)
    caller_code = ""
    try:
        import linecache
        filename = frame.f_code.co_filename
        lineno = frame.f_lineno
        caller_code = linecache.getline(filename, lineno)
    except Exception:
        pass

    if "int(" in caller_code or "float(" in caller_code:
        try:
            float(val)
        except (ValueError, TypeError):
            val = str(_input_call_count * 3)

    _sys.stdout.write(str(val) + "\\n")
    return str(val)

_builtins.input = _mock_input
`;

/**
 * Validates lesson code by executing it locally using child_process.
 * Mocks input() with pre-scripted values so interactive code works.
 */
export class Validator {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async validateAll(
    sections: ScriptedSection[],
    language: string
  ): Promise<ValidatedSection[]> {
    const results: ValidatedSection[] = [];

    for (const section of sections) {
      const validated = await this.validateSection(section, language);
      results.push(validated);
    }

    return results;
  }

  private async validateSection(
    section: ScriptedSection,
    language: string,
    attempt = 1
  ): Promise<ValidatedSection> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lesson-validate-"));

    try {
      const validatedSteps: ScriptStep[] = [];

      for (const step of section.steps) {
        if (step.type === "code") {
          if (!step.path || !step.content === undefined) {
            console.warn(
              `[Validator] Skipping malformed code step in section "${section.id}" (missing path or content)`
            );
            continue;
          }
          writeFileToSandbox(tmpDir, step.path, step.content);
          validatedSteps.push(step);
        } else if (step.type === "terminal") {
          if (!step.command) {
            console.warn(
              `[Validator] Skipping malformed terminal step in section "${section.id}" (missing command)`
            );
            continue;
          }

          // Extract expected input values from the terminal step's expected output
          const inputValues = extractInputValues(step, section);

          const { stdout, stderr, exitCode } = runCommand(
            step.command,
            tmpDir,
            language,
            inputValues
          );

          const realOutput = [stdout, stderr]
            .filter(Boolean)
            .join("\n")
            .trim();

          validatedSteps.push({
            type: "terminal",
            command: step.command,
            output: (realOutput || "(no output)") + "\n",
          });

          if (exitCode !== 0) {
            // Check if the error was intentional — the expected output already
            // contains an error/traceback, meaning this section demonstrates an error
            const expectedOutput = step.output || "";
            const isIntentionalError =
              expectedOutput.includes("Error") ||
              expectedOutput.includes("Traceback") ||
              expectedOutput.includes("error") ||
              expectedOutput.includes("Exception");

            if (isIntentionalError) {
              // The section is meant to show this error — validation passes
              console.log(
                `[Validator] Section "${section.id}" error is intentional (expected output contains error), accepting`
              );
            } else {
              const errorInfo = `Command failed (exit ${exitCode}): ${step.command}\n${realOutput}`;
              if (attempt < MAX_RETRIES) {
                console.warn(
                  `[Validator] Section "${section.id}" failed (attempt ${attempt}/${MAX_RETRIES}), asking Claude to fix...`
                );
                const fixedSection = await this.askClaudeToFix(
                  section,
                  errorInfo,
                  language
                );
                if (fixedSection) {
                  return this.validateSection(
                    fixedSection,
                    language,
                    attempt + 1
                  );
                }
              }
              throw new Error(
                `Section "${section.id}" failed after ${MAX_RETRIES} attempts: ${errorInfo}`
              );
            }
          }
        }
      }

      return {
        ...section,
        steps: validatedSteps,
      };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private async askClaudeToFix(
    section: ScriptedSection,
    errorInfo: string,
    language: string
  ): Promise<ScriptedSection | null> {
    try {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: [
          `You are fixing a broken code section in a ${language} lesson.`,
          "The section uses a step-based format with 'code' steps (full file snapshots) and 'terminal' steps.",
          "A terminal command failed. Fix the code steps so the code runs correctly.",
          "IMPORTANT: If the code uses input(), it will be mocked during validation. Do NOT remove input() calls — they will work. Instead fix actual code bugs.",
          "Return the full fixed section as JSON. Wrap your JSON in ```json fences.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              "## Current Section",
              "```json",
              JSON.stringify(section, null, 2),
              "```",
              "",
              "## Error",
              errorInfo,
              "",
              "Return the corrected section JSON with the same structure.",
              "Every code step MUST have 'type', 'path', and 'content' fields.",
              "Every terminal step MUST have 'type', 'command', and 'output' fields.",
            ].join("\n"),
          },
        ],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      const jsonStr = fenceMatch ? fenceMatch[1] : text;

      const parsed = JSON.parse(jsonStr) as ScriptedSection;

      // Validate the response has required fields
      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        console.warn("[Validator] Claude fix response has no steps array");
        return null;
      }
      for (const step of parsed.steps) {
        if (step.type === "code" && (!step.path || step.content === undefined)) {
          console.warn(
            "[Validator] Claude fix response has malformed code step"
          );
          return null;
        }
        if (step.type === "terminal" && !step.command) {
          console.warn(
            "[Validator] Claude fix response has malformed terminal step"
          );
          return null;
        }
      }

      return parsed;
    } catch (e) {
      console.warn(
        `[Validator] Failed to get fix from Claude: ${e instanceof Error ? e.message : e}`
      );
      return null;
    }
  }
}

/**
 * Extract expected input values from a terminal step.
 * Analyzes the code to determine what types input() expects,
 * then provides appropriate mock values.
 */
function extractInputValues(
  termStep: ScriptStep & { type: "terminal" },
  section: ScriptedSection
): string[] {
  const allCode = section.steps
    .filter((s): s is ScriptStep & { type: "code" } => s.type === "code")
    .map((s) => s.content)
    .join("\n");

  const cmd = termStep.command;
  const values: string[] = [];

  // Priority 1: If the code has a while loop with input() inside (game/interactive loop),
  // provide a sweep of all possible values to guarantee the loop terminates.
  const hasLoopWithInput =
    /while\s.*:[\s\S]*?input\s*\(/m.test(allCode) ||
    cmd.includes("game") ||
    cmd.includes("guess");

  if (hasLoopWithInput) {
    for (let n = 1; n <= 100; n++) {
      values.push(String(n));
    }
    return values;
  }

  // Priority 2: Try to extract values from the expected terminal output
  const output = termStep.output || "";
  for (const line of output.split("\n")) {
    const promptMatch = line.match(/^[^:?]+[?:]\s*(.+)$/);
    if (promptMatch) {
      const val = promptMatch[1].trim();
      if (val && val !== "(no output)") {
        values.push(val);
      }
    }
  }
  if (values.length > 0) return values;

  // Priority 3: Analyze code to determine expected input types
  const hasIntInput = /int\s*\(\s*input/.test(allCode);
  const hasFloatInput = /float\s*\(\s*input/.test(allCode);
  const inputCount = (allCode.match(/input\s*\(/g) || []).length;

  const numericDefaults = [25, 42, 10, 75, 50, 30, 100, 5, 60, 15];
  const stringDefaults = ["Alice", "Bob", "hello", "yes", "Python"];

  for (let i = 0; i < Math.max(inputCount, 3); i++) {
    if (hasIntInput || hasFloatInput) {
      values.push(String(numericDefaults[i % numericDefaults.length]));
    } else {
      values.push(stringDefaults[i % stringDefaults.length]);
    }
  }

  return values;
}

function writeFileToSandbox(
  sandboxDir: string,
  filePath: string,
  content: string
) {
  const fullPath = path.join(sandboxDir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

/**
 * Run a command in the sandbox directory.
 * For Python files that use input(), injects an input mock
 * that feeds pre-scripted values.
 */
function runCommand(
  command: string,
  cwd: string,
  language: string,
  inputValues: string[] = []
): { stdout: string; stderr: string; exitCode: number } {
  // For Python commands, always inject input mock to handle input() calls gracefully
  const isPythonRun = /^python3?\s+/.test(command);
  if (isPythonRun && language === "python") {
    // Check if any file in cwd uses input()
    const targetMatch = command.match(/^python3?\s+(.+)$/);
    if (targetMatch) {
      const targetPath = path.join(cwd, targetMatch[1].trim());
      try {
        const fileContent = fs.readFileSync(targetPath, "utf-8");
        if (fileContent.includes("input(")) {
          return runPythonWithMockedInput(command, cwd, inputValues);
        }
      } catch {
        // file doesn't exist yet or can't be read — fall through
      }
    }
  }

  try {
    const stdout = execSync(command, {
      cwd,
      timeout: 30_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
      },
    });
    return { stdout: stdout ?? "", stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number;
    };
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      exitCode: e.status ?? 1,
    };
  }
}

/**
 * Run a Python file with input() mocked to return pre-scripted values.
 * Creates a wrapper script that patches builtins.input before running the target.
 */
function runPythonWithMockedInput(
  command: string,
  cwd: string,
  inputValues: string[]
): { stdout: string; stderr: string; exitCode: number } {
  // Extract the target filename from "python3 <file>"
  const match = command.match(/^python3?\s+(.+)$/);
  if (!match) {
    return { stdout: "", stderr: "Invalid python command", exitCode: 1 };
  }
  const targetFile = match[1].trim();

  // Create a wrapper script that mocks input() and then runs the target
  const valuesJson = JSON.stringify(inputValues);
  const wrapperCode = `${PYTHON_INPUT_MOCK}
_input_queue.extend(${valuesJson})

# Run the target file
with open("${targetFile}") as _f:
    _code = _f.read()
exec(_code)
`;

  const wrapperPath = path.join(cwd, "_validate_wrapper.py");
  fs.writeFileSync(wrapperPath, wrapperCode);

  try {
    const pythonCmd = command.startsWith("python3") ? "python3" : "python";
    const stdout = execSync(`${pythonCmd} _validate_wrapper.py`, {
      cwd,
      timeout: 30_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
      },
    });
    return { stdout: stdout ?? "", stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number;
    };
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      exitCode: e.status ?? 1,
    };
  } finally {
    // Clean up wrapper
    try {
      fs.unlinkSync(wrapperPath);
    } catch {
      // ignore
    }
  }
}
