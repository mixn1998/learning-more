import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { HomePage, type HomeLessonCandidate } from '../features/home/home-page.js';
import { AppShellView } from '../layouts/app-shell.js';
import type { RuntimeUiState } from '../state/version-guard.js';
import { AuthoringFixture } from './authoring-fixture.js';
import { isAuthoringFixtureId } from './authoring-fixture-data.js';
import { ChatFixture } from './chat-fixture.js';
import { CourseModesFixture, UiComponentsFixture } from './design-system-fixtures.js';
import { CourseFixture, isCourseFixtureId } from './course-fixture.js';
import {
  HistoryCalendarFixture,
  HistoryStatisticsFixture,
  WeeklyReportFixture,
} from './history-fixture.js';
import { PlanFlowFixture, PlanningFixture } from './planning-fixture.js';
import { RuntimeFixture } from './runtime-fixture.js';
import { MathPlotFixture } from './math-plot-fixture.js';
import {
  LessonNavigationFixture,
  LessonRecordFixture,
  LessonReviewFixture,
  LessonSessionFixture,
} from './lesson-fixture.js';

const readyRuntime: RuntimeUiState = {
  kind: 'loaded',
  readiness: {
    status: 'ready',
    instanceId: 'visual-instance',
    buildId: 'development',
    protocolVersion: '1',
    storeStatus: 'ready',
    projectionStatus: 'ready',
    providerStatus: 'ready',
  },
  version: { kind: 'compatible', writesAllowed: true },
};

const lessons: readonly HomeLessonCandidate[] = [
  {
    courseId: 'game-design',
    lessonId: 'feedback-spine',
    title: '反馈是游戏设计的脊椎',
    progress: 'not_started',
    recommended: true,
  },
  {
    courseId: 'computer-science',
    lessonId: 'arrays-linked-lists',
    title: '数组与链表的结构取舍',
    progress: 'not_started',
  },
  {
    courseId: 'game-design',
    lessonId: 'core-loop',
    title: '核心循环与玩家动机',
    progress: 'not_started',
  },
  {
    courseId: 'computer-science',
    lessonId: 'stack-queue',
    title: '栈与队列如何约束操作顺序',
    progress: 'not_started',
  },
  {
    courseId: 'product-design',
    lessonId: 'success-criteria',
    title: '建立可验证的成功标准',
    progress: 'not_started',
  },
  {
    courseId: 'game-design',
    lessonId: 'pending-feedback',
    title: '反馈层级与可读性',
    progress: 'not_started',
  },
  {
    courseId: 'computer-science',
    lessonId: 'pending-tree',
    title: '树结构的递归性质',
    progress: 'not_started',
  },
  {
    courseId: 'product-design',
    lessonId: 'pending-experiment',
    title: '实验设计与证据判断',
    progress: 'not_started',
  },
];

const scheduleSpecs = [
  ['schedule-1', 'game-design', 'feedback-spine', '09:00', 24],
  ['schedule-2', 'computer-science', 'arrays-linked-lists', '10:00', 31],
  ['schedule-3', 'game-design', 'core-loop', '11:00', 20],
  ['schedule-4', 'computer-science', 'stack-queue', '14:00', 26],
  ['schedule-5', 'product-design', 'success-criteria', '15:00', 18],
] as const;

const schedule = scheduleSpecs.map(([scheduleItemId, courseId, lessonId, time, minutes]) => {
  const startAt = new Date(`2026-07-12T${time}:00+08:00`);
  return {
    scheduleItemId: String(scheduleItemId),
    courseId: String(courseId),
    lessonId: String(lessonId),
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + Number(minutes) * 60_000).toISOString(),
    source: 'manual' as const,
    locked: false,
  };
});

function HomeFixture() {
  return (
    <AppShellView providerLabel="Codex" refresh={() => undefined} state={readyRuntime}>
      <HomePage
        courses={[
          { courseId: 'game-design', title: '游戏设计', status: 'active' },
          { courseId: 'computer-science', title: '计算机科学', status: 'active' },
          { courseId: 'product-design', title: '产品设计', status: 'active' },
        ]}
        lessons={lessons}
        now={new Date('2026-07-12T12:00:00+08:00')}
        schedule={schedule}
        onNavigate={() => undefined}
      />
    </AppShellView>
  );
}

export function VisualFixtureApp(props: { readonly fixtureId: string }) {
  let content: ReactNode;
  let initialEntry = '/';
  if (isAuthoringFixtureId(props.fixtureId)) {
    content = <AuthoringFixture fixtureId={props.fixtureId} />;
    initialEntry = '/courses/new';
  } else if (isCourseFixtureId(props.fixtureId)) {
    content = <CourseFixture fixtureId={props.fixtureId} />;
    initialEntry = '/courses/course_game_design';
  } else {
    switch (props.fixtureId) {
      case 'ui-components':
        content = <UiComponentsFixture />;
        break;
      case 'course-modes':
        content = <CourseModesFixture />;
        break;
      case 'chat-components':
        content = <ChatFixture />;
        break;
      case 'home-ready':
        content = <HomeFixture />;
        break;
      case 'planning-ready':
        content = <PlanningFixture />;
        initialEntry = '/planning';
        break;
      case 'plan-flow-management':
        content = <PlanFlowFixture />;
        initialEntry = '/planning';
        break;
      case 'history-calendar':
        content = <HistoryCalendarFixture />;
        initialEntry = '/history';
        break;
      case 'history-statistics':
        content = <HistoryStatisticsFixture />;
        initialEntry = '/history';
        break;
      case 'weekly-report-expanded':
        content = <WeeklyReportFixture />;
        initialEntry = '/history?tab=weekly';
        break;
      case 'runtime-ready':
        content = <RuntimeFixture />;
        initialEntry = '/runtime';
        break;
      case 'math-plot':
        content = <MathPlotFixture />;
        break;
      case 'lesson-not-started':
      case 'lesson-abandoned':
        content = <LessonNavigationFixture fixtureId={props.fixtureId} />;
        initialEntry = '/courses/course_game_design/lessons/lesson_feedback';
        break;
      case 'lesson-session-active':
        content = <LessonSessionFixture />;
        initialEntry = '/courses/course_game_design/lessons/lesson_feedback';
        break;
      case 'lesson-review-dialog':
        content = <LessonReviewFixture />;
        initialEntry = '/courses/course_game_design/lessons/lesson_feedback';
        break;
      case 'lesson-record':
        content = <LessonRecordFixture />;
        initialEntry = '/courses/course_game_design/lessons/lesson_feedback/record';
        break;
      default:
        content = <main>Unknown visual fixture: {props.fixtureId}</main>;
    }
  }

  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <div data-visual-ready="true">{content}</div>
    </MemoryRouter>
  );
}
