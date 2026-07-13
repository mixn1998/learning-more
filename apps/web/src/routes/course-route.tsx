import { useNavigate, useParams } from 'react-router-dom';

import { CoursePage } from '../features/review/course-page.js';

export function CourseRoute() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  if (courseId === undefined) return <p role="alert">课程不存在</p>;
  return (
    <CoursePage
      courseId={courseId}
      onDeleted={(notice) => navigate('/', { replace: true, state: { notice } })}
    />
  );
}
