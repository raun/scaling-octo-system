import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import type {
  LessonPlan,
  ReviewFeedbackItem,
  ScriptedLesson,
  ScriptedSection,
} from "./types";

const PASS1_PROMPT = readFileSync(
  join(__dirname, "prompts", "scripter-pass1.md"),
  "utf-8"
);
const PASS2_PROMPT = readFileSync(
  join(__dirname, "prompts", "scripter-pass2.md"),
  "utf-8"
);

const MODEL = "claude-sonnet-4-6";

export class Scripter {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  /** Full two-pass generation: code steps then narration. */
  async script(plan: LessonPlan): Promise<ScriptedLesson> {
    const codeSections = await this.pass1(plan);
    const lesson = await this.pass2(plan, codeSections);
    return lesson;
  }

  /** Pass 1: Generate code steps (no narration). */
  async pass1(plan: LessonPlan): Promise<ScriptedSection[]> {
    const userMessage = [
      "# Lesson Plan",
      "",
      `Title: ${plan.title}`,
      `Description: ${plan.description}`,
      `Prerequisites: ${plan.prerequisites.join(", ")}`,
      "",
      "## Sections",
      "",
      ...plan.sections.map(
        (s, i) =>
          [
            `### ${i + 1}. ${s.label}`,
            `- Objective: ${s.objective}`,
            `- Approach: ${s.approach}`,
            `- Builds on previous: ${s.builds_on_previous}`,
          ].join("\n")
      ),
    ].join("\n");

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: PASS1_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = extractText(response);
    const parsed = parseJsonFromResponse<{ sections: ScriptedSection[] }>(text);
    validatePass1(parsed.sections, plan);
    return parsed.sections;
  }

  /** Pass 2: Generate narration for each section given the code steps. */
  async pass2(
    plan: LessonPlan,
    codeSections: ScriptedSection[]
  ): Promise<ScriptedLesson> {
    const userMessage = [
      "# Lesson Context",
      "",
      `Title: ${plan.title}`,
      `Description: ${plan.description}`,
      "",
      "# Sections with Code Steps",
      "",
      JSON.stringify(codeSections, null, 2),
    ].join("\n");

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: PASS2_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = extractText(response);
    const parsed = parseJsonFromResponse<{
      sections: { id: string; narration: string }[];
    }>(text);

    // Merge narration into code sections
    const narrationMap = new Map(
      parsed.sections.map((s) => [s.id, s.narration])
    );

    const sections: ScriptedSection[] = codeSections.map((section) => ({
      ...section,
      narration: narrationMap.get(section.id) ?? "",
    }));

    for (const section of sections) {
      if (!section.narration) {
        throw new Error(
          `Section "${section.id}" is missing narration after Pass 2`
        );
      }
    }

    return { sections };
  }

  async revise(
    currentScript: ScriptedLesson,
    plan: LessonPlan,
    feedback: ReviewFeedbackItem[]
  ): Promise<ScriptedLesson> {
    const userMessage = [
      "# Current Scripted Lesson",
      "",
      "```json",
      JSON.stringify(currentScript, null, 2),
      "```",
      "",
      "# Original Plan",
      "",
      `Title: ${plan.title}`,
      `Description: ${plan.description}`,
      "",
      "# Reviewer Feedback",
      "",
      "The following issues were identified. Fix ALL blockers and address suggestions where possible.",
      "",
      ...feedback.map(
        (f, i) =>
          [
            `## Issue ${i + 1} (${f.severity})`,
            `- Section: ${f.section ?? "overall"}`,
            `- Category: ${f.category}`,
            `- Issue: ${f.issue}`,
            `- Recommendation: ${f.recommendation}`,
          ].join("\n")
      ),
      "",
      "Return the revised scripted lesson as JSON with the full sections array.",
      "Keep the same structure: { sections: [{ id, label, narration, steps }] }",
    ].join("\n");

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: [PASS1_PROMPT, PASS2_PROMPT].join("\n\n---\n\n"),
      messages: [{ role: "user", content: userMessage }],
    });

    const text = extractText(response);
    const parsed = parseJsonFromResponse<ScriptedLesson>(text);

    if (
      !parsed.sections ||
      parsed.sections.length !== plan.sections.length
    ) {
      throw new Error(
        `Revised script has ${parsed.sections?.length ?? 0} sections but plan has ${plan.sections.length}`
      );
    }

    for (const section of parsed.sections) {
      if (!section.id || !section.steps || !section.narration) {
        throw new Error(
          `Revised section "${section.id ?? "(unnamed)"}" is missing required fields`
        );
      }
    }

    return parsed;
  }
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function parseJsonFromResponse<T>(text: string): T {
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const jsonStr = fenceMatch ? fenceMatch[1] : text;

  try {
    return JSON.parse(jsonStr) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from LLM response: ${(err as Error).message}\n\nRaw text:\n${text.slice(0, 500)}`
    );
  }
}

function validatePass1(
  sections: ScriptedSection[],
  plan: LessonPlan
): void {
  if (sections.length !== plan.sections.length) {
    throw new Error(
      `Pass 1 produced ${sections.length} sections but plan has ${plan.sections.length}`
    );
  }
  for (const section of sections) {
    if (!section.id || !section.steps) {
      throw new Error(
        `Section "${section.id ?? "(unnamed)"}" is missing required fields`
      );
    }
    if (section.steps.length === 0) {
      throw new Error(
        `Section "${section.id}" has no steps`
      );
    }
  }
}
