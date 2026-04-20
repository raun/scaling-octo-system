import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import type { AssembledLesson, ReviewResult } from "./types";

const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "prompts", "final-reviewer.md"),
  "utf-8"
);

const MODEL = "claude-sonnet-4-6";

export class FinalReviewer {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async review(lesson: AssembledLesson): Promise<ReviewResult> {
    const userMessage = [
      "# Review This Assembled Lesson",
      "",
      JSON.stringify(lesson, null, 2),
    ].join("\n");

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = extractText(response);
    const raw = parseJsonFromResponse<{
      approved: boolean;
      quality_score: number;
      feedback: Array<{
        category: string;
        severity: "blocker" | "warning" | "suggestion";
        section: string;
        issue: string;
        recommendation: string;
        route_to: "plan" | "script" | "assembly";
      }>;
    }>(text);

    // Enforce: quality_score < 7 or any blockers = rejection
    const hasBlockers = raw.feedback.some((f) => f.severity === "blocker");
    const approved = raw.quality_score >= 7 && !hasBlockers;

    return {
      approved,
      quality_score: raw.quality_score,
      feedback: raw.feedback.map((f) => ({
        section: f.section,
        category: f.category,
        severity: f.severity,
        issue: f.issue,
        recommendation: f.recommendation,
        route_to: f.route_to,
      })),
    };
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
