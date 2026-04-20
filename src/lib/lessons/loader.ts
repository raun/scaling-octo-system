import { Lesson, LessonIndex } from "./types";

export async function loadLessonIndex(): Promise<LessonIndex> {
  const res = await fetch("/lessons/index.json");
  if (!res.ok) throw new Error("Failed to load lesson index");
  return res.json();
}

export async function loadLesson(lessonId: string): Promise<Lesson> {
  const res = await fetch(`/lessons/${lessonId}/lesson.json`);
  if (!res.ok) throw new Error(`Failed to load lesson: ${lessonId}`);
  return res.json();
}
