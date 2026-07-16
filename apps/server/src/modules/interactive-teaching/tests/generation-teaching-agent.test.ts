import type { GenerationRequest, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { describe, expect, it } from 'vitest';

import { createGenerationTeachingAgent } from '../implementation/generation-teaching-agent.js';
import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';

function context(): TeachingContextPackage {
  return {
    schemaVersion: 1,
    course: {
      courseId: 'course_1',
      outlineVersionId: 'outline_1',
      title: 'Probability',
      courseMode: 'case_study',
      playIntent: 'Prefer concrete situations when they create a useful learning opportunity.',
      goals: ['Understand probability.'],
      lessonMap: [
        {
          lessonId: 'lesson_1',
          title: 'Conditioning',
          objective: 'Explain conditioning.',
          relation: 'current',
        },
      ],
    },
    lesson: {
      lessonId: 'lesson_1',
      outlineVersionId: 'outline_1',
      title: 'Conditioning',
      objective: 'Explain conditioning.',
      coreKnowledgePoints: [{ ref: 'knowledge:kp_1', text: 'Sample-space change.' }],
    },
    relevantFinalReviews: [],
    readingMaterialExcerpts: [],
    personalization: {
      profileVersion: 0,
      purpose: 'interactive_teaching',
      courseId: 'course_1',
      lessonId: 'lesson_1',
      signals: [],
      completeness: 'insufficient',
      sourceSnapshotHash: '0'.repeat(64),
      createdAt: '2026-07-14T00:00:00.000Z',
    },
    teachingState: createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    }),
    recentMessages: [
      {
        messageId: 'message_current',
        role: 'user',
        completionStatus: 'complete',
        markdown: 'Explain this systematically.',
        sourceRef: 'message:message_current',
      },
    ],
    unobservedMessages: [],
  };
}

function runtime() {
  let request: GenerationRequest | undefined;
  let task: GenerationTask = {
    id: 'task_1',
    taskKey: 'pending',
    status: 'queued',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    resourceVersion: 0,
  };
  const value: GenerationRuntime = {
    async submit(input) {
      request = input;
      task = { ...task, taskKey: input.taskKey };
      return { taskId: task.id };
    },
    async runNext() {
      task = { ...task, status: 'completed', draftMarkdown: 'A free-form explanation.' };
      return task.id;
    },
    async cancel() {
      task = { ...task, status: 'cancelled', draftMarkdown: 'A partial explanation.' };
      return task;
    },
    async get() {
      return task;
    },
    async recoverExpiredLeases() {
      return 0;
    },
    async getMetrics() {
      return { total: 1, byStatus: { [task.status]: 1 }, byErrorCode: {} };
    },
  };
  return { value, request: () => request };
}

describe('GenerationTeachingAgent', () => {
  it('renders an active opening instruction without a fabricated learner request', async () => {
    const fake = runtime();
    const opening = { ...context(), turnKind: 'opening' as const, recentMessages: [] };
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });

    await agent.submit(opening);

    expect(fake.request()?.prompt).toContain('主动导入语境');
    expect(fake.request()?.prompt).toContain('当前阶段是课前热身');
    expect(fake.request()?.prompt).toContain('不要开始连续讲解全部知识点');
    expect(fake.request()?.prompt).toContain('【本课知识责任与现有证据】');
    expect(fake.request()?.prompt).not.toContain('【当前诉求｜用户原话】');
  });

  it('submits materialized context with one stable capability contract and no scene template', async () => {
    const fake = runtime();
    const agent = createGenerationTeachingAgent({
      runtime: fake.value,
      providerId: 'mock',
    });

    const accepted = await agent.submit(context());

    expect(accepted.taskId).toBe('task_1');
    expect(fake.request()?.taskKind).toBe('interactive-teaching');
    expect(fake.request()?.prompt).toContain('Explain this systematically.');
    expect(fake.request()?.prompt).not.toContain('lesson-response@v1');
    expect(fake.request()?.prompt).not.toContain('templateRef');
    expect(fake.request()?.prompt).not.toContain('modeWeight');
    expect(fake.request()?.prompt).toContain('【已知学习背景】');
    expect(fake.request()?.prompt).toContain('【当前诉求｜用户原话】');
    expect(fake.request()?.prompt).toContain('学习者正在回答课前热身');
    expect(fake.request()?.prompt).toContain('本回合最多完成“Sample-space change.”');
    expect(fake.request()?.prompt).toContain(
      'Prefer concrete situations when they create a useful learning opportunity.',
    );
    expect(fake.request()?.prompt).toContain('课程邻接探索');
    expect(fake.request()?.prompt).toContain('把选择权交给学习者');
    expect(fake.request()?.prompt).toContain('不要向学习者播报正在检测或已经通过检测');
    expect(fake.request()?.prompt).toContain('用一至两句小结当前知识点');
    expect(fake.request()?.prompt).toContain('综合检测通过后也不播报通过状态');
    expect(fake.request()?.prompt).not.toContain('TeachingScopeEnvelope');
    expect(fake.request()?.prompt).not.toContain('off_scope');
    expect(fake.request()?.prompt?.match(/Explain this systematically\./gu)).toHaveLength(1);
    for (const internalValue of [
      'schemaVersion',
      'courseId',
      'lessonId',
      'outlineVersionId',
      'courseMode',
      'playIntent',
      'teachingState',
      'sourceSnapshotHash',
      'session_1',
      'message_current',
      'knowledge:kp_1',
    ]) {
      expect(fake.request()?.prompt).not.toContain(internalValue);
    }
    await expect(agent.complete('task_1')).resolves.toEqual({
      markdown: 'A free-form explanation.',
    });
  });

  it('preserves interrupted Markdown without treating it as a complete reply', async () => {
    const fake = runtime();
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context());

    await expect(agent.stop('task_1')).resolves.toEqual({
      markdown: 'A partial explanation.',
      completionStatus: 'interrupted',
    });
  });

  it('recovers persisted completed, interrupted, and failed generation outcomes', async () => {
    const fake = runtime();
    const agent = createGenerationTeachingAgent({ runtime: fake.value, providerId: 'mock' });
    await agent.submit(context());
    await fake.value.runNext();

    await expect(agent.recover('task_1')).resolves.toEqual({
      markdown: 'A free-form explanation.',
      completionStatus: 'complete',
    });

    await fake.value.cancel('task_1');
    await expect(agent.recover('task_1')).resolves.toEqual({
      markdown: 'A partial explanation.',
      completionStatus: 'interrupted',
    });
  });
});
