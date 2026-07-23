import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { CoursePage, type CoursePageView } from '../features/review/course-page.js';

export function CourseRoute() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  if (courseId === undefined) return <p role="alert">课程不存在</p>;
  const requestedView = searchParams.get('view');
  const view: CoursePageView =
    requestedView === 'revision' || requestedView === 'review' ? requestedView : 'outline';
  return (
    <CoursePage
      courseId={courseId}
      view={view}
      onNavigate={(path) => navigate(path)}
      onDeleted={(notice) => navigate('/', { replace: true, state: { notice } })}
    />
  );
}
