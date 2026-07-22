import type { GenerationRequest, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { describe, expect, it } from 'vitest';

import { createGenerationSemanticProfileCoreMerger } from '../implementation/generation-semantic-profile-core-merger.js';

describe('GenerationSemanticProfileCoreMerger', () => {
  it('sends only the bounded core and one new Review under the semantic merge contract', async () => {
    let request: GenerationRequest | undefined;
    let task: GenerationTask = {
      id: 'task_semantic_core',
      taskKey: 'semantic-core',
      status: 'queued',
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      resourceVersion: 0,
    };
    const runtime: GenerationRuntime = {
      async submit(input) {
        request = input;
        return { taskId: task.id };
      },
      async runNext() {
        task = {
          ...task,
          status: 'completed',
          draftMarkdown: JSON.stringify({
            assignments: [
              {
                sourceModeIds: [],
                observationIds: ['observation_1'],
                mode: {
                  origin: 'observed_behavior',
                  feature: '倾向核验条件边界',
                  teachingImpact: '使用反例和条件变化组织讲解',
                  applicabilityBoundary: '仅适用于已记录的学习情境',
                  priority: 5,
                },
              },
            ],
            ignoredObservationIds: [],
          }),
        };
        return task.id;
      },
      async get() {
        return task;
      },
      async cancel() {
        return task;
      },
      async listByOwner() {
        return [];
      },
      async recoverExpiredLeases() {
        return 0;
      },
      async getMetrics() {
        return { total: 1, byStatus: { completed: 1 }, byErrorCode: {} };
      },
    };
    const merger = createGenerationSemanticProfileCoreMerger({
      runtime,
      providerId: 'mock',
      mergerVersion: 'semantic-profile-core-merger@1',
    });

    await merger.merge({
      currentModes: [],
      observations: [
        {
          observationId: 'observation_1',
          origin: 'observed_behavior',
          summary: '用户检查了结论成立的条件',
          evidenceIds: ['evidence_1'],
          sourceRefs: ['review:1'],
        },
      ],
    });

    expect(request?.taskKind).toBe('semantic-profile-core');
    expect(request?.prompt).toContain('每条模式只能表达一个真正稳定');
    expect(request?.prompt).toContain('explicit_preference');
    expect(request?.prompt).toContain('没有明确教学影响');
    expect(request?.prompt).not.toContain('全部历史');
  });
});
