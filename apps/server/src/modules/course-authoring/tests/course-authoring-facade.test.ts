import { describe, expect, it } from 'vitest';

import { createInMemoryCourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import { createInMemoryCourseCreationRepositories } from '../ports/course-repositories.js';
import { createCourseAuthoringFacade } from '../implementation/course-authoring-facade.js';

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
  commandId: 'command_01',
  correlationId: 'correlation_01',
  idempotencyKey: 'idem_01',
  actor: 'local-user' as const,
  requestedAt: '2026-07-13T00:00:00.000Z',
  receivedAt: '2026-07-13T00:00:00.000Z',
};

describe('CourseAuthoring public facade', () => {
  it('creates an assessing session and completes its assessment through the public interface', async () => {
    const authoring = createInMemoryCourseAuthoringRepositories();
    const facade = createCourseAuthoringFacade({
      authoring,
      courses: createInMemoryCourseCreationRepositories(),
      unitOfWork,
      candidateGeneration: {
        generate: async () => {
          throw new Error('unexpected');
        },
      },
      nextId: (kind) => `${kind}_01`,
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });

    const created = await facade.execute(
      { type: 'CreateOutlineSession', topic: ' probability ', courseMode: 'standard' },
      context,
    );
    expect(created).toMatchObject({
      outcome: 'completed',
      resourceVersion: 1,
      value: { kind: 'outline-session', outlineSessionId: 'session_01', state: 'assessing' },
    });

    const completed = await facade.execute(
      { type: 'AppendOutlineSessionMessage', outlineSessionId: 'session_01', content: 'Bayes' },
      { ...context, commandId: 'command_02', expectedVersion: 1 },
    );
    expect(completed).toMatchObject({
      resourceVersion: 2,
      value: { state: 'ready-for-candidates' },
    });
    await expect(
      facade.query(
        { type: 'GetOutlineSession', outlineSessionId: 'session_01' },
        {
          correlationId: 'c',
          actor: 'local-user',
          requestedAt: context.requestedAt,
          receivedAt: context.receivedAt,
        },
      ),
    ).resolves.toMatchObject({ topic: 'probability', state: 'ready-for-candidates' });
  });

  it('rejects stale expected versions before invoking generation', async () => {
    const authoring = createInMemoryCourseAuthoringRepositories();
    const facade = createCourseAuthoringFacade({
      authoring,
      courses: createInMemoryCourseCreationRepositories(),
      unitOfWork,
      candidateGeneration: {
        generate: async () => {
          throw new Error('unexpected');
        },
      },
      nextId: (kind) => `${kind}_01`,
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await facade.execute(
      { type: 'CreateOutlineSession', topic: 'probability', courseMode: 'standard' },
      context,
    );

    await expect(
      facade.execute(
        { type: 'RequestCandidateGeneration', outlineSessionId: 'session_01' },
        { ...context, commandId: 'command_02', expectedVersion: 0 },
      ),
    ).rejects.toBeInstanceOf(RepositoryVersionConflictError);
  });
});
