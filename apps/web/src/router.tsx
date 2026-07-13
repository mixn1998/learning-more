import { Link, useRoutes, type RouteObject } from 'react-router-dom';

import { RuntimeCenter } from './features/runtime/runtime-center.js';
import { AppShell } from './layouts/app-shell.js';
import { CourseAuthoringRoute } from './routes/course-authoring-route.js';
import { CourseRoute } from './routes/course-route.js';
import { HistoryRoute } from './routes/history-route.js';
import { LessonRoute } from './routes/lesson-route.js';
import { PlanningRoute } from './routes/planning-route.js';
import { ProfileRoute } from './routes/profile-route.js';

function HomeRoute() {
  return (
    <main className="home-page">
      <p className="eyebrow">本地优先学习系统</p>
      <h1>Learning MORE</h1>
      <p>从课程创建、正式学习、Review、排期与历史证据进入你的学习闭环。</p>
    </main>
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
