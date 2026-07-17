import type { GenerationRequest, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { describe, expect, it } from 'vitest';

import { createGenerationReasoningBehaviorAnalyzer } from '../implementation/generation-reasoning-behavior-analyzer.js';

describe('GenerationReasoningBehaviorAnalyzer', () => {
  it('asks for dynamic evidence-bound dimensions without embedding a fixed taxonomy', async () => {
    let request: GenerationRequest | undefined;
    let task: GenerationTask = {
      id: 'task_reasoning',
      taskKey: 'reasoning',
      status: 'queued',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
      resourceVersion: 0,
    };
    const output = {
      dimensions: [
        {
          label: '条件关系追踪',
          description: 'Tracks how a conclusion changes under different conditions.',
          inclusionSignals: ['Names the condition and resulting change.'],
          exclusionSignals: ['States two outcomes without relating them.'],
          derivedFromEpisodeIds: ['episode_1'],
        },
      ],
      classifications: [
        {
          episodeId: 'episode_1',
          labels: [
            {
              label: '条件关系追踪',
              rationale: 'The condition and consequence were both explicit.',
              confidence: 0.8,
            },
          ],
        },
      ],
    };
    const runtime: GenerationRuntime = {
      async submit(input) {
        request = input;
        return { taskId: task.id };
      },
      async runNext() {
        task = { ...task, status: 'completed', draftMarkdown: JSON.stringify(output) };
        return task.id;
      },
      async get() {
        return task;
      },
      async cancel() {
        return task;
      },
      async recoverExpiredLeases() {
        return 0;
      },
      async getMetrics() {
        return { total: 1, byStatus: { completed: 1 }, byErrorCode: {} };
      },
    };
    const analyzer = createGenerationReasoningBehaviorAnalyzer({
      runtime,
      providerId: 'mock',
      analyzerVersion: 'reasoning-analyzer@2',
    });
    const result = await analyzer.analyze({
      episodes: [
        {
          episodeId: 'episode_1',
          schemaVersion: 1,
          courseId: 'course_1',
          lessonId: 'lesson_1',
          sessionId: 'session_1',
          courseMode: 'standard',
          behaviorSummary: 'The learner changed the conclusion after naming a condition.',
          sourceObservationRef: 'observation:1',
          sourceRefs: ['message:1'],
          sourceGroupId: 'session:1:turn:1',
          elicitation: 'spontaneous',
          observedAt: '2026-07-14T00:00:00.000Z',
          sourceSnapshotHash: 'a'.repeat(64),
          extractorVersion: 'extractor@1',
          extractedAt: '2026-07-14T00:00:01.000Z',
          status: 'active',
          resourceVersion: 1,
        },
      ],
      priorDimensions: [],
    });

    expect(result.dimensions[0]?.label).toBe('条件关系追踪');
    expect(request?.taskKind).toBe('reasoning-behavior-analysis');
    expect(request?.prompt).not.toMatch(/逻辑型|关联型|发散型|结构型|隐喻型/u);
    expect(request?.prompt).not.toContain('radar');
    expect(request?.prompt).toContain('priorDimensions');
    expect(request?.prompt).toContain('第二次语义归并');
    expect(request?.prompt).toContain('全局用户档案此前形成的再抽象维度');
    expect(request?.prompt).toContain('"sourceGroupId":"session:session_1"');
  });
});
