import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import type { LessonOptions, LessonPlan, ReviewResult } from "./types";

const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "prompts", "plan-reviewer.md"),
  "utf-8"
);

const MODEL = "claude-sonnet-4-6";

export class PlanReviewer {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async review(
    plan: LessonPlan,
    topic: string,
    options: LessonOptions
  ): Promise<ReviewResult> {
    const userMessage = [
      "# Review This Lesson Plan",
      "",
      `Topic: ${topic}`,
      `Language: ${options.language}`,
      `Difficulty: ${options.difficulty}`,
      `Target duration: ${options.targetDuration} minutes`,
      "",
      "## Plan",
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
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = extractText(response);
    const result = parseJsonFromResponse<ReviewResult>(text);

    // Enforce: any score < 3 must result in rejection
    if (result.score) {
      for (const [criterion, score] of Object.entries(result.score)) {
        if (score < 3) {
          result.approved = false;
          const hasBlocker = result.feedback.some(
            (f) => f.category === criterion && f.severity === "blocker"
          );
          if (!hasBlocker) {
            result.feedback.push({
              category: criterion,
              severity: "blocker",
              issue: `Score of ${score}/5 is below the minimum threshold of 3`,
              recommendation: `Improve ${criterion.replace(/_/g, " ")} to at least a 3/5`,
            });
          }
        }
      }
    }

    // Enforce: approved only if no blockers
    const hasBlockers = result.feedback.some((f) => f.severity === "blocker");
    if (hasBlockers) {
      result.approved = false;
    }

    return result;
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
