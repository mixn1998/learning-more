import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useRoutes, type RouteObject } from 'react-router-dom';

import type { HomeDashboardView } from '@learning-more/contracts';

import { HomePage } from './features/home/home-page.js';
import { AppShell } from './layouts/app-shell.js';
import type { AuthoringLocationState } from './state/authoring-start-intent.js';
import { scheduleSnapshotCache } from './state/dashboard-query-caches.js';
import { homeDashboardCache } from './state/home-dashboard-cache.js';
import { useRuntimeState } from './state/version-guard.js';

const CourseAuthoringRoute = lazy(async () => ({
  default: (await import('./routes/course-authoring-route.js')).CourseAuthoringRoute,
}));
const CourseRoute = lazy(async () => ({
  default: (await import('./routes/course-route.js')).CourseRoute,
}));
const LessonRoute = lazy(async () => ({
  default: (await import('./routes/lesson-route.js')).LessonRoute,
}));
const LessonRecordRoute = lazy(async () => ({
  default: (await import('./routes/lesson-record-route.js')).LessonRecordRoute,
}));
const PlanningRoute = lazy(async () => ({
  default: (await import('./routes/planning-route.js')).PlanningRoute,
}));
const HistoryRoute = lazy(async () => ({
  default: (await import('./routes/history-route.js')).HistoryRoute,
}));
const NotesRoute = lazy(async () => ({
  default: (await import('./routes/notes-route.js')).NotesRoute,
}));
const RuntimeCenter = lazy(async () => ({
  default: (await import('./features/runtime/runtime-center.js')).RuntimeCenter,
}));

class RouteLoadBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  public override state = { failed: false };

  public static getDerivedStateFromError() {
    return { failed: true };
  }

  public override render() {
    if (this.state.failed) {
      return (
        <main aria-labelledby="route-load-error-title" className="route-load-error" role="alert">
          <h1 id="route-load-error-title">页面加载失败</h1>
          <p>业务模块未能载入。当前数据没有被修改，可以重新加载后继续。</p>
          <div className="lm-inline">
            <button
              className="lm-button lm-button--primary"
              onClick={() => window.location.reload()}
              type="button"
            >
              重新加载页面
            </button>
            <Link className="lm-button lm-button--secondary" to="/">
              返回主页
            </Link>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export function DeferredRoute(props: { readonly children: ReactNode }) {
  return (
    <RouteLoadBoundary>
      <Suspense
        fallback={
          <div aria-live="polite" className="route-loading" role="status">
            页面加载中…
          </div>
        }
      >
        {props.children}
      </Suspense>
    </RouteLoadBoundary>
  );
}

function HomeRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state: runtimeState } = useRuntimeState();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [dashboard, setDashboard] = useState<HomeDashboardView | undefined>(() =>
    homeDashboardCache.read(),
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    if (runtimeState.kind !== 'loaded') return undefined;
    const controller = new AbortController();
    setError(false);
    const unsubscribe = homeDashboardCache.subscribe(() => setDashboard(homeDashboardCache.read()));
    void homeDashboardCache.revalidate(controller.signal).catch(() => {
      if (homeDashboardCache.read() === undefined) setError(true);
    });
    return () => {
      unsubscribe();
      controller.abort();
    };
  }, [runtimeState.kind]);
  return (
    <HomePage
      error={error}
      loading={dashboard === undefined && !error}
      onNavigate={(path) => navigate(path)}
      onStartAuthoring={(authoringStartIntent) =>
        navigate('/courses/new', {
          state: { authoringStartIntent } satisfies AuthoringLocationState,
        })
      }
      onScheduleChanged={() => {
        void homeDashboardCache.revalidate().catch(() => undefined);
        void scheduleSnapshotCache.revalidate().catch(() => undefined);
      }}
      {...(dashboard === undefined
        ? {}
        : {
            courses: dashboard.courses,
            draftSessions: dashboard.draftSessions,
            lessons: dashboard.lessons,
            schedule: dashboard.schedule,
          })}
      {...(notice === undefined ? {} : { notice })}
    />
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
      {
        id: 'course-new',
        path: 'courses/new',
        element: (
          <DeferredRoute>
            <CourseAuthoringRoute />
          </DeferredRoute>
        ),
      },
      {
        id: 'course',
        path: 'courses/:courseId',
        element: (
          <DeferredRoute>
            <CourseRoute />
          </DeferredRoute>
        ),
      },
      {
        id: 'lesson',
        path: 'courses/:courseId/lessons/:lessonId',
        element: (
          <DeferredRoute>
            <LessonRoute />
          </DeferredRoute>
        ),
      },
      {
        id: 'lesson-record',
        path: 'courses/:courseId/lessons/:lessonId/record',
        element: (
          <DeferredRoute>
            <LessonRecordRoute />
          </DeferredRoute>
        ),
      },
      {
        id: 'lesson-legacy',
        path: 'lessons/:lessonId',
        element: (
          <DeferredRoute>
            <LessonRoute />
          </DeferredRoute>
        ),
      },
      {
        id: 'planning',
        path: 'planning',
        element: (
          <DeferredRoute>
            <PlanningRoute />
          </DeferredRoute>
        ),
      },
      {
        id: 'notes',
        path: 'notes',
        element: (
          <DeferredRoute>
            <NotesRoute />
          </DeferredRoute>
        ),
      },
      {
        id: 'history',
        path: 'history',
        element: (
          <DeferredRoute>
            <HistoryRoute />
          </DeferredRoute>
        ),
      },
      {
        id: 'runtime',
        path: 'runtime',
        element: (
          <DeferredRoute>
            <RuntimeCenter />
          </DeferredRoute>
        ),
      },
      { id: 'not-found', path: '*', element: <NotFoundRoute /> },
    ],
  },
];

export function AppRoutes() {
  return useRoutes(appRouteDefinitions);
}
