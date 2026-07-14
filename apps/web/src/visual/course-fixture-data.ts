import type { CourseArchiveView, CourseOutlineVersionView } from '@learning-more/contracts';

import type { CourseDirectoryItem } from '../features/course/formal-course-view.js';
import type {
  CourseRevisionCandidate,
  CourseRevisionMessage,
} from '../features/course/outline-revision-workspace.js';
import type {
  CourseLessonRuntimeState,
  CourseOutlineModule,
} from '../features/course/outline-view.js';
import type { CourseReviewDocument } from '../features/review/course-review-view.js';

const lessons: NonNullable<CourseArchiveView['lessons']> = [
  {
    lessonId: 'lesson_01',
    outlineVersionId: 'outline_v1',
    title: '玩家为什么会停下来',
    objective: '识别体验断点，建立行为证据视角。',
    coreKnowledgePoints: ['体验断点', '行为证据', '重复感来源'],
    prerequisiteLessonIds: [],
    estimatedMinutes: 24,
  },
  {
    lessonId: 'lesson_02',
    outlineVersionId: 'outline_v1',
    title: '反馈不是奖励动画',
    objective: '你已经能识别体验断点，下一步适合区分反馈层级。',
    coreKnowledgePoints: ['状态反馈', '能力反馈', '目标反馈'],
    prerequisiteLessonIds: ['lesson_01'],
    estimatedMinutes: 26,
  },
  {
    lessonId: 'lesson_03',
    outlineVersionId: 'outline_v1',
    title: '行为如何形成循环',
    objective: '把行动、响应和欲望连接为核心循环。',
    coreKnowledgePoints: ['玩家行动', '系统响应', '下一步欲望'],
    prerequisiteLessonIds: ['lesson_02'],
    estimatedMinutes: 30,
  },
  {
    lessonId: 'lesson_04',
    outlineVersionId: 'outline_v1',
    title: '难度与掌握感如何推进',
    objective: '设计可解释的挑战推进节奏。',
    coreKnowledgePoints: ['挑战强度', '可解释反馈', '推进节奏'],
    prerequisiteLessonIds: ['lesson_03'],
    estimatedMinutes: 28,
  },
  {
    lessonId: 'lesson_05',
    outlineVersionId: 'outline_v1',
    title: '为原型建立成功标准',
    objective: '把设计判断改写为可观察的原型证据。',
    coreKnowledgePoints: ['行为信号', '判断标准', '证据边界'],
    prerequisiteLessonIds: ['lesson_04'],
    estimatedMinutes: 25,
  },
];

export const COURSE_FIXTURE_ACTIVE = {
  courseId: 'course_game_design',
  title: '从反馈到核心循环：游戏设计能力进阶',
  status: 'active',
  courseMode: 'standard',
  outlineVersionId: 'outline_v1',
  lessonIds: lessons.map((lesson) => lesson.lessonId),
  recommendedLessonId: 'lesson_02',
  outlineMarkdown: '# 从反馈到核心循环：游戏设计能力进阶',
  lessons,
  outlineVersions: [
    {
      outlineVersionId: 'outline_v1',
      sourceCandidateVersionId: 'candidate_01',
      createdAt: '2026-07-06T08:00:00+08:00',
      current: true,
    },
  ],
  resourceVersion: 1,
} satisfies CourseArchiveView;

export const COURSE_FIXTURE_CLOSED = {
  ...COURSE_FIXTURE_ACTIVE,
  status: 'closed',
  resourceVersion: 2,
} satisfies CourseArchiveView;

export const COURSE_FIXTURE_OUTLINE = {
  courseId: COURSE_FIXTURE_ACTIVE.courseId,
  outlineVersionId: 'outline_v1',
  sourceCandidateVersionId: 'candidate_01',
  outlineMarkdown: '# 从反馈到核心循环：游戏设计能力进阶',
  disciplineTag: '艺术与设计',
  topicTags: ['游戏设计', '核心循环'],
  createdAt: '2026-07-06T08:00:00+08:00',
  resourceVersion: 1,
  current: true,
} satisfies CourseOutlineVersionView;

export const COURSE_FIXTURE_MODULES: readonly CourseOutlineModule[] = [
  { title: '看见游戏为何失去吸引力', lessonIds: ['lesson_01', 'lesson_02'] },
  { title: '建立可持续的核心循环', lessonIds: ['lesson_03', 'lesson_04'] },
  { title: '用原型验证设计判断', lessonIds: ['lesson_05'] },
];

export const COURSE_FIXTURE_ACTIVE_STATES: Readonly<Record<string, CourseLessonRuntimeState>> = {
  lesson_01: { progress: 'completed' },
  lesson_02: { progress: 'not_started' },
  lesson_03: { progress: 'in_progress', sessionId: 'session_03' },
  lesson_04: { progress: 'abandoned', sessionId: 'session_04' },
  lesson_05: { progress: 'not_started' },
};

export const COURSE_FIXTURE_CLOSED_STATES: Readonly<Record<string, CourseLessonRuntimeState>> =
  Object.fromEntries(lessons.map((lesson) => [lesson.lessonId, { progress: 'completed' }]));

export const COURSE_FIXTURE_DIRECTORY: readonly CourseDirectoryItem[] = [
  {
    courseId: 'course_game_design',
    title: COURSE_FIXTURE_ACTIVE.title,
    status: 'active',
    courseMode: 'standard',
    progressLabel: '标准模式 · 1 节学习中 · 最近学习 07/12',
  },
  {
    courseId: 'course_data_structures',
    title: '数据结构：从约束理解操作代价',
    status: 'active',
    courseMode: 'reading_seminar',
    progressLabel: '阅读研讨 · 4 节待完成 · 最近学习 07/10',
  },
  {
    courseId: 'course_product_experiment',
    title: '用行为证据设计产品实验',
    status: 'active',
    courseMode: 'case_study',
    progressLabel: '案例研习 · 尚未开始 · 创建于 07/09',
  },
];

export const COURSE_FIXTURE_REVISION_MESSAGES: readonly CourseRevisionMessage[] = [
  {
    role: 'user',
    markdown:
      '完成第一课后，我能识别玩家为什么停下来，但还不太会判断反馈是否改变下一步行动，希望强化这部分。',
  },
  {
    role: 'assistant',
    markdown:
      '这个调整与第一课 Review 一致。你已经能识别体验断点，下一步适合把“反馈层级”推进到“反馈是否改变行动”的验证。右侧给出完整候选 v2；已完成第一课保持不变。',
  },
  {
    role: 'user',
    markdown: '可以，但不要把课程变成数据分析课，验证方法仍要服务游戏设计判断。',
  },
  {
    role: 'assistant',
    markdown:
      '明白。行为证据只用于支持设计判断，不扩展为独立统计课程。你仍可以继续要求保留、删除、重排或强化内容。',
  },
];

export const COURSE_FIXTURE_REVISION_CANDIDATE: CourseRevisionCandidate = {
  candidateVersionId: 'candidate_03',
  title: COURSE_FIXTURE_ACTIVE.title,
  summary: '保留课程主线，强化反馈如何改变行动以及如何用行为证据验证设计判断。',
  discipline: '艺术与设计',
  tags: ['游戏反馈'],
  versionLabel: '基于 v1 · 候选 03',
  modules: [
    {
      title: '模块一 · 看见体验断点与反馈作用',
      change: '调整',
      lessons: [
        { title: '玩家为什么会停下来', detail: '已完成 · 保留原定义、对话和最终 Review。' },
        { title: '反馈如何改变下一步行动', detail: '状态反馈、能力反馈、目标反馈与行动选择。' },
      ],
    },
    {
      title: '模块二 · 建立可持续的核心循环',
      change: '保留',
      lessons: [{ title: '行为如何形成循环', detail: '玩家行动、系统响应和下一步欲望。' }],
    },
    {
      title: '模块三 · 用行为证据验证反馈',
      change: '新增',
      lessons: [
        { title: '把设计判断变成可观察指标', detail: '行为信号、判断标准与证据边界。' },
        { title: '用原型测试反馈是否有效', detail: '测试任务、行为变化与迭代决策。' },
      ],
    },
  ],
  impact: '保留 3 节，调整 1 节，拆分原验证课；已完成课节及其归档不变。',
};

export const COURSE_FIXTURE_REVIEW_DOCUMENT: CourseReviewDocument = {
  knowledge: [
    {
      title: '从体验表象转向行为证据',
      detail: '不把重复感停留在内容数量判断，而是检查行动、反馈与目标是否仍在推进。',
    },
    {
      title: '从反馈存在转向反馈层级',
      detail: '区分状态、能力和目标反馈，并判断它们是否真正改变下一步行动。',
    },
    {
      title: '从设计判断转向原型验证',
      detail: '把“应该好玩”改写为可观察的玩家行为与迭代条件。',
    },
  ],
  strengths: {
    title: '稳定优势',
    detail: '你能从具体行为证据推导机制，并主动把判断迁移到自己的原型。',
  },
  development: {
    title: '需要继续发展',
    detail: '面对开放问题时仍可能过早收敛，下一阶段可主动寻找反例和替代解释。',
  },
  boundary: {
    title: '推进节奏与玩家行为证据的闭环',
    detail: '你已能够把挑战强度连接到可解释反馈；下一步可在不同玩家情境中验证推进节奏是否仍成立。',
  },
  extensions: [
    { title: '游戏经济系统中的反馈回路', detail: '扩展反馈与长期动机之间的关系。' },
    { title: '行为实验与原型测试', detail: '把设计判断转化为可验证实验。' },
    { title: '系统思考与循环结构', detail: '把核心循环连接到更广泛的系统行为。' },
  ],
};
