import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { ReasoningBehaviorAnalyzer } from '../ports/reasoning-behavior-analyzer.js';

const ANALYSIS_CAPABILITY = [
  '输入 Episode 是课时或阶段 Review 从原始回答中产出的会话级抽象维度。请对不同学习会话中名称或表述不同但本质一致的维度做第二次语义归并，形成全局用户档案维度。',
  '最终 dimensions 只返回跨会话可复用的全局抽象维度。label、description、纳入信号和排除信号不得包含课程专名、题目答案或其他单次会话例子。',
  '同一学习会话内出现多次只增强该会话内支持，不得被视为多个独立来源。证据不足时可以保留暂定维度，但不得推断人格、能力等级或永久学习风格。',
  '每个 Episode 可以归入零到多个全局维度；语义一致的 Episode 即使措辞不同，也必须归入同一全局维度。',
  'JSON 形状：dimensions 每项={label,description,inclusionSignals,exclusionSignals,derivedFromEpisodeIds}；classifications 每项={episodeId,labels:[{label,rationale,confidence}]}。标签 label 必须引用本次 dimensions 中的 label。',
  '只返回 dimensions 和 classifications 的 JSON。',
].join('\n');

const DIMENSION_CONTINUITY_POLICY =
  'priorDimensions 是全局用户档案此前形成的再抽象维度。当前会话维度与既有维度本质一致时，即使表述不同，也应沿用既有 label；只有出现无法被既有维度解释的新模式时才新增维度。priorDimensions 不是固定类型表，也不要求每个 Episode 都匹配。';

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
        sourceGroupId: `session:${episode.sessionId}`,
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
