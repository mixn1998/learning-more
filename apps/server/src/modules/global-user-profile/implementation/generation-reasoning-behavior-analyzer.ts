import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { ReasoningBehaviorAnalyzer } from '../ports/reasoning-behavior-analyzer.js';

const ANALYSIS_CAPABILITY = [
  '根据给定的局部思维行为证据，归纳当前证据窗口中有解释力的开放语义维度，并对 Episode 做多标签归类。',
  '维度由证据生成，不使用预设类型表；名称、定义、纳入与排除信号都要能回溯到 Episode。',
  '不要推断人格、能力等级或永久学习风格；证据不足时可以不创建维度，单个 Episode 也可以没有标签。',
  'JSON 形状：dimensions 每项={label,description,inclusionSignals,exclusionSignals,derivedFromEpisodeIds}；classifications 每项={episodeId,labels:[{label,rationale,confidence}]}。标签 label 必须引用本次 dimensions 中的 label。',
  '只返回 dimensions 与 classifications 的 JSON。',
].join('\n');

const DIMENSION_CONTINUITY_POLICY =
  'priorDimensions 是先前分析使用过的开放维度词汇：若当前证据支持同一语义，请沿用其 label；仅在确有新的可解释行为模式时新增维度。它们不是固定分类表，也不要求每个 Episode 都匹配。';

const ResultSchema = z.strictObject({
  dimensions: z.array(
    z.strictObject({
      label: z.string().trim().min(1).max(500),
      description: z.string().trim().min(1).max(5_000),
      inclusionSignals: z.array(z.string().trim().min(1).max(2_000)),
      exclusionSignals: z.array(z.string().trim().min(1).max(2_000)),
      derivedFromEpisodeIds: z.array(z.string().trim().min(1).max(500)).min(1),
    }),
  ),
  classifications: z.array(
    z.strictObject({
      episodeId: z.string().trim().min(1).max(500),
      labels: z.array(
        z.strictObject({
          label: z.string().trim().min(1).max(500),
          rationale: z.string().trim().min(1).max(5_000),
          confidence: z.number().min(0).max(1),
        }),
      ),
    }),
  ),
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

export function createGenerationReasoningBehaviorAnalyzer(options: {
  runtime: GenerationRuntime;
  execution?: GenerationExecution;
  providerId: string;
  analyzerVersion: string;
}): ReasoningBehaviorAnalyzer {
  return {
    version: options.analyzerVersion,
    async analyze(input) {
      if (input.episodes.length === 0) return { dimensions: [], classifications: [] };
      const evidenceWindow = input.episodes.map((episode) => ({
        episodeId: episode.episodeId,
        behaviorSummary: episode.behaviorSummary,
        courseId: episode.courseId,
        lessonId: episode.lessonId,
        courseMode: episode.courseMode,
        elicitation: episode.elicitation,
        observedAt: episode.observedAt,
        sourceGroupId: episode.sourceGroupId,
      }));
      const serialized = JSON.stringify({
        analyzerVersion: options.analyzerVersion,
        episodes: evidenceWindow,
        priorDimensions: input.priorDimensions.map((dimension) => ({
          label: dimension.label,
          description: dimension.description,
          inclusionSignals: dimension.inclusionSignals,
          exclusionSignals: dimension.exclusionSignals,
        })),
      });
      const handle = await (options.execution ?? options.runtime).submit({
        taskKey: `reasoning-behavior-analysis:${sha256(serialized)}`,
        inputSnapshotHash: sha256(serialized),
        taskKind: 'reasoning-behavior-analysis',
        taskGroup: 'background',
        ownerRef: 'global-user-profile',
        providerId: options.providerId,
        priority: 30,
        prompt: `${ANALYSIS_CAPABILITY}\n${DIMENSION_CONTINUITY_POLICY}\n\n${serialized}`,
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
                  throw new Error('reasoning_analysis_scheduler_stalled');
                }
              }
              return current;
            })()
          : await options.execution.awaitTerminal(handle.taskId);
      if (task.status !== 'completed') throw new Error('reasoning_analysis_generation_failed');
      return ResultSchema.parse(parseJson(task.draftMarkdown ?? ''));
    },
  };
}
