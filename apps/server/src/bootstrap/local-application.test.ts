import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DataRoot } from '../persistence/data-root.js';
import { createLocalFileReviewClosureRepositories } from '../persistence/review-closure-repositories.js';
import { createUnitOfWork } from '../persistence/unit-of-work.js';
import { buildApp } from './app.js';
import { createLocalApplication } from './local-application.js';

const roots: string[] = [];
const baseHeaders = {
  host: '127.0.0.1:43120',
  origin: 'http://127.0.0.1:5173',
  'x-csrf-token': 'test-csrf',
  'x-page-instance-id': 'page_01',
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local CourseAuthoring application', () => {
  it('runs HTTP → Module → LocalFile → Mock Provider through course confirmation', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'learning-more-app-'));
    roots.push(dataRoot);
    const local = await createLocalApplication({ dataRoot, csrfToken: 'test-csrf' });
    const app = await buildApp(local.serverDependencies);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/outline-sessions',
      headers: { ...baseHeaders, 'idempotency-key': 'create_01' },
      payload: { topic: 'Probability', courseMode: 'standard' },
    });
    expect(created.statusCode).toBe(201);
    const sessionId = created.json<{ outlineSessionId: string }>().outlineSessionId;

    const assessed = await app.inject({
      method: 'POST',
      url: `/api/v1/outline-sessions/${sessionId}/messages`,
      headers: { ...baseHeaders, 'idempotency-key': 'assess_01', 'if-match': '"1"' },
      payload: { content: 'Include Bayes' },
    });
    expect(assessed.statusCode).toBe(200);

    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/outline-sessions/${sessionId}/candidate-generations`,
      headers: { ...baseHeaders, 'idempotency-key': 'generate_01', 'if-match': '"2"' },
      payload: {},
    });
    expect(generated.statusCode).toBe(202);
    const generation = generated.json<{ taskId: string; resourceVersion: number }>();
    const view = await app.inject({
      method: 'GET',
      url: `/api/v1/outline-sessions/${sessionId}`,
      headers: { host: baseHeaders.host, origin: baseHeaders.origin },
    });
    const session = view.json<{ candidateVersionId: string; resourceVersion: number }>();
    expect(session.resourceVersion).toBe(generation.resourceVersion);

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/outline-sessions/${sessionId}/confirmations`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'confirm_01',
        'if-match': `"${session.resourceVersion}"`,
      },
      payload: { candidateVersionId: session.candidateVersionId },
    });
    expect(confirmed.statusCode).toBe(201);
    const confirmation = confirmed.json<{ courseId: string; outlineVersionId: string }>();
    const course = await local.courseRepositories.courses.get(confirmation.courseId);
    expect(course).toMatchObject({ outlineVersionId: confirmation.outlineVersionId });
    const lessons = await Promise.all(
      (course?.lessonIds ?? []).map((lessonId) => local.courseRepositories.lessons.get(lessonId)),
    );
    expect(lessons.map((lesson) => lesson?.semanticKey)).toEqual([
      'probability-space',
      'random-variable',
    ]);
    await expect(local.frameLog.readAfter(generation.taskId, 0)).resolves.toMatchObject({
      frames: expect.arrayContaining([expect.objectContaining({ type: 'artifact.ready' })]),
    });
    await app.close();
  });

  it('recovers a persisted committing lesson closure when the local service restarts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-app-recovery-'));
    roots.push(directory);
    const first = await createLocalApplication({ dataRoot: directory, csrfToken: 'test-csrf' });
    const module = first.serverDependencies.learningSession!.module;
    const context = {
      correlationId: 'correlation_01',
      idempotencyKey: 'idem_01',
      actor: 'local-user' as const,
      requestedAt: '2026-07-13T00:00:00.000Z',
      receivedAt: '2026-07-13T00:00:00.000Z',
      pageInstanceId: 'page_01',
    };
    await module.execute(
      { type: 'StartLesson', lessonId: 'lesson_recovery' },
      { ...context, commandId: 'start' },
    );
    await module.execute(
      {
        type: 'AppendUserMessage',
        lessonId: 'lesson_recovery',
        messageId: 'message_01',
        contentArtifactRef: 'artifact_user_01',
        establishesEvidence: true,
      },
      { ...context, commandId: 'message', expectedVersion: 1 },
    );

    const dataRoot = DataRoot.create(directory);
    const repositories = createLocalFileReviewClosureRepositories(dataRoot);
    const unitOfWork = createUnitOfWork({ dataRoot });
    await unitOfWork.execute({ transactionId: 'tx_pending_closure' }, (tx) =>
      repositories.lessonClosures.save(
        tx,
        {
          transactionId: 'closure_recovery',
          lessonId: 'lesson_recovery',
          sessionId: 'lesson_session_recovery',
          state: 'committing',
          sourceSessionIds: ['lesson_session_recovery'],
          sourceMessageIds: ['message_01'],
          messageRangeChecksum: 'a'.repeat(64),
          endIntent: 'finish lesson',
          expectedSessionVersion: 2,
          generationTaskId: 'task_review_01',
          review: {
            artifactRef: 'final_review_artifact_01',
            markdown: '# Final Review',
            sourceSessionIds: ['lesson_session_recovery'],
            messageRangeChecksum: 'a'.repeat(64),
            contentSha256: 'b'.repeat(64),
          },
          finalReviewId: 'review_final_recovery',
          updatedAt: '2026-07-13T00:01:00.000Z',
          resourceVersion: 0,
        },
        0,
      ),
    );

    const restarted = await createLocalApplication({ dataRoot: directory, csrfToken: 'test-csrf' });
    await expect(
      restarted.serverDependencies.learningSession!.module.query(
        { type: 'GetLessonLearning', lessonId: 'lesson_recovery' },
        {
          correlationId: 'query_recovered',
          actor: 'local-user',
          requestedAt: '2026-07-13T00:02:00.000Z',
          receivedAt: '2026-07-13T00:02:00.000Z',
        },
      ),
    ).resolves.toMatchObject({
      learning: { progress: 'completed', session: { finalReviewId: 'review_final_recovery' } },
    });
    await expect(
      restarted.serverDependencies.reviewClosure!.services.getClosure('closure_recovery', {
        correlationId: 'query_closure',
        actor: 'local-user',
        requestedAt: '2026-07-13T00:02:00.000Z',
        receivedAt: '2026-07-13T00:02:00.000Z',
      }),
    ).resolves.toMatchObject({ state: 'completed', finalReviewId: 'review_final_recovery' });
  });
});
