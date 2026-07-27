import { createHash } from 'node:crypto';

import {
  ReviewTextBlockSchema,
  ReviewDocumentSchema,
  reviewDocumentToMarkdown,
  type ReviewDocument,
  type TeachingCheckpointSnapshot,
  type TeachingObservation,
} from '@learning-more/contracts';
import { z } from 'zod';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { MaterializedTeachingMessage } from '../../interactive-teaching/interface.js';
import { parseJsonWithSyntaxRepair } from './review-json-syntax.js';

const REVIEW_CAPABILITY = [
  '根据完整、冻结且可追溯的教学证据生成学习者可见 Review。',
  '先忠实覆盖本课知识责任、实际教学、学习者证据、未解决项与教学支线；支线不能冒充本课覆盖或未来课节完成。',
  'knowledgeMap 只负责把本课知识点串成关系图式：优先输出一条主链，必要时最多补两条分支链；使用“节点 → 节点”表达，不在 knowledgeMap 中重复正文解释。',
  'lesson-final 同时承担两项边界清晰的工作：知识图谱与学习表现来自冻结证据；核心思想仅以【最终课堂总结·仅供语义收束】中的知识性内容为来源；本课方法论启示只对指定的综合应用来源做语义收束。',
  'coreInsight 必须返回。它应理解最终课堂总结，识别其中承担知识表达的有效语义，并动态保留完成理解所必需的总结结构；结构可以随课程内容表现为概念关系、因果链、判断框架、操作步骤、条件对比、推理过程、适用边界或其他必要形式。允许保留必要段落、列表与层次，不得套用固定框架。有效知识内容允许原样保留，不要求改写。',
  'coreInsight 必须保留承载语义的 Markdown 格式，包括原总结中有助于理解的加粗、分段、编号层级、列表、引用块、代码或公式；不要把清晰的关系链、分项解释和结论段改写成连续的大段正文。只移除不承载知识结构的装饰性格式，不新增原总结没有的事实、案例、解释或结构。',
  'methodologyInsight 可选且最多一句。它应从综合应用所连接的知识关系中提炼可迁移的方法、判断原则或技巧；不要复述知识点清单，不要使用“把本课合起来看”“本课真正值得保留的是”等引导语。',
  'coreInsight 只在最终课堂总结内部进行语义识别：完成宣布、用户评价、掌握判断、互动复盘、鼓励、未来学习建议、课程流程说明和不承载知识含义的过渡语不属于核心思想；对承担知识表达的部分，保留其原有措辞、顺序和结构，只合并真正同义的重复表述，不得把互相支撑的不同层次误判为重复。不得从教学与学习证据、学习者原话、学习表现或 Review 关注中向 coreInsight 补充内容。',
  'coreInsight 应在不损失必要总结结构、关键关系、推理链和边界条件的前提下使用清晰紧凑的表达；不得为了简短而删除完成理解所需要的信息，也不得强制压缩成一句话。methodologyInsight 仍负责一句高度凝练、可迁移的方法或技巧，不承担完整总结职责。',
  '综合应用来源包含从任务提出到纠偏或收束的完整片段。提炼 methodologyInsight 时优先保留其中最具体、最能迁移的关系或技巧；后出现的流程过渡只提供语境，不因位置更晚而自动覆盖更具体的收束。',
  '用户没有直接回答或明确跳过综合应用时，仍可依据综合应用任务、AI 的纠偏或关系收束、最终课堂总结提炼方法论；但不得据此声称用户已经掌握、通过或形成了相应能力。来源不足以形成真实方法论时省略 methodologyInsight。',
  'performance 在后端继续完整记录可追溯表现与待验证项；每个条目的标题必须明确表示“已形成/做得好”或“尚待验证/接下来”，以便前端归并为两个阅读区块。每个条目的用户可见 markdown 必须统一使用第二人称“你”，不得以“学习者”或“用户”称呼当前学习者；每个条目必须是语义完整的表达，不得留下“你将”等缺少后续内容的残句。',
  '如果本课对话确实涉及有价值但不属于本课主线的课程邻接探索，可在 additionalSections 中保留一个附加模块，标题以“课程邻接探索：”开头，并明确它不替代本课责任；没有实际邻接探索时省略该模块，不要为了凑结构生成。',
  '可选互动关注只改变叙事关注重心，不筛除证据、不决定完成度，也不规定章节和表达形式。',
  '不要补写未发生的表现、掌握或观点变化。各 markdown 字段可自由组织，不要套用模板句。',
].join('\n');

const COURSE_REVIEW_CAPABILITY = [
  '根据冻结的课程结构、全部可用课时 Review 与明确缺口生成课程总 Review。',
  '忠实区分已完成课节、有阶段证据的放弃课节和没有 Review 的放弃课节；缺失证据不能被补写成学习表现。',
  '可选互动关注只改变叙事关注重心，不筛除课程证据、不改变完成事实，也不规定章节和表达形式。',
  '不要套用固定标题、固定段落或固定推荐。各 markdown 字段可自由组织并保持可追溯。',
].join('\n');

function outputContract(kind: ReviewDocument['kind']): string {
  const fields =
    kind === 'lesson-final'
      ? 'title, knowledgeMap:{title,markdown,evidenceRefs?}, coreInsight, methodologyInsight?, performance:[{title,markdown,evidenceRefs?}], additionalSections?'
      : kind === 'lesson-stage'
        ? 'title, lead, establishedUnderstanding:[{title,markdown,evidenceRefs?}], pendingValidation:[{title,markdown,evidenceRefs?}], knowledgeMap:{title,markdown,evidenceRefs?}, performance:[{title,markdown,evidenceRefs?}], continuationNotice, additionalSections?'
        : 'title, lead?, knowledgeThreads:[{title,markdown,evidenceRefs?}], strengths:[{title,markdown,evidenceRefs?}], development:[{title,markdown,evidenceRefs?}], boundaries:[{title,markdown,evidenceRefs?}], extensions:[{title,markdown,evidenceRefs?}], sourceCoverage?, additionalSections?';
  return [
    '接口输出协议：只返回一个 JSON 对象，不要使用代码围栏或附加说明。',
    `固定识别字段：{"schemaVersion":1,"kind":"${kind}"}。`,
    `内容字段：${fields}。`,
    '未知的有价值内容可以放入 additionalSections；evidenceRefs 只填写证据中真实存在的 E 编号（例如 E1），必须原样使用，不要输出或编造 message UUID。',
  ].join('\n');
}

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
  classroomSummary?: Readonly<{
    sourceMessageId: string;
    markdown: string;
  }>;
  comprehensiveSynthesis?: Readonly<{
    sourceMessageId: string;
    markdown: string;
  }>;
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
  const sourceMessageIds = new Set(pack.checkpoint.sourceMessageIds);
  const evidenceAliasByMessageId = new Map(
    pack.checkpoint.sourceMessageIds.map(
      (messageId, index) => [messageId, `E${index + 1}`] as const,
    ),
  );
  const dialogue = pack.messages
    .filter(
      (message) =>
        message.role === 'user' &&
        message.completionStatus !== 'failed' &&
        sourceMessageIds.has(message.messageId),
    )
    .map((message) => {
      const interrupted = message.completionStatus === 'interrupted' ? '（未完成）' : '';
      return `- [${evidenceAliasByMessageId.get(message.messageId)}] 学习者${interrupted}：${message.markdown.trim()}`;
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
    section('必要的学习者原话证据', dialogue),
    pack.kind !== 'final' || pack.classroomSummary === undefined
      ? undefined
      : `【最终课堂总结·仅供语义收束】\n${pack.classroomSummary.markdown.trim()}`,
    pack.kind !== 'final' || pack.comprehensiveSynthesis === undefined
      ? undefined
      : `【综合应用关系收束·用户回答可为空】\n${pack.comprehensiveSynthesis.markdown.trim()}`,
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
  complete(taskId: string): Promise<{
    markdown: string;
    contentSha256: string;
    document?: ReviewDocument;
    lessonFinalAnalysis?: LessonFinalReviewAnalysis;
  }>;
}

const LessonFinalReviewAnalysisSchema = z.looseObject({
  schemaVersion: z.literal(1),
  kind: z.literal('lesson-final'),
  title: z.string().trim().min(1),
  knowledgeMap: ReviewTextBlockSchema,
  methodologyInsight: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .refine((value) => !/[\r\n]/u.test(value))
    .optional(),
  coreInsight: z.string().trim().min(1),
  performance: z.array(ReviewTextBlockSchema).min(1),
  additionalSections: z.array(ReviewTextBlockSchema).optional(),
});

export type LessonFinalReviewAnalysis = Readonly<z.infer<typeof LessonFinalReviewAnalysisSchema>>;

function expectedDocumentKind(taskKind: string | undefined): ReviewDocument['kind'] | undefined {
  return taskKind === 'final-review'
    ? 'lesson-final'
    : taskKind === 'stage-review'
      ? 'lesson-stage'
      : taskKind === 'course-review'
        ? 'course-final'
        : undefined;
}

function parseDocument(raw: string, taskKind: string | undefined): ReviewDocument | undefined {
  const trimmed = raw.trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) return undefined;
  const repaired = parseJsonWithSyntaxRepair(trimmed.slice(first, last + 1));
  const parsed = ReviewDocumentSchema.safeParse(repaired);
  if (!parsed.success) return undefined;
  const expectedKind = expectedDocumentKind(taskKind);
  return expectedKind === undefined || parsed.data.kind === expectedKind ? parsed.data : undefined;
}

function generatedResult(raw: string, taskKind: string | undefined) {
  if (taskKind === 'final-review') {
    const trimmed = raw.trim();
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    const lessonFinalAnalysis =
      first < 0 || last <= first
        ? undefined
        : LessonFinalReviewAnalysisSchema.safeParse(
            parseJsonWithSyntaxRepair(trimmed.slice(first, last + 1)),
          );
    if (lessonFinalAnalysis === undefined || !lessonFinalAnalysis.success) {
      throw new Error('review_output_contract_invalid');
    }
    return {
      markdown: '',
      contentSha256: sha256(trimmed),
      lessonFinalAnalysis: lessonFinalAnalysis.data,
    };
  }
  const document = parseDocument(raw, taskKind);
  if (expectedDocumentKind(taskKind) !== undefined && document === undefined) {
    throw new Error('review_output_contract_invalid');
  }
  const markdown = document === undefined ? raw.trim() : reviewDocumentToMarkdown(document);
  if (markdown === '' || /<\/?[a-z][^>]*>/iu.test(markdown)) {
    throw new Error('review_output_invalid');
  }
  return {
    markdown,
    contentSha256: sha256(markdown),
    ...(document === undefined ? {} : { document }),
  };
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
      const submitted = await (options.execution ?? options.runtime).submit({
        taskKey: `${pack.kind}-review:${pack.checkpoint.checkpointId}:${sha256(serialized)}:${sha256(attemptKey).slice(0, 16)}`,
        inputSnapshotHash: sha256(serialized),
        taskKind: `${pack.kind}-review`,
        taskGroup: 'background',
        ownerRef: pack.checkpoint.checkpointId,
        providerId: options.providerId,
        priority: pack.kind === 'final' ? 80 : 50,
        prompt: `${REVIEW_CAPABILITY}\n\n${outputContract(pack.kind === 'final' ? 'lesson-final' : 'lesson-stage')}\n\n${evidenceBackground}`,
      });
      return submitted;
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
        prompt: `${COURSE_REVIEW_CAPABILITY}\n\n${outputContract('course-final')}\n\n${evidenceBackground}`,
      });
    },
    async complete(taskId) {
      if (options.execution !== undefined) {
        const task = await options.execution.awaitTerminal(taskId);
        if (task.status !== 'completed') throw new Error('review_generation_failed');
        return generatedResult(task.draftMarkdown ?? '', task.taskKind);
      }
      let task = await options.runtime.get(taskId);
      while (task.status === 'queued' || task.status === 'running') {
        const ran = await options.runtime.runNext();
        task = await options.runtime.get(taskId);
        if (ran === undefined && (task.status === 'queued' || task.status === 'running')) {
          throw new Error('review_generation_scheduler_stalled');
        }
      }
      if (task.status !== 'completed') throw new Error('review_generation_failed');
      return generatedResult(task.draftMarkdown ?? '', task.taskKind);
    },
  };
}
