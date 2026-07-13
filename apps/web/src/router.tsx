import { Link, useLocation, useNavigate, useRoutes, type RouteObject } from 'react-router-dom';

import { HomePage } from './features/home/home-page.js';
import { RuntimeCenter } from './features/runtime/runtime-center.js';
import { AppShell } from './layouts/app-shell.js';
import { CourseAuthoringRoute } from './routes/course-authoring-route.js';
import { CourseRoute } from './routes/course-route.js';
import { HistoryRoute } from './routes/history-route.js';
import { LessonRoute } from './routes/lesson-route.js';
import { LessonRecordRoute } from './routes/lesson-record-route.js';
import { PlanningRoute } from './routes/planning-route.js';
import { ProfileRoute } from './routes/profile-route.js';

function HomeRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  return (
    <HomePage onNavigate={(path) => navigate(path)} {...(notice === undefined ? {} : { notice })} />
  );
}

function NotFoundRoute() {
  return (
    <main className="not-found-page">
      <h1>页面不存在</h1>
      <Link to="/">返回首页</Link>
    </main>
  );
}

export const appRouteDefinitions: RouteObject[] = [
  {
    id: 'app-shell',
    path: '/',
    element: <AppShell />,
    children: [
      { id: 'home', index: true, element: <HomeRoute /> },
      { id: 'course-new', path: 'courses/new', element: <CourseAuthoringRoute /> },
      { id: 'course', path: 'courses/:courseId', element: <CourseRoute /> },
      {
        id: 'lesson',
        path: 'courses/:courseId/lessons/:lessonId',
        element: <LessonRoute />,
      },
      {
        id: 'lesson-record',
        path: 'courses/:courseId/lessons/:lessonId/record',
        element: <LessonRecordRoute />,
      },
      { id: 'lesson-legacy', path: 'lessons/:lessonId', element: <LessonRoute /> },
      { id: 'planning', path: 'planning', element: <PlanningRoute /> },
      { id: 'history', path: 'history', element: <HistoryRoute /> },
      { id: 'profile', path: 'profile', element: <ProfileRoute /> },
      { id: 'runtime', path: 'runtime', element: <RuntimeCenter /> },
      { id: 'not-found', path: '*', element: <NotFoundRoute /> },
    ],
  },
];

export function AppRoutes() {
  return useRoutes(appRouteDefinitions);
}
