#!/usr/bin/env npx tsx

/**
 * Generate a full course by first planning topics with an LLM, then generating each lesson.
 *
 * Usage:
 *   npx tsx scripts/generate-course.ts "Introduction to Python" --lessons 5 --difficulty beginner
 */

import Anthropic from "@anthropic-ai/sdk";
import { LeadAgent } from "./lib/lead-agent";
import { Assembler } from "./lib/assembler";
import { LessonOptions } from "./lib/types";
import * as fs from "fs";
import * as path from "path";

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`
Usage: npx tsx scripts/generate-course.ts <course-title> [options]

Options:
  --lessons <count>        Number of lessons to generate (default: 5)
  --language <lang>        Language (default: python)
  --difficulty <level>     Difficulty (default: beginner)
  --duration <minutes>     Target duration per lesson (default: 1)
`);
    process.exit(0);
  }

  const courseTitle = args[0];
  let lessons = 5;
  let language: "python" | "javascript" = "python";
  let difficulty: "beginner" | "intermediate" | "advanced" = "beginner";
  let targetDuration = 1;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--lessons" && args[i + 1]) lessons = parseInt(args[++i]);
    else if (args[i] === "--language" && args[i + 1])
      language = args[++i] as "python" | "javascript";
    else if (args[i] === "--difficulty" && args[i + 1])
      difficulty = args[++i] as "beginner" | "intermediate" | "advanced";
    else if (args[i] === "--duration" && args[i + 1])
      targetDuration = parseFloat(args[++i]);
  }

  return {
    courseTitle,
    lessonCount: lessons,
    options: { language, difficulty, targetDuration } as LessonOptions,
  };
}

async function planCourse(
  courseTitle: string,
  lessonCount: number,
  options: LessonOptions
): Promise<string[]> {
  console.log(`[CoursePlanner] Planning ${lessonCount} topics for "${courseTitle}"...`);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `You are a curriculum designer. Create a course outline for "${courseTitle}" with exactly ${lessonCount} lessons.

Language: ${options.language}
Difficulty: ${options.difficulty}

Return a JSON array of lesson topic strings. Each topic should be specific enough to be a standalone 1-2 minute interactive coding lesson. Order them from simplest to most complex. Each topic builds on the previous ones.

Return ONLY a JSON array of strings, like:
\`\`\`json
["Topic 1", "Topic 2", "Topic 3"]
\`\`\``,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Failed to parse course topics from LLM");

  const topics: string[] = JSON.parse(jsonMatch[1] || jsonMatch[0]);
  return topics;
}

async function main() {
  const { courseTitle, lessonCount, options } = parseArgs();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log(`Course: "${courseTitle}"`);
  console.log(`Lessons: ${lessonCount} | Language: ${options.language} | Difficulty: ${options.difficulty}`);
  console.log("=".repeat(60));

  // Step 1: Plan course topics
  const topics = await planCourse(courseTitle, lessonCount, options);
  console.log(`\n[CoursePlanner] Planned ${topics.length} topics:`);
  topics.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  console.log();

  // Step 2: Generate each lesson
  const results: { topic: string; status: "ok" | "failed"; error?: string }[] = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${i + 1}/${topics.length}] "${topic}"`);
    console.log("=".repeat(60));

    try {
      const leadAgent = new LeadAgent();
      const result = await leadAgent.generateLesson(topic, options);
      const assembler = new Assembler();
      assembler.writeToDisk(result.lesson, result.clips, options);

      const lessonDir = path.join(
        process.cwd(),
        "public",
        "lessons",
        result.lesson.id
      );
      fs.writeFileSync(
        path.join(lessonDir, "pipeline-log.json"),
        JSON.stringify(leadAgent.log, null, 2)
      );

      results.push({ topic, status: "ok" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ topic, status: "failed", error: msg });
      console.error(`FAILED: ${msg}`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`Course "${courseTitle}" Generation Summary:`);
  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`  Succeeded: ${ok}/${topics.length}`);
  console.log(`  Failed: ${failed}/${topics.length}`);

  if (failed > 0) {
    console.log("\nFailed lessons:");
    for (const r of results.filter((r) => r.status === "failed")) {
      console.log(`  - ${r.topic}: ${r.error}`);
    }
  }

  console.log(`\nPreview: npm run dev → http://localhost:3000`);
}

main();
