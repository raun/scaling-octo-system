import lessonsIndex from "../../../../public/lessons/index.json";
import { LessonPageClient } from "./client";

export function generateStaticParams() {
  return lessonsIndex.lessons.map((lesson) => ({
    lessonId: lesson.id,
  }));
}

export default function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  return <LessonPageClient paramsPromise={params} />;
}
