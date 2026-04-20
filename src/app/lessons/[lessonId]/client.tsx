"use client";

import { useEffect, useState, use } from "react";
import { Lesson } from "@/lib/lessons/types";
import { loadLesson } from "@/lib/lessons/loader";
import { LessonPlayer } from "@/components/player/LessonPlayer";

export function LessonPageClient({
  paramsPromise,
}: {
  paramsPromise: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = use(paramsPromise);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLesson(lessonId)
      .then(setLesson)
      .catch((e) => setError(e.message));
  }, [lessonId]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#1e1e1e] text-red-400">
        <p>Error: {error}</p>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#1e1e1e] text-[#888]">
        <p>Loading lesson...</p>
      </div>
    );
  }

  return <LessonPlayer lesson={lesson} />;
}
