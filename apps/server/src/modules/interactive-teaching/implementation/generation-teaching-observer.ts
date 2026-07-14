import { createHash } from 'node:crypto';

import { TeachingObservationSchema } from '@learning-more/contracts';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { TeachingObserver } from '../ports/teaching-observer.js';

const OBSERVATION_CAPABILITY = [
  '只观察给定消息范围相对于当前课节和前一账本产生的局部教学事实。',
  '所有关系和条目必须引用给定的有效来源 ID；不能推断稳定人格、能力等级或永久思维类型。',
  '可以记录用户实际表现出的具体思维行为，但行为类型和摘要保持开放语义，不使用固定维度表。',
  '被中断的助手输出可以留作过程记录，但不能作为完整教学或学习效果证据。',
  '与课程相关但不属于本课的探索记为 adjacent；不确定时使用 unclear；没有可靠变化时返回空 entries。',
  'JSON 形状：scope={alignment,relationRefs,rationale}；entries 每项={entryId,kind,summary,knowledgePointRefs,sourceRefs,resolvesEntryRefs,qualityFlags}，assessment、explicitness、elicitation 可按证据选填。',
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
      const raw = parseJson(task.draftMarkdown ?? '') as {
        scope?: unknown;
        entries?: unknown;
      };
      return TeachingObservationSchema.parse({
        observationId:
          options.nextObservationId?.(input.sourceSnapshotHash) ??
          `observation_${sha256(`${input.sessionId}:${input.sourceSnapshotHash}:${observerVersion}`).slice(0, 32)}`,
        schemaVersion: 1,
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        turnSequence: input.turnSequence,
        sourceMessageIds: input.messages.map((message) => message.messageId),
        sourceSnapshotHash: input.sourceSnapshotHash,
        scope: raw.scope,
        entries: raw.entries,
        observerVersion,
        observedAt: (options.now?.() ?? new Date()).toISOString(),
        status: 'active',
      });
    },
  };
}
