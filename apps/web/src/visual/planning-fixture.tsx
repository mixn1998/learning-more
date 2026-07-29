import type { CatalogIndexView, PlanFlowView } from '@learning-more/contracts';

import type { ScheduleItemView } from '../client/planning-client.js';
import { PlanFlowPanel } from '../features/planning/plan-flow-panel.js';
import { PlanningWorkspaceView } from '../features/planning/planning-workspace-view.js';
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

const courses: CatalogIndexView['courses'] = [
  {
    courseId: 'game-design',
    title: '游戏设计能力',
    status: 'active',
    courseMode: 'standard',
    outlineVersionId: 'outline_game',
    resourceVersion: 3,
  },
  {
    courseId: 'data-structures',
    title: '数据结构入门',
    status: 'active',
    courseMode: 'standard',
    outlineVersionId: 'outline_data',
    resourceVersion: 2,
  },
  {
    courseId: 'product-experiments',
    title: '用行为证据设计产品实验',
    status: 'active',
    courseMode: 'business_insight',
    outlineVersionId: 'outline_product',
    resourceVersion: 1,
  },
];

const lessons: CatalogIndexView['lessons'] = [
  {
    courseId: 'data-structures',
    lessonId: 'tree-hierarchy',
    title: '树为什么适合表达层级关系',
    progress: 'not_started',
    recommended: false,
  },
  {
    courseId: 'game-design',
    lessonId: 'prototype-metrics',
    title: '如何为原型建立验证指标',
    progress: 'not_started',
    recommended: false,
  },
  {
    courseId: 'game-design',
    lessonId: 'core-loop',
    title: '核心循环与玩家动机',
    progress: 'not_started',
    recommended: false,
  },
  {
    courseId: 'data-structures',
    lessonId: 'stack-queue',
    title: '栈与队列如何约束操作顺序',
    progress: 'not_started',
    recommended: false,
  },
  {
    courseId: 'game-design',
    lessonId: 'feedback-action',
    title: '反馈如何改变玩家下一步行动',
    progress: 'not_started',
    recommended: true,
  },
  {
    courseId: 'game-design',
    lessonId: 'success-criteria',
    title: '建立可验证的成功标准',
    progress: 'not_started',
    recommended: false,
  },
  {
    courseId: 'data-structures',
    lessonId: 'graph-relations',
    title: '图如何表达多对多关系',
    progress: 'not_started',
    recommended: false,
  },
];

const scheduleDates = [
  ['tree-hierarchy', 'data-structures', '2026-07-10', 28],
  ['core-loop', 'game-design', '2026-07-13', 20],
  ['stack-queue', 'data-structures', '2026-07-14', 26],
  ['feedback-action', 'game-design', '2026-07-12', 24],
  ['success-criteria', 'game-design', '2026-07-12', 18],
] as const;

const items: readonly ScheduleItemView[] = scheduleDates.map(
  ([lessonId, courseId, date, minutes], index) => {
    const startAt = new Date(`${date}T19:00:00+08:00`);
    return {
      id: `schedule_${index + 1}`,
      courseId,
      lessonId,
      startAt: startAt.toISOString(),
      endAt: new Date(startAt.getTime() + minutes * 60_000).toISOString(),
      timezoneAtCreation: 'Asia/Shanghai',
      source: 'manual',
      status: 'scheduled',
      locked: false,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      processedCommandIds: [],
      resourceVersion: 1,
    };
  },
);

const metadata = {
  'tree-hierarchy': {
    estimatedMinutes: 28,
    topic: '数据结构',
    points: ['节点与边', '父子关系', '递归结构'],
  },
  'prototype-metrics': {
    estimatedMinutes: 18,
    topic: '原型验证',
    points: ['判断标准', '行为证据', '迭代条件'],
  },
  'core-loop': {
    estimatedMinutes: 20,
    topic: '游戏反馈',
    points: ['玩家行动', '系统反馈', '下一步欲望'],
  },
  'stack-queue': {
    estimatedMinutes: 26,
    topic: '数据结构',
    points: ['后进先出', '先进先出', '场景匹配'],
  },
  'feedback-action': {
    estimatedMinutes: 24,
    topic: '游戏反馈',
    points: ['状态反馈', '能力反馈', '目标反馈'],
  },
  'success-criteria': {
    estimatedMinutes: 18,
    topic: '原型验证',
    points: ['观察指标', '测试任务', '迭代决策'],
  },
  'graph-relations': {
    estimatedMinutes: 31,
    topic: '数据结构',
    points: ['节点连接', '方向与权重', '遍历路径'],
  },
} as const;

const preview: PlanFlowView = {
  id: 'plan_flow_visual',
  state: 'preview-ready',
  constraintsArtifactRef: 'constraints_visual',
  courseRefs: ['game-design', 'data-structures'],
  lessonRefs: lessons.slice(0, 4).map((lesson) => lesson.lessonId),
  timeWindowRefs: ['start:2026-07-13'],
  existingScheduleSnapshotRef: 'schedule_5',
  baseScheduleVersion: 5,
  generationTaskId: 'task_visual',
  suggestions: [],
  conflicts: [],
  confirmationReceipts: {},
  confirmedScheduleItemIds: [],
  processedCommandIds: [],
  source: 'plan-flow',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
  resourceVersion: 1,
};

export function PlanningFixture() {
  return (
    <AppShellView
      brandSubtitle="课程规划"
      headerTrailing={
        <div className="planning-header-counts">
          <span className="lm-pill">今日待学 2</span>
          <span className="lm-pill warning">已逾期 1</span>
          <span className="lm-pill warning">待规划 2</span>
        </div>
      }
      providerLabel="Codex"
      refresh={() => undefined}
      state={readyRuntime}
    >
      <PlanningWorkspaceView
        anchorDate="2026-07-12"
        courses={courses}
        items={items}
        lessons={lessons}
        metadata={metadata}
        onClear={async () => undefined}
        onCreate={async () => undefined}
        onGeneratePlanFlow={() => undefined}
        onMove={async () => undefined}
        onRemove={async () => undefined}
        onReturn={() => undefined}
      />
    </AppShellView>
  );
}

export function PlanFlowFixture() {
  return (
    <PlanFlowPanel
      courses={courses}
      fullFrame
      initialCourseIds={['game-design', 'data-structures']}
      initialStartDate="2026-07-13"
      lessons={lessons}
      onClose={() => undefined}
      onConfirm={async () => ({ ...preview, state: 'confirmed' })}
      onManage={async (flow) => flow}
      onPreview={async () => preview}
    />
  );
}
