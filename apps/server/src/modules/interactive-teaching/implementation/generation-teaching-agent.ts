import { createHash } from 'node:crypto';

import type { GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { TeachingAgent, TeachingAgentCompletionObserver } from '../ports/teaching-agent.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { renderMathPlotCapability } from './math-plot-capability.js';
import { capabilitiesForTeachingTurn } from './teaching-capability-router.js';
import { renderTeachingBoundaryPolicy } from './teaching-boundary-policy.js';
import { renderTeachingClosurePolicy } from './teaching-closure-policy.js';
import {
  parseInterruptedTeachingMarkdown,
  parseTeachingAgentResult,
  renderTeachingControlProtocol,
} from './teaching-control-protocol.js';
import { renderTeachingCorePolicy } from './teaching-core-policy.js';
import { renderTeachingFactContext } from './teaching-fact-context.js';
import { renderTeachingFlowPolicy } from './teaching-flow-policy.js';
import { renderTeachingGuidingPolicy } from './teaching-guiding-policy.js';
import { reasoningEffortForTeachingTurn } from './teaching-turn-policy.js';
import {
  createTeachingResponseStream,
  type TeachingResponseStreamEvent,
} from './teaching-response-stream.js';

const STRUCTURED_TASK_PREFIX = 'interactive-teaching-control-v1:';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function renderTeachingConversationInput(context: TeachingContextPackage): string {
  const opening = context.turnKind === 'opening';
  const discussionContinuation =
    context.turnKind === 'continuation' && context.teachingState.lessonPhase === 'discussion';
  const capabilities = capabilitiesForTeachingTurn(context);
  return [
    renderTeachingGuidingPolicy(),
    renderTeachingCorePolicy(),
    renderTeachingBoundaryPolicy(),
    renderTeachingClosurePolicy(),
    capabilities.has('math-plot') ? renderMathPlotCapability() : undefined,
    renderTeachingFlowPolicy(context),
    renderTeachingFactContext(context),
    opening
      ? '直接面向学习者输出自然的开场教学，不复述栏目名或内部状态。'
      : discussionContinuation
        ? '这是学习者在答疑阶段点击“继续讲解”作出的明确流程选择，等同于确认没有其他疑问；不要伪造学习者原话。'
      : context.turnKind === 'continuation'
        ? '这是系统续讲回合。不要伪造学习者输入或声称学习者已经回应；若上一回复邀请互动，视为学习者选择暂不回答，直接沿既有教学路径继续。'
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
  async function publish(
    events: readonly TeachingResponseStreamEvent[],
    observer: TeachingAgentCompletionObserver | undefined,
  ): Promise<void> {
    for (const event of events) {
      if (event.type === 'directive.ready') await observer?.onDirective?.(event.directive);
      else if (event.type === 'reply.completed') {
        await observer?.onReplyCompleted?.(event.markdown);
      } else await observer?.onReplyDelta?.(event.markdown);
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
        reasoningEffort: reasoningEffortForTeachingTurn(context),
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
    async invalidate(taskId, errorCode) {
      const invalidator = options.execution?.invalidate ?? options.runtime.invalidate;
      if (invalidator === undefined) throw new Error('generation_invalidation_unavailable');
      await invalidator(taskId, errorCode);
    },
    async complete(taskId, observer, signal) {
      const response = createTeachingResponseStream();
      let observedDraft = '';
      let terminalSettled = false;
      const pending: Awaited<ReturnType<GenerationRuntime['get']>>[] = [];
      let wake: (() => void) | undefined;
      const notify = (task: Awaited<ReturnType<GenerationRuntime['get']>>) => {
        pending.push(task);
        wake?.();
        wake = undefined;
      };
      const subscribe = options.execution?.subscribe ?? options.runtime.subscribe;
      const unsubscribe = subscribe?.(taskId, notify) ?? (() => {});
      let notifyAbort: (() => void) | undefined;
      const abortPromise =
        signal === undefined
          ? undefined
          : new Promise<void>((resolve) => {
              notifyAbort = () => resolve();
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', notifyAbort, { once: true });
            });
      const waitForUpdate = () =>
        pending.length > 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              wake = resolve;
            });
      const terminalPromise = awaitTerminal(taskId, false);
      const terminalSettledPromise = terminalPromise.then(
        () => {
          terminalSettled = true;
        },
        () => {
          terminalSettled = true;
        },
      );
      const consume = async (draftMarkdown: string | undefined) => {
        const current = draftMarkdown ?? '';
        if (current === observedDraft || observedDraft.startsWith(current)) return;
        if (!current.startsWith(observedDraft)) {
          throw new Error('teaching_generation_draft_rewritten');
        }
        const events = response.push(current.slice(observedDraft.length));
        observedDraft = current;
        await publish(events, observer);
      };
      try {
        await consume((await options.runtime.get(taskId)).draftMarkdown);
        while (!terminalSettled) {
          if (signal?.aborted === true) {
            await (options.execution ?? options.runtime).cancel(taskId);
            throw new Error('teaching_generation_cancelled');
          }
          while (pending.length > 0) await consume(pending.shift()?.draftMarkdown);
          if (terminalSettled) break;
          await Promise.race([
            waitForUpdate(),
            terminalSettledPromise,
            ...(abortPromise === undefined ? [] : [abortPromise]),
          ]);
        }
        while (pending.length > 0) await consume(pending.shift()?.draftMarkdown);
        const task = await terminalPromise;
        await consume(task.draftMarkdown);
        if (task.status !== 'completed') throw new Error('teaching_generation_incomplete');
        if (!task.taskKey.startsWith(STRUCTURED_TASK_PREFIX)) {
          return parseTeachingAgentResult(task.draftMarkdown ?? '', false);
        }
        const completed = response.finish();
        await publish(completed.events, observer);
        return completed.result;
      } finally {
        if (signal !== undefined && notifyAbort !== undefined) {
          signal.removeEventListener('abort', notifyAbort);
        }
        unsubscribe();
      }
    },
    async read(taskId) {
      const task = await options.runtime.get(taskId);
      if (
        task.status !== 'completed' &&
        !(task.status === 'failed' && task.errorCode === 'teaching_output_invalid')
      ) {
        return undefined;
      }
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
