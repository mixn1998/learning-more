import { createHash } from 'node:crypto';

import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { NextLessonRecommender } from '../interface.js';
import { eligibleNextLessons } from './eligible-lessons.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parse(markdown: string): {
  semanticKey: string;
  rankedSemanticKeys: readonly string[];
  rationale: string;
  evidenceRefs: readonly string[];
  confidence: number;
} {
  const trimmed = markdown.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/u.exec(trimmed);
  const value = JSON.parse((fenced?.[1] ?? trimmed).trim()) as Record<string, unknown>;
  if (typeof value.semanticKey !== 'string' || value.semanticKey === '') {
    throw new Error('next_lesson_output_invalid');
  }
  if (typeof value.rationale !== 'string' || value.rationale === '') {
    throw new Error('next_lesson_output_invalid');
  }
  const rankedSemanticKeys = Array.isArray(value.rankedSemanticKeys)
    ? value.rankedSemanticKeys.filter((item): item is string => typeof item === 'string')
    : [value.semanticKey];
  const evidenceRefs = Array.isArray(value.evidenceRefs)
    ? value.evidenceRefs.filter((item): item is string => typeof item === 'string')
    : [];
  const confidence =
    typeof value.confidence === 'number' && value.confidence >= 0 && value.confidence <= 1
      ? value.confidence
      : 0.5;
  return {
    semanticKey: value.semanticKey,
    rankedSemanticKeys,
    rationale: value.rationale,
    evidenceRefs,
    confidence,
  };
}

const NEXT_LESSON_OUTPUT_EXAMPLE = {
  semanticKey: 'lesson-reference',
  rankedSemanticKeys: ['lesson-reference'],
  rationale: '为什么这节课适合作为当前下一步',
  evidenceRefs: ['available-evidence-reference'],
  confidence: 0.7,
} as const;

function triggerLabel(
  trigger: Parameters<NextLessonRecommender['recommend']>[0]['trigger'],
): string {
  if (trigger === 'course-confirmed') return '课程刚刚确认';
  if (trigger === 'outline-revised') return '课程大纲刚刚调整';
  if (trigger === 'lesson-completed') return '学习者刚刚完成一节课';
  return '学习计划刚刚变化';
}

function renderRecommendationPrompt(
  input: Parameters<NextLessonRecommender['recommend']>[0],
  eligible: ReturnType<typeof eligibleNextLessons>,
): string {
  const candidates = eligible.map((candidate) => {
    const prerequisites =
      candidate.prerequisiteSemanticKeys.length === 0
        ? '无前置要求'
        : `前置课节标识：${candidate.prerequisiteSemanticKeys.join('、')}`;
    const evidence =
      candidate.evidenceRefs === undefined || candidate.evidenceRefs.length === 0
        ? '没有额外证据标记'
        : `可引用证据标记：${candidate.evidenceRefs.join('、')}`;
    return `### ${candidate.title}\n课节标识：${candidate.semanticKey}\n学习目标：${candidate.objective}\n预计时长：${candidate.estimatedMinutes} 分钟\n${prerequisites}\n${evidence}`;
  });
  const background = [
    `推荐时点：${triggerLabel(input.trigger)}`,
    input.completedSemanticKeys.length === 0
      ? '目前没有已完成课节。'
      : `已完成课节标识：${input.completedSemanticKeys.join('、')}`,
    input.currentFinalReviewMarkdown === undefined
      ? undefined
      : `最近一节课的 Final Review：\n${input.currentFinalReviewMarkdown.trim()}`,
    input.planSummary === undefined ? undefined : `当前计划摘要：\n${input.planSummary.trim()}`,
    input.previousRecommendation === undefined
      ? undefined
      : `此前建议过课节标识 ${input.previousRecommendation.semanticKey}；当时理由：${input.previousRecommendation.rationale}`,
  ].filter((value): value is string => value !== undefined);
  return [
    '只在可选课节中排序并说明学习理由；不要开始课节、修改日程或暗示用户已经确认。',
    '',
    '【机器输出契约】',
    '只返回一个 JSON 对象；课节标识和证据标记只能使用背景中明确给出的值。',
    JSON.stringify(NEXT_LESSON_OUTPUT_EXAMPLE),
    '',
    '【当前学习背景】',
    background.join('\n\n'),
    '',
    '【可选课节】',
    candidates.join('\n\n'),
  ].join('\n');
}

export function createGenerationNextLessonRecommender(options: {
  execution: GenerationExecution;
  providerId: string;
  now?: () => Date;
}): NextLessonRecommender {
  return {
    async recommend(input) {
      const eligible = eligibleNextLessons(input.candidates, input.completedSemanticKeys);
      if (eligible.length === 0) throw new Error('next_lesson_candidate_empty');
      const context = { ...input, eligible };
      const serialized = JSON.stringify(context);
      const sourceSnapshotHash = sha256(serialized);
      const prompt = renderRecommendationPrompt(input, eligible);
      const task = await options.execution.submit({
        taskKey: `next-lesson:${input.courseId}:${input.trigger}:${sourceSnapshotHash}`,
        inputSnapshotHash: sourceSnapshotHash,
        taskKind: 'next-lesson-recommendation',
        taskGroup: 'interactive',
        ownerRef: input.courseId,
        providerId: options.providerId,
        priority: 80,
        prompt,
      });
      const terminal = await options.execution.awaitTerminal(task.taskId);
      if (terminal.status !== 'completed' || terminal.draftMarkdown === undefined) {
        throw Object.assign(new Error('next_lesson_ai_unavailable'), {
          code: terminal.errorCode ?? 'ai_unavailable',
        });
      }
      const result = parse(terminal.draftMarkdown);
      const eligibleKeys = new Set(eligible.map((candidate) => candidate.semanticKey));
      const warnings: string[] = [];
      const rawRanking = [result.semanticKey, ...result.rankedSemanticKeys].filter(
        (key, index, all) => all.indexOf(key) === index,
      );
      const rankedSemanticKeys = rawRanking.filter((key) => {
        const valid = eligibleKeys.has(key);
        if (!valid) warnings.push(`filtered_ineligible_rank:${key}`);
        return valid;
      });
      const semanticKey = rankedSemanticKeys[0];
      if (semanticKey === undefined) throw new Error('next_lesson_ineligible');
      const allowedEvidenceRefs = new Set(
        eligible.flatMap((candidate) => candidate.evidenceRefs ?? []),
      );
      const evidenceRefs = result.evidenceRefs.filter((ref) => {
        const valid = allowedEvidenceRefs.has(ref);
        if (!valid) warnings.push(`filtered_unknown_evidence:${ref}`);
        return valid;
      });
      const now = options.now?.() ?? new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();
      return {
        versionId: `next_lesson_${sourceSnapshotHash.slice(0, 24)}`,
        semanticKey,
        rankedSemanticKeys,
        rationale: result.rationale,
        evidenceRefs,
        confidence: result.confidence,
        expiresAt,
        sourceSnapshotHash,
        status: 'current',
        warnings,
      };
    },
  };
}
