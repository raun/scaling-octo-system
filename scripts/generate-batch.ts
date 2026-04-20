#!/usr/bin/env npx tsx

/**
 * Generate multiple lessons from a topics file.
 *
 * Usage:
 *   npx tsx scripts/generate-batch.ts --file topics.txt --language python --difficulty beginner
 *
 * topics.txt format (one topic per line):
 *   Python list comprehensions
 *   Python decorators
 *   Python generators
 */

import * as fs from "fs";
import { LeadAgent } from "./lib/lead-agent";
import { Assembler } from "./lib/assembler";
import { LessonOptions } from "./lib/types";
import * as path from "path";

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help") {
    console.log(`
Usage: npx tsx scripts/generate-batch.ts --file <topics.txt> [options]

Options:
  --file <path>            File with one topic per line (required)
  --language <lang>        Language (default: python)
  --difficulty <level>     Difficulty (default: beginner)
  --duration <minutes>     Target duration per lesson (default: 1)
`);
    process.exit(0);
  }

  let file = "";
  let language: "python" | "javascript" = "python";
  let difficulty: "beginner" | "intermediate" | "advanced" = "beginner";
  let targetDuration = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) file = args[++i];
    else if (args[i] === "--language" && args[i + 1])
      language = args[++i] as "python" | "javascript";
    else if (args[i] === "--difficulty" && args[i + 1])
      difficulty = args[++i] as "beginner" | "intermediate" | "advanced";
    else if (args[i] === "--duration" && args[i + 1])
      targetDuration = parseFloat(args[++i]);
  }

  if (!file) {
    console.error("Error: --file is required");
    process.exit(1);
  }

  const topics = fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  return { topics, options: { language, difficulty, targetDuration } as LessonOptions };
}

async function main() {
  const { topics, options } = parseArgs();

  console.log(`Batch generating ${topics.length} lessons`);
  console.log("=".repeat(60));

  const results: { topic: string; status: "ok" | "failed"; error?: string }[] = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    console.log(`\n[${i + 1}/${topics.length}] "${topic}"`);
    console.log("-".repeat(40));

    try {
      const leadAgent = new LeadAgent();
      const result = await leadAgent.generateLesson(topic, options);
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

      results.push({ topic, status: "ok" });
      console.log(`[${i + 1}/${topics.length}] "${topic}" - Done`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ topic, status: "failed", error: msg });
      console.error(`[${i + 1}/${topics.length}] "${topic}" - FAILED: ${msg}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Batch Summary:");
  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`  Succeeded: ${ok}/${topics.length}`);
  console.log(`  Failed: ${failed}/${topics.length}`);

  if (failed > 0) {
    console.log("\nFailed topics:");
    for (const r of results.filter((r) => r.status === "failed")) {
      console.log(`  - ${r.topic}: ${r.error}`);
    }
    process.exit(1);
  }
}

main();
