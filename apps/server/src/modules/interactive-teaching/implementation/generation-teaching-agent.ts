import { createHash } from 'node:crypto';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { TeachingAgent } from '../ports/teaching-agent.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { renderMathPlotCapability } from './math-plot-capability.js';
import { renderTeachingBoundaryPolicy } from './teaching-boundary-policy.js';
import { renderTeachingClosurePolicy } from './teaching-closure-policy.js';
import {
  parseInterruptedTeachingMarkdown,
  parseTeachingAgentResult,
  renderTeachingControlProtocol,
} from './teaching-control-protocol.js';
import { renderTeachingCorePolicy } from './teaching-core-policy.js';
import { renderTeachingDepthPolicy } from './teaching-depth-policy.js';
import { renderTeachingFactContext } from './teaching-fact-context.js';
import { renderTeachingFlowPolicy } from './teaching-flow-policy.js';

const STRUCTURED_TASK_PREFIX = 'interactive-teaching-control-v1:';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function renderTeachingConversationInput(context: TeachingContextPackage): string {
  const opening = context.turnKind === 'opening';
  return [
    renderTeachingCorePolicy(),
    renderTeachingBoundaryPolicy(),
    renderTeachingClosurePolicy(),
    renderMathPlotCapability(),
    renderTeachingFlowPolicy(context),
    renderTeachingDepthPolicy(context),
    renderTeachingFactContext(context),
    opening
      ? '这是学习者刚进入本课的课前热身。请由教学助手主动导入语境，连接学习目标与已有经验，并提出一个容易回应的热身问题。不要要求学习者先提问，不要开始连续讲解全部知识点。'
      : undefined,
    opening
      ? '直接面向学习者输出自然的开场教学，不复述栏目名或内部状态。'
      : '不要复述栏目名或内部状态，直接回应当前诉求。',
    renderTeachingControlProtocol(context),
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n\n');
}

export function createGenerationTeachingAgent(options: {
  runtime: GenerationRuntime;
  execution?: GenerationExecution;
  providerId: string;
}): TeachingAgent {
  async function awaitTerminal(
    taskId: string,
    recover: boolean,
  ): Promise<Awaited<ReturnType<GenerationRuntime['get']>>> {
    if (options.execution !== undefined) {
      return recover ? options.execution.recover(taskId) : options.execution.awaitTerminal(taskId);
    }
    if (recover) await options.runtime.recoverExpiredLeases();
    let task = await options.runtime.get(taskId);
    for (
      let index = 0;
      index < 1_000 && (task.status === 'queued' || task.status === 'running');
      index += 1
    ) {
      const ran = await options.runtime.runNext();
      task = await options.runtime.get(taskId);
      if (ran === undefined && (task.status === 'queued' || task.status === 'running')) {
        throw new Error('teaching_generation_scheduler_stalled');
      }
    }
    return task;
  }

  return {
    async submit(context) {
      const expressionContext = renderTeachingConversationInput(context);
      return (options.execution ?? options.runtime).submit({
        taskKey: `${STRUCTURED_TASK_PREFIX}${context.teachingState.sessionId}:${sha256(expressionContext)}`,
        inputSnapshotHash: sha256(expressionContext),
        taskKind: 'interactive-teaching',
        taskGroup: 'interactive',
        ownerRef: context.teachingState.sessionId,
        providerId: options.providerId,
        priority: 100,
        prompt: expressionContext,
      });
    },
    async complete(taskId) {
      const task = await awaitTerminal(taskId, false);
      if (task.status !== 'completed') throw new Error('teaching_generation_incomplete');
      return parseTeachingAgentResult(
        task.draftMarkdown ?? '',
        task.taskKey.startsWith(STRUCTURED_TASK_PREFIX),
      );
    },
    async read(taskId) {
      const task = await options.runtime.get(taskId);
      if (task.status !== 'completed') return undefined;
      return parseTeachingAgentResult(
        task.draftMarkdown ?? '',
        task.taskKey.startsWith(STRUCTURED_TASK_PREFIX),
      );
    },
    async recover(taskId) {
      const task = await awaitTerminal(taskId, true);
      if (task.status === 'completed') {
        return {
          ...parseTeachingAgentResult(
            task.draftMarkdown ?? '',
            task.taskKey.startsWith(STRUCTURED_TASK_PREFIX),
          ),
          completionStatus: 'complete',
        };
      }
      if (task.status === 'cancelled') {
        return {
          markdown: parseInterruptedTeachingMarkdown(task.draftMarkdown ?? ''),
          completionStatus: 'interrupted',
        };
      }
      return {
        completionStatus: 'failed',
        errorCode: task.errorCode ?? `teaching_generation_${task.status}`,
      };
    },
    async stop(taskId) {
      const task = await (options.execution ?? options.runtime).cancel(taskId);
      return {
        markdown: parseInterruptedTeachingMarkdown(task.draftMarkdown ?? ''),
        completionStatus: 'interrupted',
      };
    },
  };
}
