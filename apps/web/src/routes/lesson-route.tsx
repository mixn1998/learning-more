import { useNavigate, useParams } from 'react-router-dom';

import { LessonEntryPage } from '../features/learning/lesson-entry-page.js';

export function LessonRoute() {
  const lessonId = useParams().lessonId;
  const navigate = useNavigate();
  if (lessonId === undefined) return <p>课节不存在</p>;
  return <LessonEntryPage lessonId={lessonId} onNavigate={(path) => navigate(path)} />;
}
