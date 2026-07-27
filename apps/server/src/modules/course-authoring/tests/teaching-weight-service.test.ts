import type { GenerationExecution, GenerationRequest } from '../../generation-runtime/interface.js';
import type { GenerationTask } from '../../generation-runtime/ports/generation-task-repository.js';
import { describe, expect, it } from 'vitest';

import { createInMemoryTeachingWeightRepository } from '../../../persistence/teaching-weight-repository.js';
import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import { createTeachingWeightService } from '../implementation/teaching-weight-service.js';
import { createInMemoryCourseCreationRepositories } from '../ports/course-repositories.js';

const tx: TransactionContext = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork: UnitOfWork = {
  execute: async (_request, work) => work(tx),
};
const timestamp = '2026-07-19T00:00:00.000Z';

async function seedCourse() {
  const courses = createInMemoryCourseCreationRepositories();
  await courses.outlineVersions.save(
    tx,
    {
      id: 'outline_1',
      courseId: 'course_1',
      sourceCandidateVersionId: 'candidate_1',
      outlineMarkdown: '# Course\n\n## Lesson',
      disciplineTag: 'Mathematics',
      topicTags: ['Calculus'],
      createdAt: timestamp,
      resourceVersion: 0,
    },
    0,
  );
  await courses.lessons.save(
    tx,
    {
      id: 'lesson_1',
      courseId: 'course_1',
      outlineVersionId: 'outline_1',
      semanticKey: 'lesson:one',
      title: 'Lesson',
      objective: 'Understand boundaries',
      coreKnowledgePoints: ['Definition', 'Boundary conditions', 'Counterexamples'],
      knowledgeStructure: {
        mainChain: [
          { id: 'node_1', content: 'Definition', relationToNext: 'then' },
          { id: 'node_2', content: 'Boundary conditions', relationToNext: 'then' },
          { id: 'node_3', content: 'Counterexamples' },
        ],
        branches: [],
      },
      prerequisiteLessonIds: [],
      estimatedMinutes: 30,
      sourceRefs: [],
      resourceVersion: 0,
    },
    0,
  );
  await courses.courses.save(
    tx,
    {
      id: 'course_1',
      title: 'Course',
      courseMode: 'standard',
      outlineVersionId: 'outline_1',
      lessonIds: ['lesson_1'],
      status: 'active',
      createdAt: timestamp,
      resourceVersion: 0,
    },
    0,
  );
  return courses;
}

function execution(
  results: readonly (GenerationTask['status'] | 'invalid')[],
  completedOutput: unknown = {
    lessons: [
      {
        lessonId: 'lesson_1',
        keyKnowledgePoints: [{ index: 1, rationale: 'Key boundary conditions' }],
      },
    ],
  },
) {
  const requests: GenerationRequest[] = [];
  const tasks = new Map<string, GenerationTask>();
  let cursor = 0;
  const value: GenerationExecution = {
    async submit(request) {
      requests.push(request);
      const id = `task_${requests.length}`;
      tasks.set(id, {
        id,
        taskKey: request.taskKey,
        status: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
        resourceVersion: 0,
      });
      return { taskId: id };
    },
    async awaitTerminal(taskId) {
      const task = tasks.get(taskId);
      if (task === undefined) throw new Error('missing task');
      const result = results[cursor++] ?? 'completed';
      if (result === 'invalid') {
        return { ...task, status: 'completed', draftMarkdown: '{"lessons":[]' };
      }
      if (result !== 'completed') return { ...task, status: result, errorCode: 'provider_failed' };
      return {
        ...task,
        status: 'completed',
        draftMarkdown: JSON.stringify(completedOutput),
      };
    },
    async stream() {
      throw new Error('not used');
    },
    async cancel(taskId) {
      const task = tasks.get(taskId);
      if (task === undefined) throw new Error('missing task');
      return { ...task, status: 'cancelled' };
    },
    async recover(taskId) {
      const task = tasks.get(taskId);
      if (task === undefined) throw new Error('missing task');
      return task;
    },
  };
  return { value, requests };
}

describe('teaching weight service', () => {
  it('generates version-bound metadata once and keeps completed metadata immutable', async () => {
    const courses = await seedCourse();
    const repository = createInMemoryTeachingWeightRepository();
    const fake = execution(['completed']);
    const service = createTeachingWeightService({
      courses,
      repository,
      unitOfWork,
      execution: fake.value,
      providerId: 'mock',
      now: () => new Date(timestamp),
    });

    const first = await service.ensureForCourse('course_1');
    const second = await service.ensureForCourse('course_1');

    expect(first).toMatchObject({
      outlineVersionId: 'outline_1',
      state: 'completed',
      attempt: 1,
      keyKnowledgePoints: [
        {
          lessonId: 'lesson_1',
          knowledgePointIndex: 1,
          rationale: 'Key boundary conditions',
        },
      ],
    });
    expect(second).toEqual(first);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      taskKind: 'teaching-weight-analysis',
      taskGroup: 'background',
      ownerRef: 'outline_1',
    });
  });

  it('retries a failed analysis but never overwrites the later completed result', async () => {
    const courses = await seedCourse();
    const repository = createInMemoryTeachingWeightRepository();
    const fake = execution(['failed', 'completed']);
    const service = createTeachingWeightService({
      courses,
      repository,
      unitOfWork,
      execution: fake.value,
      providerId: 'mock',
      now: () => new Date(timestamp),
    });

    await expect(service.ensureForCourse('course_1')).resolves.toMatchObject({
      state: 'failed',
      attempt: 1,
    });
    await expect(service.ensureForCourse('course_1')).resolves.toMatchObject({
      state: 'completed',
      attempt: 2,
    });
    await service.ensureForCourse('course_1');

    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]?.taskKey).toContain('attempt:2');
  });

  it('keeps fixed emphasis scarce by accepting at most two ordered points per lesson', async () => {
    const courses = await seedCourse();
    const repository = createInMemoryTeachingWeightRepository();
    const fake = execution(['completed'], {
      lessons: [
        {
          lessonId: 'lesson_1',
          keyKnowledgePoints: [
            { index: 2, rationale: 'Most important' },
            { index: 1, rationale: 'Second most important' },
            { index: 0, rationale: 'General foundation' },
          ],
        },
      ],
    });
    const service = createTeachingWeightService({
      courses,
      repository,
      unitOfWork,
      execution: fake.value,
      providerId: 'mock',
      now: () => new Date(timestamp),
    });

    const result = await service.ensureForCourse('course_1');

    expect(result?.keyKnowledgePoints.map((point) => point.knowledgePointIndex)).toEqual([2, 1]);
    expect(fake.requests[0]?.prompt).toContain('1 至 2 个固定重点');
  });
});
