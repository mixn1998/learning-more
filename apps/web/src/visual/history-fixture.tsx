import {
  HistoryCalendarWorkspace,
  type HistoryCalendarRecord,
} from '../features/history/history-calendar-workspace.js';
import {
  HistoryStatisticsWorkspace,
  type HistoryStatisticsCourse,
  type HistoryStatisticsRange,
  type HistoryStatisticsSnapshot,
} from '../features/history/history-statistics-workspace.js';
import {
  WeeklyReportWorkspace,
  type WeeklyReportRecord,
} from '../features/history/weekly-report-workspace.js';
import { AppShellView } from '../layouts/app-shell.js';
import type { RuntimeUiState } from '../state/version-guard.js';

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

const calendarRecords: readonly HistoryCalendarRecord[] = [
  {
    localDate: '2026-07-03',
    courseId: 'game-design',
    lessonId: 'feedback-animation',
    title: '反馈不是奖励动画',
    domain: '游戏设计',
    minutes: 24,
  },
  {
    localDate: '2026-07-06',
    courseId: 'computer-science',
    lessonId: 'array-random-access',
    title: '数组为什么能够随机访问',
    domain: '计算机科学',
    minutes: 31,
  },
  {
    localDate: '2026-07-10',
    courseId: 'game-design',
    lessonId: 'core-loop-motivation',
    title: '核心循环如何形成持续动机',
    domain: '游戏设计',
    minutes: 20,
  },
  {
    localDate: '2026-07-10',
    courseId: 'computer-science',
    lessonId: 'linked-list-insert',
    title: '链表如何改变插入代价',
    domain: '计算机科学',
    minutes: 31,
  },
  {
    localDate: '2026-07-10',
    courseId: 'game-design',
    lessonId: 'feedback-reward',
    title: '反馈不是奖励动画',
    domain: '游戏设计',
    minutes: 24,
  },
  {
    localDate: '2026-07-10',
    courseId: 'product-design',
    lessonId: 'prototype-success',
    title: '建立可验证的成功标准',
    domain: '产品设计',
    minutes: 18,
  },
  {
    localDate: '2026-07-17',
    courseId: 'computer-science',
    lessonId: 'tree-levels',
    title: '树的层级关系',
    domain: '计算机科学',
    minutes: 28,
  },
  {
    localDate: '2026-07-17',
    courseId: 'product-design',
    lessonId: 'prototype-criteria',
    title: '为原型建立成功标准',
    domain: '产品设计',
    minutes: 18,
  },
];

const statisticsBase = {
  currentStreakDays: 4,
  longestStreakDays: 11,
  disciplines: [
    { label: '计算机科学', percent: 86, hours: '8.4h' },
    { label: '产品设计', percent: 68, hours: '6.7h' },
    { label: '游戏设计', percent: 57, hours: '5.6h' },
    { label: '商业管理', percent: 39, hours: '3.8h' },
  ],
  interactionResponded: 184,
  interactionResponseRate: 92,
  interactionSkipped: 11,
} as const;

const statisticsSnapshots: Readonly<Record<HistoryStatisticsRange, HistoryStatisticsSnapshot>> = {
  '30d': {
    ...statisticsBase,
    hours: '12.4 小时',
    completedLessons: 28,
    closedCourses: 2,
    activeDays: 16,
    courseCount: 5,
    abandonedCourseCount: 0,
    bars: [22, 38, 31, 48, 42, 61, 53, 72, 64, 81, 58, 69],
  },
  year: {
    ...statisticsBase,
    hours: '28.6 小时',
    completedLessons: 67,
    closedCourses: 8,
    activeDays: 31,
    courseCount: 12,
    abandonedCourseCount: 2,
    bars: [32, 52, 42, 67, 58, 76, 45, 83, 71, 91, 64, 78],
  },
  all: {
    ...statisticsBase,
    hours: '54.8 小时',
    completedLessons: 132,
    closedCourses: 18,
    activeDays: 74,
    courseCount: 24,
    abandonedCourseCount: 4,
    bars: [49, 58, 64, 55, 72, 68, 81, 76, 88, 83, 94, 89],
  },
  custom: {
    ...statisticsBase,
    hours: '7.6 小时',
    completedLessons: 19,
    closedCourses: 1,
    activeDays: 12,
    courseCount: 4,
    abandonedCourseCount: 0,
    bars: [18, 24, 36, 31, 43, 57, 48, 62, 55, 69, 61, 73],
  },
};

const statisticsCourses: readonly HistoryStatisticsCourse[] = [
  {
    courseId: 'data-structures',
    title: '数据结构入门',
    domain: '计算机科学',
    topics: '数组 / 链表 / 树',
    status: '已关闭',
    mode: '标准模式',
    disposition: '8 / 8 完成',
    duration: '4h 36m',
    durationMinutes: 276,
    recentDate: '07-10',
    reviewAvailable: true,
  },
  {
    courseId: 'game-systems',
    title: '游戏系统设计基础',
    domain: '游戏设计',
    topics: '核心循环 / 反馈',
    status: '学习中',
    mode: '案例研习',
    disposition: '5 / 7 完成',
    duration: '3h 18m',
    durationMinutes: 198,
    recentDate: '07-08',
    reviewAvailable: false,
  },
  {
    courseId: 'product-validation',
    title: '产品实验与验证',
    domain: '产品设计',
    topics: '原型 / 成功标准',
    status: '已关闭',
    mode: '决策分析',
    disposition: '5 完成 · 1 放弃',
    duration: '2h 54m',
    durationMinutes: 174,
    recentDate: '07-03',
    reviewAvailable: true,
  },
];

const weeklyRecords: readonly WeeklyReportRecord[] = [
  {
    localDate: '2026-06-29',
    lessonId: 'feedback-constraint',
    courseId: 'game-design',
    title: '核心反馈的设计约束',
    domain: '艺术与设计',
    topic: '游戏反馈',
  },
  {
    localDate: '2026-06-30',
    lessonId: 'array-random-access',
    courseId: 'computer-science',
    title: '数组为什么能够随机访问',
    domain: '计算机科学',
    topic: '数据结构',
  },
  {
    localDate: '2026-07-02',
    lessonId: 'linked-list-cost',
    courseId: 'computer-science',
    title: '链表如何改变插入与删除代价',
    domain: '计算机科学',
    topic: '数据结构',
  },
  {
    localDate: '2026-07-03',
    lessonId: 'core-loop',
    courseId: 'game-design',
    title: '核心循环与玩家动机',
    domain: '艺术与设计',
    topic: '游戏反馈',
  },
  {
    localDate: '2026-07-05',
    lessonId: 'feedback-animation',
    courseId: 'game-design',
    title: '反馈不是奖励动画',
    domain: '艺术与设计',
    topic: '游戏反馈',
  },
];

export function HistoryStatisticsFixture() {
  return (
    <AppShellView
      brandSubtitle="历史统计"
      headerBeforeStatus={<span className="lm-pill">● 接口 · Codex</span>}
      providerLabel="Codex"
      refresh={() => undefined}
      state={readyRuntime}
    >
      <HistoryStatisticsWorkspace
        courses={statisticsCourses}
        getSnapshot={(range) => statisticsSnapshots[range]}
        onOpenCourse={() => undefined}
        onSectionChange={() => undefined}
      />
    </AppShellView>
  );
}

export function HistoryCalendarFixture() {
  return (
    <AppShellView
      brandSubtitle="学习日历"
      headerBeforeStatus={<span className="lm-pill">● 接口 · Codex</span>}
      providerLabel="Codex"
      refresh={() => undefined}
      state={readyRuntime}
    >
      <HistoryCalendarWorkspace
        initialMonth="2026-07"
        initialSelectedDate="2026-07-10"
        onOpenRecord={() => undefined}
        onSectionChange={() => undefined}
        records={calendarRecords}
      />
    </AppShellView>
  );
}

export function WeeklyReportFixture() {
  return (
    <AppShellView
      brandSubtitle="上周学习回顾"
      headerStatus={{ tone: 'success', text: '● 周报已生成' }}
      providerLabel="Codex"
      refresh={() => undefined}
      state={readyRuntime}
    >
      <WeeklyReportWorkspace
        activeDayCount={5}
        actualSeconds={154 * 60}
        completedLessonCount={6}
        endLocalDate="2026-07-05"
        onBack={() => undefined}
        onOpenRecord={() => undefined}
        records={weeklyRecords}
        reportState="finalized"
        startLocalDate="2026-06-29"
        summaryMarkdown="你开始从“内容是否足够”转向“反馈是否改变下一步行动”，并能把同一判断迁移到游戏设计与数据结构学习中。"
        suggestionMarkdown="继续围绕可观察行为建立判断标准，同时保留对结构约束的解释习惯。"
      />
    </AppShellView>
  );
}
