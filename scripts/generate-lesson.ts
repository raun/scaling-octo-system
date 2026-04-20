#!/usr/bin/env npx tsx

/**
 * CLI entry point for generating lessons.
 *
 * Usage:
 *   npx tsx scripts/generate-lesson.ts "Python list comprehensions" --language python --difficulty beginner
 *   npx tsx scripts/generate-lesson.ts "JavaScript promises" --language javascript --difficulty intermediate --duration 2
 *   npx tsx scripts/generate-lesson.ts "Python decorators" # defaults: python, beginner, 1 min
 */

import { LeadAgent } from "./lib/lead-agent";
import { Assembler } from "./lib/assembler";
import { LessonOptions } from "./lib/types";
import * as fs from "fs";
import * as path from "path";

function parseArgs(): { topic: string; options: LessonOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Usage: npx tsx scripts/generate-lesson.ts <topic> [options]

Options:
  --language <python|javascript>   Language (default: python)
  --difficulty <beginner|intermediate|advanced>  Difficulty (default: beginner)
  --duration <minutes>             Target duration in minutes (default: 1)

Examples:
  npx tsx scripts/generate-lesson.ts "Python list comprehensions"
  npx tsx scripts/generate-lesson.ts "JavaScript promises" --language javascript --difficulty intermediate
`);
    process.exit(0);
  }

  const topic = args[0];
  let language: "python" | "javascript" = "python";
  let difficulty: "beginner" | "intermediate" | "advanced" = "beginner";
  let targetDuration = 1;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--language" && args[i + 1]) {
      language = args[++i] as "python" | "javascript";
    } else if (args[i] === "--difficulty" && args[i + 1]) {
      difficulty = args[++i] as "beginner" | "intermediate" | "advanced";
    } else if (args[i] === "--duration" && args[i + 1]) {
      targetDuration = parseFloat(args[++i]);
    }
  }

  return { topic, options: { language, difficulty, targetDuration } };
}

function checkEnvVars() {
  const required = ["ANTHROPIC_API_KEY"];
  const optional = ["OPENAI_API_KEY"];
  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Set them in your shell or in a .env file");
    process.exit(1);
  }

  for (const key of optional) {
    if (!process.env[key]) {
      console.warn(`Warning: ${key} not set. Some features may be skipped.`);
    }
  }
}

async function main() {
  const { topic, options } = parseArgs();
  checkEnvVars();

  console.log("=".repeat(60));
  console.log(`Generating lesson: "${topic}"`);
  console.log(`Language: ${options.language} | Difficulty: ${options.difficulty} | Duration: ${options.targetDuration}m`);
  console.log("=".repeat(60));
  console.log();

  const startTime = Date.now();

  try {
    const leadAgent = new LeadAgent();
    const result = await leadAgent.generateLesson(topic, options);

    // Write to disk
    const assembler = new Assembler();
    assembler.writeToDisk(result.lesson, result.clips, options);

    // Write pipeline log
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

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log();
    console.log("=".repeat(60));
    console.log(`Lesson generated successfully in ${elapsed}s`);
    console.log(`Output: public/lessons/${result.lesson.id}/`);
    console.log(`  - lesson.json`);
    console.log(`  - ${result.clips.length} audio files`);
    console.log(`  - metadata.json`);
    console.log(`  - pipeline-log.json`);
    console.log();
    console.log(`Preview: npm run dev → http://localhost:3000/lessons/${result.lesson.id}`);
    console.log("=".repeat(60));
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error();
    console.error(`Pipeline failed after ${elapsed}s`);
    console.error(error);
    process.exit(1);
  }
}

main();
