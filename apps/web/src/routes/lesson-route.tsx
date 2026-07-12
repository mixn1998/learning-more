import { useParams } from 'react-router-dom';

import { SessionPage } from '../features/learning/session-page.js';

export function LessonRoute() {
  const lessonId = useParams().lessonId;
  if (lessonId === undefined) return <p>课节不存在</p>;
  return <SessionPage lessonId={lessonId} />;
}
