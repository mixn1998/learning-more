import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { GenerationExecution, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { SemanticProfileCoreMerger } from '../ports/semantic-profile-core-merger.js';

const MERGE_POLICY = [
  '你负责把一条新增课节 Review 的会话级观察，增量归并到一个有界的跨会话语义核心。不要重新分析任何未提供的历史。',
  '每条模式只能表达一个真正稳定、能够改变教学决策的学习特征；相近维度必须语义合并，禁止换种说法重复保留。',
  'observed_behavior 是行为推断，explicit_preference 是用户明确偏好；二者不得合并或互相改写。',
  '若观察没有明确教学影响，将 observationId 放入 ignoredObservationIds，不要为了填满模式而保留。',
  'assignments 每项表示一个语义模式：sourceModeIds 是本次被沿用或合并的现有模式；observationIds 是本次归入该模式的新观察。',
  '同一现有稳定模式可以被完善，但不得把两个已有稳定模式强行合并；候选可以并入稳定模式或彼此合并。',
  'feature 用一句简短陈述只表达一个学习特征；teachingImpact 明确说明教学应如何调整；applicabilityBoundary 明确不能外推到什么情境。',
  'priority 使用 1 到 5 的整数，5 表示最能改变教学决策。',
  '每个 observationId 必须且只能出现在一个 assignment 或 ignoredObservationIds 中。',
  '只返回 JSON：{"assignments":[{"sourceModeIds":[],"observationIds":[],"mode":{"origin":"observed_behavior","feature":"...","teachingImpact":"...","applicabilityBoundary":"...","priority":5}}],"ignoredObservationIds":[]}。',
].join('\n');

const ModeSchema = z.strictObject({
  origin: z.enum(['observed_behavior', 'explicit_preference']),
  feature: z.string().trim().min(1).max(240),
  teachingImpact: z.string().trim().min(1).max(400),
  applicabilityBoundary: z.string().trim().min(1).max(400),
  priority: z.number().int().min(1).max(5),
});

const ResultSchema = z.strictObject({
  assignments: z.array(
    z.strictObject({
      sourceModeIds: z.array(z.string().trim().min(1)).max(8),
      observationIds: z.array(z.string().trim().min(1)).min(1),
      mode: ModeSchema,
    }),
  ),
  ignoredObservationIds: z.array(z.string().trim().min(1)),
});

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

export function createGenerationSemanticProfileCoreMerger(options: {
  runtime: GenerationRuntime;
  execution?: GenerationExecution;
  providerId: string;
  mergerVersion: string;
}): SemanticProfileCoreMerger {
  return {
    version: options.mergerVersion,
    async merge(input) {
      if (input.observations.length === 0) {
        return { assignments: [], ignoredObservationIds: [] };
      }
      const serialized = JSON.stringify({
        mergerVersion: options.mergerVersion,
        currentModes: input.currentModes,
        newReviewObservations: input.observations,
      });
      const handle = await (options.execution ?? options.runtime).submit({
        taskKey: `semantic-profile-core:${sha256(serialized)}`,
        inputSnapshotHash: sha256(serialized),
        taskKind: 'semantic-profile-core',
        taskGroup: 'background',
        ownerRef: 'global-user-profile',
        providerId: options.providerId,
        priority: 30,
        prompt: `${MERGE_POLICY}\n\n${serialized}`,
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
                  throw new Error('semantic_profile_scheduler_stalled');
                }
              }
              return current;
            })()
          : await options.execution.awaitTerminal(handle.taskId);
      if (task.status !== 'completed') throw new Error('semantic_profile_generation_failed');
      return ResultSchema.parse(parseJson(task.draftMarkdown ?? ''));
    },
  };
}
