import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import type { LessonPlan, ReviewResult, ScriptedLesson } from "./types";

const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "prompts", "script-reviewer.md"),
  "utf-8"
);

const MODEL = "claude-sonnet-4-6";

export class ScriptReviewer {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async review(
    script: ScriptedLesson,
    plan: LessonPlan
  ): Promise<ReviewResult> {
    const userMessage = [
      "# Review This Scripted Lesson",
      "",
      "## Original Plan",
      "",
      `Title: ${plan.title}`,
      `Description: ${plan.description}`,
      "",
      "## Scripted Sections",
      "",
      JSON.stringify(script.sections, null, 2),
    ].join("\n");

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = extractText(response);
    const raw = parseJsonFromResponse<{
      approved: boolean;
      issues: Array<{
        section_id: string;
        category: string;
        severity: "blocker" | "warning" | "suggestion";
        location: string;
        issue: string;
        recommendation: string;
      }>;
    }>(text);

    // Normalize to ReviewResult format
    const feedback = raw.issues.map((issue) => ({
      section: issue.section_id,
      category: issue.category,
      severity: issue.severity,
      issue: issue.issue,
      recommendation: issue.recommendation,
    }));

    // Enforce: sync issues are always blockers
    for (const item of feedback) {
      if (item.category === "sync" && item.severity !== "blocker") {
        item.severity = "blocker";
      }
    }

    const hasBlockers = feedback.some((f) => f.severity === "blocker");

    return {
      approved: !hasBlockers,
      feedback,
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
