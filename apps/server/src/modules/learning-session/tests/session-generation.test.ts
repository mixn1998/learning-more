import { describe, expect, it, vi } from 'vitest';

import { createMockProvider } from '../../../ai-providers/mock-provider.js';
import { createInMemoryRepositories } from '../../../persistence/in-memory-repositories.js';
import { createInMemoryLearningSessionRepositories } from '../../../persistence/learning-session-repositories.js';
import { createInMemoryMessageLog } from '../implementation/message-log.js';
import { createSessionModule } from '../implementation/session-module.js';
import { createSessionGenerationCoordinator } from '../implementation/session-generation.js';
import { createGenerationRuntime } from '../../generation-runtime/implementation/generation-runtime.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};
const context = {
  commandId: 'command_start',
  correlationId: 'correlation_01',
  idempotencyKey: 'idem_01',
  actor: 'local-user' as const,
  requestedAt: '2026-07-13T00:00:00.000Z',
  receivedAt: '2026-07-13T00:00:00.000Z',
  pageInstanceId: 'page_01',
};

describe('SessionGenerationCoordinator', () => {
  it('submits one task per user message and preserves partial Markdown after stop', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generationTasks = createInMemoryRepositories().generationTasks;
    const runtime = createGenerationRuntime({
      repository: generationTasks,
      unitOfWork,
      providers: [
        createMockProvider({
          id: 'mock',
          script: [
            { type: 'text', text: 'partial markdown' },
            { type: 'wait', wait: () => wait },
            { type: 'text', text: ' should not arrive' },
          ],
        }),
      ],
      nextId: () => 'task_01',
    });
    const repositories = createInMemoryLearningSessionRepositories();
    const messageLog = createInMemoryMessageLog();
    const module = createSessionModule({
      repositories,
      messageLog,
      unitOfWork,
      instanceId: 'instance_01',
      nextSessionId: () => 'session_01',
      nextIntervalId: () => 'interval_01',
      nextLeaseToken: () => 'lease_01',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await module.execute({ type: 'StartLesson', lessonId: 'lesson_01' }, context);
    await module.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_01',
        messageId: 'message_01',
        contentArtifactRef: 'artifact:user:01',
        establishesEvidence: true,
      },
      { ...context, commandId: 'command_message' },
    );
    const appendFrame = vi.fn().mockResolvedValue(undefined);
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const saveManifest = vi.fn().mockResolvedValue('manifest:01');
    const coordinator = createSessionGenerationCoordinator({
      runtime,
      sessionModule: module,
      frameLog: { ensureTask: vi.fn(), append: appendFrame },
      artifactStore: { saveDraft, saveManifest },
      providerId: 'mock',
      nextMessageId: () => 'message_assistant',
    });
    const input = {
      lessonId: 'lesson_01',
      sessionId: 'session_01',
      userMessageId: 'message_01',
      courseId: 'course_01',
      lessonDefinitionId: 'definition_01',
      outlineVersionId: 'outline_01',
      completedReviewRefs: ['review:prior'],
      currentMessageRefs: ['artifact:user:01'],
    };

    const first = await coordinator.request(input, { ...context, commandId: 'generation_01' });
    const repeated = await coordinator.request(input, { ...context, commandId: 'generation_01' });
    expect(first).toEqual({ taskId: 'task_01', resourceVersion: 3 });
    expect(repeated).toEqual(first);
    await vi.waitFor(async () => {
      await expect(runtime.get('task_01')).resolves.toMatchObject({
        draftMarkdown: 'partial markdown',
      });
    });
    await coordinator.stop(
      { lessonId: 'lesson_01', sessionId: 'session_01', taskId: 'task_01' },
      { ...context, commandId: 'stop_01' },
    );
    release();

    await expect(runtime.get('task_01')).resolves.toMatchObject({
      status: 'cancelled',
      draftMarkdown: 'partial markdown',
    });
    expect(saveDraft).toHaveBeenCalledWith('draft_task_01', 'partial markdown');
    expect(appendFrame).toHaveBeenCalledWith('task_01', 'task.cancelled', {
      reason: 'user_requested',
    });
    expect(saveManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 'course_01',
        lessonId: 'lesson_01',
        sessionId: 'session_01',
        completedReviewRefs: ['review:prior'],
        currentMessageRefs: ['artifact:user:01'],
      }),
    );
    expect(JSON.stringify(saveManifest.mock.calls)).not.toContain('globalProfile');
    expect(JSON.stringify(saveManifest.mock.calls)).not.toContain('otherLessonMessages');
  });
});
