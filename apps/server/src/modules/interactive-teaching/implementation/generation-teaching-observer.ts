import { createHash } from 'node:crypto';

import {
  TeachingObservationEntrySchema,
  TeachingObservationSchema,
  TeachingScopeRelationSchema,
} from '@learning-more/contracts';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { TeachingObserver } from '../ports/teaching-observer.js';

const OBSERVATION_CAPABILITY = [
  '只观察给定消息范围相对于当前课节和前一账本产生的局部教学事实。',
  '所有关系和条目必须引用给定的有效来源 ID；不能推断稳定人格、能力等级或永久思维类型。',
  '可以记录用户实际表现出的具体思维行为，但行为类型和摘要保持开放语义，不使用固定维度表。',
  '被中断的助手输出可以留作过程记录，但不能作为完整教学或学习效果证据。',
  '与课程相关但不属于本课的探索记为 adjacent；不确定时使用 unclear；没有可靠变化时返回空 entries。',
  'JSON 形状：scope={alignment,relationRefs,rationale}；entries 每项={entryId,kind,summary,knowledgePointRefs,sourceRefs,resolvesEntryRefs,qualityFlags}，assessment、explicitness、elicitation、progressionSignal 可按证据选填。',
  '只使用以下枚举：scope.alignment=direct|supporting|adjacent|unclear|off_scope；kind=teaching_delivery|learner_demonstration|learner_misconception|learner_question|learner_intent|learner_reasoning_behavior|adjacent_exploration|open_loop。',
  'assessment=supports|limits|uncertain；explicitness=user_declared|ai_observed；elicitation=spontaneous|elicited|mixed|unknown；qualityFlags 只能使用 direct|complete|ambiguous。不要创造 aligned、current、explicit、teaching_clarification 等新值。',
  'progressionSignal 只记录明确可验证的流程事实：skip_knowledge_point 表示用户明确跳过当前知识点；pass_comprehensive_check 表示综合检测回答已通过；skip_comprehensive_check 表示用户明确跳过综合检测；lesson_summary_delivered 表示助手已经完成本课总结。不得仅凭对话顺畅推断这些信号。',
  '知识点检测通过使用 learner_demonstration + assessment=supports；未通过或仍不稳定使用 assessment=limits/uncertain。用户提出且尚未被回答的相关疑问还要记录为 open_loop；疑问被解决时用 resolvesEntryRefs 关闭，未关闭前不得推进知识点。',
  'learner_reasoning_behavior 的 elicitation 用 spontaneous、elicited、mixed 或 unknown，表示该行为是否由教学任务直接引出；它不改变行为事实本身。',
  '只返回 scope 与 entries 的 JSON 数据，不输出 Markdown 说明。',
].join('\n');

const OBSERVATION_LENS_POLICY =
  '输入中的 observationLens 只决定优先注意的可验证信号；它不是完成条件，也不能排除其他有价值的学习行为。';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseJson(markdown: string): unknown {
  const trimmed = markdown.trim();
  const unwrapped = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
    : trimmed;
  return JSON.parse(unwrapped) as unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalEnum(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

const scopeAlignments = new Set(['direct', 'supporting', 'adjacent', 'unclear', 'off_scope']);
const assessments = new Set(['supports', 'limits', 'uncertain']);
const explicitnessValues = new Set(['user_declared', 'ai_observed']);
const elicitationValues = new Set(['spontaneous', 'elicited', 'mixed', 'unknown']);
const progressionSignals = new Set([
  'skip_knowledge_point',
  'pass_comprehensive_check',
  'skip_comprehensive_check',
  'lesson_summary_delivered',
]);
const qualityFlags = new Set(['direct', 'complete', 'ambiguous']);

function normalizeScope(value: unknown) {
  const candidate = record(value);
  const rawAlignment = candidate?.alignment;
  const alignment =
    rawAlignment === 'aligned' || rawAlignment === 'current'
      ? 'direct'
      : optionalEnum(rawAlignment, scopeAlignments) ?? 'unclear';
  const relationRefs = Array.isArray(candidate?.relationRefs)
    ? candidate.relationRefs.filter((item): item is string => typeof item === 'string')
    : [];
  const rationale =
    typeof candidate?.rationale === 'string' && candidate.rationale.trim() !== ''
      ? candidate.rationale
      : 'Generated observation scope was incomplete.';
  const parsed = TeachingScopeRelationSchema.safeParse({ alignment, relationRefs, rationale });
  return parsed.success
    ? parsed.data
    : {
        alignment: 'unclear' as const,
        relationRefs: [],
        rationale: 'Generated observation scope was invalid.',
      };
}

function normalizeEntry(value: unknown) {
  const candidate = record(value);
  if (candidate === undefined) return undefined;
  const assessment = optionalEnum(candidate.assessment, assessments);
  const explicitness = optionalEnum(candidate.explicitness, explicitnessValues);
  const elicitation = optionalEnum(candidate.elicitation, elicitationValues);
  const progressionSignal = optionalEnum(candidate.progressionSignal, progressionSignals);
  const parsed = TeachingObservationEntrySchema.safeParse({
    entryId: candidate.entryId,
    kind: candidate.kind,
    summary: candidate.summary,
    knowledgePointRefs: candidate.knowledgePointRefs,
    sourceRefs: candidate.sourceRefs,
    ...(assessment === undefined ? {} : { assessment }),
    ...(explicitness === undefined ? {} : { explicitness }),
    ...(elicitation === undefined ? {} : { elicitation }),
    ...(progressionSignal === undefined ? {} : { progressionSignal }),
    resolvesEntryRefs: candidate.resolvesEntryRefs,
    qualityFlags: Array.isArray(candidate.qualityFlags)
      ? candidate.qualityFlags.filter(
          (item): item is string => typeof item === 'string' && qualityFlags.has(item),
        )
      : [],
  });
  return parsed.success ? parsed.data : undefined;
}

function parseGeneratedObservation(markdown: string) {
  const raw = record(parseJson(markdown));
  if (raw === undefined) throw new Error('teaching_observation_json_object_required');
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(normalizeEntry).filter((entry) => entry !== undefined)
    : [];
  return { scope: normalizeScope(raw.scope), entries };
}

export function createGenerationTeachingObserver(options: {
  runtime: GenerationRuntime;
  execution?: GenerationExecution;
  providerId: string;
  observerVersion?: string;
  nextObservationId?: (sourceSnapshotHash: string) => string;
  now?: () => Date;
}): TeachingObserver {
  const observerVersion = options.observerVersion ?? 'teaching-observer@1';
  return {
    async observe(input) {
      const serializedInput = JSON.stringify(input);
      const handle = await (options.execution ?? options.runtime).submit({
        taskKey: `teaching-observation:${input.sessionId}:${input.sourceSnapshotHash}:${observerVersion}`,
        inputSnapshotHash: input.sourceSnapshotHash,
        taskKind: 'interactive-teaching-observation',
        taskGroup: 'background',
        ownerRef: input.sessionId,
        providerId: options.providerId,
        priority: 60,
        prompt: `${OBSERVATION_CAPABILITY}\n${OBSERVATION_LENS_POLICY}\n\n${serializedInput}`,
      });
      const task =
        options.execution === undefined
          ? await (async () => {
              let current = await options.runtime.get(handle.taskId);
              for (
                let index = 0;
                index < 1_000 && (current.status === 'queued' || current.status === 'running');
                index += 1
              ) {
                const ran = await options.runtime.runNext();
                current = await options.runtime.get(handle.taskId);
                if (
                  ran === undefined &&
                  (current.status === 'queued' || current.status === 'running')
                ) {
                  throw new Error('teaching_observation_scheduler_stalled');
                }
              }
              return current;
            })()
          : await options.execution.awaitTerminal(handle.taskId);
      if (task.status !== 'completed') throw new Error('teaching_observation_generation_failed');
      const observationBase = {
        observationId:
          options.nextObservationId?.(input.sourceSnapshotHash) ??
          `observation_${sha256(`${input.sessionId}:${input.sourceSnapshotHash}:${observerVersion}`).slice(0, 32)}`,
        schemaVersion: 1,
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        turnSequence: input.turnSequence,
        sourceMessageIds: input.messages.map((message) => message.messageId),
        sourceSnapshotHash: input.sourceSnapshotHash,
        observerVersion,
        observedAt: (options.now?.() ?? new Date()).toISOString(),
        status: 'active',
      } as const;
      try {
        const raw = parseGeneratedObservation(task.draftMarkdown ?? '');
        return TeachingObservationSchema.parse({
          ...observationBase,
          scope: raw.scope,
          entries: raw.entries,
        });
      } catch {
        return TeachingObservationSchema.parse({
          ...observationBase,
          scope: {
            alignment: 'unclear',
            relationRefs: [],
            rationale: 'Generated observation was invalid; no evidence was projected.',
          },
          entries: [],
        });
      }
    },
  };
}
