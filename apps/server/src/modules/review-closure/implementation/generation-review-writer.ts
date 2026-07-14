import { createHash } from 'node:crypto';

import type { TeachingCheckpointSnapshot, TeachingObservation } from '@learning-more/contracts';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { MaterializedTeachingMessage } from '../../interactive-teaching/interface.js';

const REVIEW_CAPABILITY = [
  '根据完整、冻结且可追溯的教学证据生成学习者可见 Review。',
  '先忠实覆盖本课知识责任、实际教学、学习者证据、未解决项与教学支线；支线不能冒充本课覆盖或未来课节完成。',
  '可选互动关注只改变叙事关注重心，不筛除证据、不决定完成度，也不规定章节和表达形式。',
  '不要补写未发生的表现、掌握或观点变化。只输出自由组织的 Markdown。',
].join('\n');

const COURSE_REVIEW_CAPABILITY = [
  '根据冻结的课程结构、全部可用课时 Review 与明确缺口生成课程总 Review。',
  '忠实区分已完成课节、有阶段证据的放弃课节和没有 Review 的放弃课节；缺失证据不能被补写成学习表现。',
  '可选互动关注只改变叙事关注重心，不筛除课程证据、不改变完成事实，也不规定章节和表达形式。',
  '不要套用固定标题、固定段落或固定推荐。只输出自由组织、可追溯的 Markdown。',
].join('\n');

export type ReviewEvidencePack = Readonly<{
  kind: 'stage' | 'final';
  checkpoint: TeachingCheckpointSnapshot;
  course: Readonly<{ courseId: string; title: string }>;
  lesson: Readonly<{
    lessonId: string;
    title: string;
    objective: string;
    coreKnowledgePoints: readonly string[];
  }>;
  observations: readonly TeachingObservation[];
  messages: readonly MaterializedTeachingMessage[];
  reviewLens?: string;
}>;

export type CourseReviewEvidencePack = Readonly<{
  kind: 'course';
  course: Readonly<{
    courseId: string;
    title: string;
    outlineVersionId: string;
  }>;
  lessons: readonly Readonly<{
    lessonId: string;
    title: string;
    objective: string;
    coreKnowledgePoints: readonly string[];
  }>[];
  lessonReviews: readonly Readonly<{
    lessonId: string;
    kind: 'final' | 'stage';
    sourceRef: string;
    markdown: string;
  }>[];
  abandonedWithoutReviewLessonIds: readonly string[];
  reviewLens?: string;
}>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function section(title: string, values: readonly string[]): string | undefined {
  const content = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return content.length === 0 ? undefined : `【${title}】\n${content.join('\n')}`;
}

function renderLessonReviewEvidence(pack: ReviewEvidencePack): string {
  const observationSummaries = pack.observations
    .filter((observation) => observation.status === 'active')
    .flatMap((observation) => [
      observation.scope.rationale,
      ...observation.entries.map((entry) => entry.summary),
    ]);
  const dialogue = pack.messages
    .filter((message) => message.completionStatus !== 'failed')
    .map((message) => {
      const interrupted = message.completionStatus === 'interrupted' ? '（未完成）' : '';
      return `${message.role === 'user' ? '学习者' : '教学助手'}${interrupted}：${message.markdown.trim()}`;
    });
  return [
    `Review 类型：${pack.kind === 'final' ? '本课最终 Review' : '阶段 Review'}`,
    `课程：${pack.course.title}`,
    `本课：${pack.lesson.title}`,
    `本课目标：${pack.lesson.objective}`,
    section(
      '本课责任',
      pack.lesson.coreKnowledgePoints.map((point) => `- ${point}`),
    ),
    section(
      '教学与学习证据',
      observationSummaries.map((summary) => `- ${summary}`),
    ),
    section(
      '尚未闭合的问题',
      pack.checkpoint.teachingState.openLoops.map((loop) => `- ${loop.summary}`),
    ),
    section(
      '课程邻接探索',
      pack.checkpoint.teachingState.explorationBranches.map(
        (branch) =>
          `- ${branch.summary}（${branch.status === 'active' ? '正在探索' : branch.status === 'parked' ? '已暂存' : '已返回主线'}）`,
      ),
    ),
    section(
      '近期学习者表现',
      pack.checkpoint.teachingState.recentLearnerSignals.map((signal) =>
        signal.explicitness === 'user_declared'
          ? `- 学习者明确表达：${signal.summary}`
          : `- 尚需结合证据判断：${signal.summary}`,
      ),
    ),
    section('实际对话', dialogue),
    pack.reviewLens === undefined ? undefined : `【本次 Review 关注】\n${pack.reviewLens.trim()}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n\n');
}

function renderCourseReviewEvidence(pack: CourseReviewEvidencePack): string {
  const lessonById = new Map(pack.lessons.map((lesson) => [lesson.lessonId, lesson] as const));
  const lessons = pack.lessons.map((lesson) => {
    const responsibilities =
      lesson.coreKnowledgePoints.length === 0
        ? ''
        : `；知识责任：${lesson.coreKnowledgePoints.join('；')}`;
    return `- ${lesson.title}：${lesson.objective}${responsibilities}`;
  });
  const reviews = pack.lessonReviews.map((review) => {
    const lesson = lessonById.get(review.lessonId);
    const kind = review.kind === 'final' ? '最终 Review' : '阶段 Review';
    return `### ${lesson?.title ?? '一节课程'} · ${kind}\n\n${review.markdown.trim()}`;
  });
  const missing = pack.abandonedWithoutReviewLessonIds.map(
    (lessonId) => `- ${lessonById.get(lessonId)?.title ?? '一节课程'}：已放弃且没有可用 Review`,
  );
  return [
    `课程：${pack.course.title}`,
    section('课程结构', lessons),
    section('已有课时 Review', reviews),
    section('明确的证据缺口', missing),
    pack.reviewLens === undefined ? undefined : `【本次 Review 关注】\n${pack.reviewLens.trim()}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n\n');
}

export interface GenerationReviewWriter {
  submit(pack: ReviewEvidencePack, attemptKey: string): Promise<{ taskId: string }>;
  submitCourse(pack: CourseReviewEvidencePack, attemptKey: string): Promise<{ taskId: string }>;
  complete(taskId: string): Promise<{ markdown: string; contentSha256: string }>;
}

export function createGenerationReviewWriter(options: {
  runtime: GenerationRuntime;
  execution?: GenerationExecution;
  providerId: string;
}): GenerationReviewWriter {
  return {
    async submit(pack, attemptKey) {
      if (
        pack.checkpoint.observationCompleteness !== 'complete' ||
        pack.checkpoint.teachingState.observationStatus !== 'current'
      ) {
        throw new Error('review_checkpoint_incomplete');
      }
      if (
        pack.checkpoint.sourceSnapshotHash !== pack.checkpoint.teachingState.sourceSnapshotHash ||
        pack.checkpoint.lessonId !== pack.lesson.lessonId
      ) {
        throw new Error('review_checkpoint_identity_mismatch');
      }
      const observationRefs = new Set(
        pack.observations
          .filter((observation) => observation.status === 'active')
          .map((observation) => `observation:${observation.observationId}`),
      );
      const messageIds = new Set(pack.messages.map((message) => message.messageId));
      if (
        pack.checkpoint.observationRefs.some((ref) => !observationRefs.has(ref)) ||
        pack.checkpoint.sourceMessageIds.some((messageId) => !messageIds.has(messageId))
      ) {
        throw new Error('review_evidence_pack_incomplete');
      }
      const serialized = JSON.stringify(pack);
      const evidenceBackground = renderLessonReviewEvidence(pack);
      return (options.execution ?? options.runtime).submit({
        taskKey: `${pack.kind}-review:${pack.checkpoint.checkpointId}:${sha256(serialized)}:${sha256(attemptKey).slice(0, 16)}`,
        inputSnapshotHash: sha256(serialized),
        taskKind: `${pack.kind}-review`,
        taskGroup: 'background',
        ownerRef: pack.checkpoint.checkpointId,
        providerId: options.providerId,
        priority: pack.kind === 'final' ? 80 : 50,
        prompt: `${REVIEW_CAPABILITY}\n\n${evidenceBackground}`,
      });
    },
    async submitCourse(pack, attemptKey) {
      const lessonIds = new Set(pack.lessons.map((lesson) => lesson.lessonId));
      if (
        pack.lessonReviews.some((review) => !lessonIds.has(review.lessonId)) ||
        pack.abandonedWithoutReviewLessonIds.some((lessonId) => !lessonIds.has(lessonId))
      ) {
        throw new Error('course_review_evidence_pack_invalid');
      }
      const serialized = JSON.stringify(pack);
      const sourceSnapshotHash = sha256(serialized);
      const evidenceBackground = renderCourseReviewEvidence(pack);
      return (options.execution ?? options.runtime).submit({
        taskKey: `course-review:${pack.course.courseId}:${sourceSnapshotHash}:${sha256(attemptKey).slice(0, 16)}`,
        inputSnapshotHash: sourceSnapshotHash,
        taskKind: 'course-review',
        taskGroup: 'background',
        ownerRef: pack.course.courseId,
        providerId: options.providerId,
        priority: 40,
        prompt: `${COURSE_REVIEW_CAPABILITY}\n\n${evidenceBackground}`,
      });
    },
    async complete(taskId) {
      if (options.execution !== undefined) {
        const task = await options.execution.awaitTerminal(taskId);
        if (task.status !== 'completed') throw new Error('review_generation_failed');
        const markdown = task.draftMarkdown?.trim() ?? '';
        if (markdown === '' || /<\/?[a-z][^>]*>/iu.test(markdown)) {
          throw new Error('review_output_invalid');
        }
        return { markdown, contentSha256: sha256(markdown) };
      }
      let task = await options.runtime.get(taskId);
      for (
        let index = 0;
        index < 1_000 && (task.status === 'queued' || task.status === 'running');
        index += 1
      ) {
        const ran = await options.runtime.runNext();
        task = await options.runtime.get(taskId);
        if (ran === undefined && (task.status === 'queued' || task.status === 'running')) {
          throw new Error('review_generation_scheduler_stalled');
        }
      }
      if (task.status !== 'completed') throw new Error('review_generation_failed');
      const markdown = task.draftMarkdown?.trim() ?? '';
      if (markdown === '' || /<\/?[a-z][^>]*>/iu.test(markdown)) {
        throw new Error('review_output_invalid');
      }
      return { markdown, contentSha256: sha256(markdown) };
    },
  };
}
