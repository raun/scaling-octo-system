"use client";

import Link from "next/link";
import { useState } from "react";
import lessonsIndex from "../../public/lessons/index.json";

type LessonMeta = (typeof lessonsIndex.lessons)[0];

export default function Home() {
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const languages = [...new Set(lessonsIndex.lessons.map((l) => l.language))];
  const difficulties = [
    ...new Set(lessonsIndex.lessons.map((l) => l.difficulty)),
  ];

  const filtered = lessonsIndex.lessons.filter((lesson: LessonMeta) => {
    if (languageFilter !== "all" && lesson.language !== languageFilter)
      return false;
    if (difficultyFilter !== "all" && lesson.difficulty !== difficultyFilter)
      return false;
    if (
      search &&
      !lesson.title.toLowerCase().includes(search.toLowerCase()) &&
      !lesson.description.toLowerCase().includes(search.toLowerCase()) &&
      !lesson.tags.some((t: string) =>
        t.toLowerCase().includes(search.toLowerCase())
      )
    )
      return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-[#cccccc]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-2 text-3xl font-bold text-white">Lessons</h1>
        <p className="mb-6 text-[#888]">
          Interactive coding lessons with narrated walkthroughs. Pause anytime to
          edit code and run it in your browser.
        </p>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search lessons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-[#444] bg-[#2d2d2d] px-4 py-2 text-base text-white placeholder-[#666] focus:border-[#0078d4] focus:outline-none"
          />

          {languages.length > 1 && (
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              className="rounded-lg border border-[#444] bg-[#2d2d2d] px-4 py-2 text-base text-white focus:border-[#0078d4] focus:outline-none"
            >
              <option value="all">All languages</option>
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          )}

          {difficulties.length > 1 && (
            <select
              value={difficultyFilter}
              onChange={(e) => setDifficultyFilter(e.target.value)}
              className="rounded-lg border border-[#444] bg-[#2d2d2d] px-4 py-2 text-base text-white focus:border-[#0078d4] focus:outline-none"
            >
              <option value="all">All difficulties</option>
              {difficulties.map((diff) => (
                <option key={diff} value={diff}>
                  {diff}
                </option>
              ))}
            </select>
          )}

          <span className="text-sm text-[#888]">
            {filtered.length} lesson{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Lesson cards */}
        <div className="flex flex-col gap-4">
          {filtered.map((lesson: LessonMeta) => (
            <Link
              key={lesson.id}
              href={`/lessons/${lesson.id}`}
              className="rounded-lg border border-[#333] bg-[#252526] p-5 transition-colors hover:border-[#555] hover:bg-[#2d2d2d]"
            >
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-xl font-semibold text-white">
                  {lesson.title}
                </h2>
                <span className="rounded-full bg-[#0078d4] px-3 py-1 text-sm text-white">
                  {lesson.language}
                </span>
                <span className="rounded-full bg-[#333] px-3 py-1 text-sm text-[#aaa]">
                  {lesson.difficulty}
                </span>
              </div>
              <p className="text-base text-[#999]">{lesson.description}</p>
              <div className="mt-3 flex gap-2">
                {lesson.tags.map((tag: string) => (
                  <span key={tag} className="text-sm text-[#666]">
                    #{tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}

          {filtered.length === 0 && (
            <p className="py-8 text-center text-[#666]">
              No lessons match your filters.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
