import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import type { LessonOptions, LessonPlan, ReviewFeedbackItem } from "./types";

const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "prompts", "planner.md"),
  "utf-8"
);

const MODEL = "claude-sonnet-4-6";

export class Planner {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async plan(topic: string, options: LessonOptions): Promise<LessonPlan> {
    const userMessage = [
      `Topic: ${topic}`,
      `Language: ${options.language}`,
      `Difficulty: ${options.difficulty}`,
      `Target duration: ${options.targetDuration} minutes`,
    ].join("\n");

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const plan = parseJsonFromResponse<LessonPlan>(text);
    validatePlan(plan);
    return plan;
  }

  async revise(
    currentPlan: LessonPlan,
    feedback: ReviewFeedbackItem[]
  ): Promise<LessonPlan> {
    const userMessage = [
      "# Current Lesson Plan",
      "",
      "```json",
      JSON.stringify(currentPlan, null, 2),
      "```",
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
      "Return the revised lesson plan as JSON. Keep the same structure.",
    ].join("\n");

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const plan = parseJsonFromResponse<LessonPlan>(text);
    validatePlan(plan);
    return plan;
  }
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

function validatePlan(plan: LessonPlan): void {
  if (!plan.title || !plan.description) {
    throw new Error("Plan is missing title or description");
  }
  if (!Array.isArray(plan.sections) || plan.sections.length < 3 || plan.sections.length > 6) {
    throw new Error(
      `Plan must have 3-6 sections, got ${plan.sections?.length ?? 0}`
    );
  }
  for (const section of plan.sections) {
    if (!section.label || !section.objective || !section.approach) {
      throw new Error(
        `Section "${section.label ?? "(unnamed)"}" is missing required fields`
      );
    }
  }
}
