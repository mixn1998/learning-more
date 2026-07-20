import { createHash } from 'node:crypto';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { TeachingAgent, TeachingAgentCompletionObserver } from '../ports/teaching-agent.js';
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
import {
  createTeachingResponseStream,
  type TeachingResponseStreamEvent,
} from './teaching-response-stream.js';

const STRUCTURED_TASK_PREFIX = 'interactive-teaching-control-v1:';
const STREAM_POLL_INTERVAL_MS = 20;
const TRANSIENT_TASK_READ_RETRIES = 10;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isTransientTaskRead(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === 'GENERATION_TASK_NOT_FOUND' ||
      (error as Error & { code?: string }).code === 'GENERATION_TASK_NOT_FOUND')
  );
}

async function waitForNextTaskProjection(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_INTERVAL_MS));
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
  async function readStreamingTask(taskId: string) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await options.runtime.get(taskId);
      } catch (error) {
        if (!isTransientTaskRead(error) || attempt >= TRANSIENT_TASK_READ_RETRIES) throw error;
        await waitForNextTaskProjection();
      }
    }
  }

  async function publish(
    events: readonly TeachingResponseStreamEvent[],
    observer: TeachingAgentCompletionObserver | undefined,
  ): Promise<void> {
    for (const event of events) {
      if (event.type === 'directive.ready') await observer?.onDirective?.(event.directive);
      else await observer?.onReplyDelta?.(event.markdown);
    }
  }

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
    async submit(context, requestRef) {
      const expressionContext = renderTeachingConversationInput(context);
      return (options.execution ?? options.runtime).submit({
        taskKey: `${STRUCTURED_TASK_PREFIX}${context.teachingState.sessionId}:${sha256(expressionContext)}`,
        inputSnapshotHash: sha256(expressionContext),
        taskKind: 'interactive-teaching',
        taskGroup: 'interactive',
        ownerRef: context.teachingState.sessionId,
        requestRef,
        providerId: options.providerId,
        priority: 100,
        prompt: expressionContext,
      });
    },
    listTasks(sessionId) {
      return options.runtime.listByOwner(sessionId, 'interactive-teaching');
    },
    async cancel(taskId) {
      await (options.execution ?? options.runtime).cancel(taskId);
    },
    async complete(taskId, observer, signal) {
      const response = createTeachingResponseStream();
      let observedLength = 0;
      let terminalSettled = false;
      const terminalPromise = awaitTerminal(taskId, false);
      void terminalPromise.then(
        () => {
          terminalSettled = true;
        },
        () => {
          terminalSettled = true;
        },
      );
      const consume = async (draftMarkdown: string | undefined) => {
        const current = draftMarkdown ?? '';
        if (current.length < observedLength) throw new Error('teaching_generation_draft_rewound');
        if (current.length === observedLength) return;
        const events = response.push(current.slice(observedLength));
        observedLength = current.length;
        await publish(events, observer);
      };
      while (!terminalSettled) {
        if (signal?.aborted === true) {
          await (options.execution ?? options.runtime).cancel(taskId);
          throw new Error('teaching_generation_cancelled');
        }
        await consume((await readStreamingTask(taskId)).draftMarkdown);
        if (terminalSettled) break;
        await Promise.race([
          waitForNextTaskProjection(),
          terminalPromise.then(
            () => undefined,
            () => undefined,
          ),
        ]);
      }
      const task = await terminalPromise;
      await consume(task.draftMarkdown);
      if (task.status !== 'completed') throw new Error('teaching_generation_incomplete');
      if (!task.taskKey.startsWith(STRUCTURED_TASK_PREFIX)) {
        return parseTeachingAgentResult(task.draftMarkdown ?? '', false);
      }
      const completed = response.finish();
      await publish(completed.events, observer);
      return completed.result;
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
