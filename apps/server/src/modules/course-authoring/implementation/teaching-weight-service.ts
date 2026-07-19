import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CourseCreationRepositories } from '../ports/course-repositories.js';
import type {
  TeachingWeightMetadataRecord,
  TeachingWeightRepository,
} from '../ports/teaching-weight-repository.js';

export const TEACHING_WEIGHT_ANALYZER_VERSION = 'teaching-weight-analyzer-v1';

const WeightOutputSchema = z.strictObject({
  lessons: z.array(
    z.strictObject({
      lessonId: z.string().min(1),
      keyKnowledgePoints: z.array(
        z.strictObject({
          index: z.number().int().nonnegative(),
          rationale: z.string().trim().min(1).max(1_000),
        }),
      ),
    }),
  ),
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseOutput(markdown: string) {
  const trimmed = markdown.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/u.exec(trimmed);
  return WeightOutputSchema.parse(JSON.parse((fenced?.[1] ?? trimmed).trim()) as unknown);
}

export function createTeachingWeightService(options: {
  courses: CourseCreationRepositories;
  repository: TeachingWeightRepository;
  unitOfWork: UnitOfWork;
  execution: GenerationExecution;
  providerId: string;
  now(): Date;
}) {
  const active = new Map<string, Promise<TeachingWeightMetadataRecord | undefined>>();

  async function analyzeCourse(
    courseId: string,
  ): Promise<TeachingWeightMetadataRecord | undefined> {
    const course = await options.courses.courses.get(courseId);
    if (course === undefined) return undefined;
    const outline = await options.courses.outlineVersions.get(course.outlineVersionId);
    if (outline === undefined) return undefined;
    const lessons = (
      await Promise.all(course.lessonIds.map((lessonId) => options.courses.lessons.get(lessonId)))
    ).filter((lesson) => lesson !== undefined);
    const snapshot = {
      outlineVersionId: outline.id,
      courseId,
      courseTitleMarkdown: outline.outlineMarkdown,
      lessons: lessons.map((lesson) => ({
        lessonId: lesson.id,
        title: lesson.title,
        objective: lesson.objective,
        prerequisiteLessonIds: lesson.prerequisiteLessonIds,
        coreKnowledgePoints: lesson.coreKnowledgePoints,
      })),
    };
    const sourceSnapshotHash = sha256(JSON.stringify(snapshot));
    const current = await options.repository.get(outline.id);
    if (current?.state === 'completed') return current;
    const attempt = (current?.attempt ?? 0) + 1;
    const prompt = [
      '你是课程知识点教学权重分析器。大纲已经正式生成，不得改写标题、目标、顺序或知识点文本。',
      '只判断哪些知识点是本课程版本中的固定重点。重点应具备至少一种特征：课程目标核心、复杂依赖中心、关键前置、易错易漏、边界条件重要、容易与相邻概念混淆，或对后续迁移有显著支撑。',
      '不要为了均匀分布而强行选择重点；简单知识点可以不标记。',
      '只返回 JSON。每个 lessonId 必须来自输入；index 是该课节 coreKnowledgePoints 的零基索引；rationale 简洁说明课程设计层面的原因。',
      JSON.stringify({
        lessons: [
          {
            lessonId: '输入中的课节ID',
            keyKnowledgePoints: [{ index: 0, rationale: '为什么是固定重点' }],
          },
        ],
      }),
      '【正式大纲事实】',
      JSON.stringify(snapshot),
    ].join('\n\n');
    const task = await options.execution.submit({
      taskKey: `teaching-weight:${outline.id}:${TEACHING_WEIGHT_ANALYZER_VERSION}:${sourceSnapshotHash}:attempt:${attempt}`,
      inputSnapshotHash: sourceSnapshotHash,
      taskKind: 'teaching-weight-analysis',
      taskGroup: 'background',
      ownerRef: outline.id,
      providerId: options.providerId,
      priority: 15,
      prompt,
    });
    const timestamp = options.now().toISOString();
    const generating: TeachingWeightMetadataRecord = {
      schemaVersion: 1,
      outlineVersionId: outline.id,
      courseId,
      analyzerVersion: TEACHING_WEIGHT_ANALYZER_VERSION,
      sourceSnapshotHash,
      state: 'generating',
      attempt,
      generationTaskId: task.taskId,
      keyKnowledgePoints: [],
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
      resourceVersion: current?.resourceVersion ?? 0,
    };
    await options.unitOfWork.execute(
      { transactionId: `tx_teaching_weight_start_${outline.id}_${attempt}` },
      (tx) => options.repository.save(tx, generating, current?.resourceVersion ?? 0),
    );
    const storedGenerating = { ...generating, resourceVersion: generating.resourceVersion + 1 };
    const terminal = await options.execution.awaitTerminal(task.taskId);
    if (terminal.status !== 'completed' || terminal.draftMarkdown === undefined) {
      const failed: TeachingWeightMetadataRecord = {
        ...storedGenerating,
        state: 'failed',
        errorCode: terminal.errorCode ?? `teaching_weight_${terminal.status}`,
        updatedAt: options.now().toISOString(),
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_teaching_weight_fail_${outline.id}_${attempt}` },
        (tx) => options.repository.save(tx, failed, storedGenerating.resourceVersion),
      );
      return { ...failed, resourceVersion: failed.resourceVersion + 1 };
    }
    try {
      const output = parseOutput(terminal.draftMarkdown);
      const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
      const seen = new Set<string>();
      const keyKnowledgePoints = output.lessons.flatMap((result) => {
        const lesson = lessonById.get(result.lessonId);
        if (lesson === undefined) throw new Error('teaching_weight_unknown_lesson');
        return result.keyKnowledgePoints.map((point) => {
          if (point.index >= lesson.coreKnowledgePoints.length) {
            throw new Error('teaching_weight_unknown_knowledge_point');
          }
          const key = `${lesson.id}:${point.index}`;
          if (seen.has(key)) throw new Error('teaching_weight_duplicate_knowledge_point');
          seen.add(key);
          return {
            lessonId: lesson.id,
            knowledgePointIndex: point.index,
            rationale: point.rationale,
          };
        });
      });
      const completed: TeachingWeightMetadataRecord = {
        ...storedGenerating,
        state: 'completed',
        keyKnowledgePoints,
        updatedAt: options.now().toISOString(),
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_teaching_weight_complete_${outline.id}_${attempt}` },
        (tx) => options.repository.save(tx, completed, storedGenerating.resourceVersion),
      );
      return { ...completed, resourceVersion: completed.resourceVersion + 1 };
    } catch (error) {
      const failed: TeachingWeightMetadataRecord = {
        ...storedGenerating,
        state: 'failed',
        errorCode: error instanceof Error ? error.message : 'teaching_weight_output_invalid',
        updatedAt: options.now().toISOString(),
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_teaching_weight_invalid_${outline.id}_${attempt}` },
        (tx) => options.repository.save(tx, failed, storedGenerating.resourceVersion),
      );
      return { ...failed, resourceVersion: failed.resourceVersion + 1 };
    }
  }

  return {
    ensureForCourse(courseId: string) {
      const existing = active.get(courseId);
      if (existing !== undefined) return existing;
      const running = analyzeCourse(courseId).finally(() => active.delete(courseId));
      active.set(courseId, running);
      return running;
    },
    get: options.repository.get,
  };
}
