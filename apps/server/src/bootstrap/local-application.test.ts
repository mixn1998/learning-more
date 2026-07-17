import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HomeDashboardResponseSchema } from '@learning-more/contracts';

import { createMockProvider } from '../ai-providers/mock-provider.js';
import { reviewIdForLesson } from '../modules/review-closure/implementation/stage-review.js';
import { stagePortraitRefreshState } from '../persistence/course-archive-store.js';
import { DataRoot } from '../persistence/data-root.js';
import { createLocalFileCourseCreationRepositories } from '../persistence/course-creation-repositories.js';
import { createLocalFileLearningSessionRepositories } from '../persistence/learning-session-repositories.js';
import { createLocalFileScheduleRepository } from '../persistence/planning-repositories.js';
import { createLocalFileReviewClosureRepositories } from '../persistence/review-closure-repositories.js';
import { createUnitOfWork } from '../persistence/unit-of-work.js';
import { createMemoryProviderConfigRepository } from '../runtime/provider-config-service.js';
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
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  );
});

describe('local CourseAuthoring application', () => {
  it('removes obsolete outline lessons from live scheduling while preserving learning history', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'learning-more-outline-live-reconcile-'),
    );
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    const unitOfWork = createUnitOfWork({ dataRoot });
    const courses = createLocalFileCourseCreationRepositories(dataRoot);
    const schedules = createLocalFileScheduleRepository(dataRoot);
    const learning = createLocalFileLearningSessionRepositories(dataRoot);
    await unitOfWork.execute({ transactionId: 'tx_seed_outline_live_reconcile' }, async (tx) => {
      await courses.courses.save(
        tx,
        {
          id: 'course_revised',
          title: 'Revised course',
          courseMode: 'standard',
          outlineVersionId: 'outline_current',
          lessonIds: ['lesson_current'],
          recommendedLessonId: 'lesson_current',
          status: 'active',
          createdAt: '2026-07-16T00:00:00.000Z',
          resourceVersion: 0,
        },
        0,
      );
      for (const lesson of [
        { id: 'lesson_obsolete', outlineVersionId: 'outline_old' },
        { id: 'lesson_current', outlineVersionId: 'outline_current' },
      ]) {
        await courses.lessons.save(
          tx,
          {
            ...lesson,
            courseId: 'course_revised',
            semanticKey: lesson.id,
            title: lesson.id,
            objective: lesson.id,
            coreKnowledgePoints: [],
            prerequisiteLessonIds: [],
            estimatedMinutes: 30,
            sourceRefs: [],
            resourceVersion: 0,
          },
          0,
        );
      }
      await schedules.save(
        tx,
        {
          id: 'schedule_obsolete',
          courseId: 'course_revised',
          lessonId: 'lesson_obsolete',
          startAt: '2026-07-17T01:00:00.000Z',
          endAt: '2026-07-17T01:30:00.000Z',
          timezoneAtCreation: 'Asia/Shanghai',
          source: 'manual',
          status: 'scheduled',
          createdAt: '2026-07-16T00:00:00.000Z',
          updatedAt: '2026-07-16T00:00:00.000Z',
          processedCommandIds: [],
          resourceVersion: 0,
        },
        0,
      );
      await learning.save(
        tx,
        {
          lessonId: 'lesson_obsolete',
          learning: {
            lessonId: 'lesson_obsolete',
            progress: 'abandoned',
            session: {
              id: 'session_obsolete_history',
              state: 'frozen',
              messageIds: [],
              evidenceCheckpoint: true,
            },
            processedCommandIds: ['abandon_obsolete'],
          },
          intervals: [],
          resourceVersion: 0,
        },
        0,
      );
    });

    const local = await createLocalApplication({ dataRoot: directory, csrfToken: 'test-csrf' });
    const app = await buildApp(local.serverDependencies);

    await expect(schedules.get('schedule_obsolete')).resolves.toMatchObject({
      status: 'removed',
      cancelReason: 'outline_revised',
    });
    await expect(learning.get('lesson_obsolete')).resolves.toMatchObject({
      learning: { session: { id: 'session_obsolete_history' } },
    });
    const scheduleResponse = await app.inject({ method: 'GET', url: '/api/v1/schedule' });
    expect(scheduleResponse.statusCode, scheduleResponse.body).toBe(200);
    expect(scheduleResponse.json()).toMatchObject({ items: [] });
    const homeResponse = await app.inject({ method: 'GET', url: '/api/v1/home' });
    expect(homeResponse.statusCode, homeResponse.body).toBe(200);
    expect(homeResponse.json<{ schedule: Array<{ lessonId: string }> }>().schedule).toEqual([]);
    const obsoleteLivePreview = await app.inject({
      method: 'GET',
      url: '/api/v1/lessons/lesson_obsolete',
    });
    expect(obsoleteLivePreview.statusCode).toBe(404);

    await app.close();
    await local.close();
  });

  it('serves an abandoned lesson archive before its stage Review is ready', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-abandoned-record-'));
    roots.push(directory);
    const local = await createLocalApplication({ dataRoot: directory, csrfToken: 'test-csrf' });
    const dataRoot = DataRoot.create(directory);
    const unitOfWork = createUnitOfWork({ dataRoot });
    const learning = createLocalFileLearningSessionRepositories(dataRoot);
    const reviews = createLocalFileReviewClosureRepositories(dataRoot);
    const reviewId = reviewIdForLesson('lesson_abandoned_record');
    await unitOfWork.execute({ transactionId: 'tx_seed_abandoned_record' }, async (tx) => {
      await local.courseRepositories.courses.save(
        tx,
        {
          id: 'course_abandoned_record',
          title: 'Archive course',
          courseMode: 'standard',
          outlineVersionId: 'outline_abandoned_record',
          lessonIds: ['lesson_abandoned_record'],
          recommendedLessonId: 'lesson_abandoned_record',
          status: 'active',
          createdAt: '2026-07-16T00:00:00.000Z',
          resourceVersion: 0,
        },
        0,
      );
      await local.courseRepositories.lessons.save(
        tx,
        {
          id: 'lesson_abandoned_record',
          courseId: 'course_abandoned_record',
          outlineVersionId: 'outline_abandoned_record',
          semanticKey: 'abandoned-record',
          title: 'Abandoned lesson',
          objective: 'Keep the archive available while Review is generated.',
          coreKnowledgePoints: [],
          prerequisiteLessonIds: [],
          estimatedMinutes: 30,
          sourceRefs: [],
          resourceVersion: 0,
        },
        0,
      );
      await learning.save(
        tx,
        {
          lessonId: 'lesson_abandoned_record',
          learning: {
            lessonId: 'lesson_abandoned_record',
            progress: 'abandoned',
            session: {
              id: 'session_abandoned_record',
              state: 'frozen',
              messageIds: [],
              evidenceCheckpoint: true,
            },
            processedCommandIds: ['abandon_record'],
          },
          intervals: [
            {
              id: 'interval_abandoned_record',
              sessionId: 'session_abandoned_record',
              startedAt: '2026-07-16T00:00:00.000Z',
              endedAt: '2026-07-16T00:05:00.000Z',
              endReason: 'abandoned',
              recovered: false,
            },
          ],
          resourceVersion: 0,
        },
        0,
      );
      await reviews.stageReviews.save(
        tx,
        {
          reviewId,
          lessonId: 'lesson_abandoned_record',
          sourceSessionId: 'session_abandoned_record',
          sourceSnapshotHash: 'a'.repeat(64),
          status: 'generating',
          taskId: 'task_stage_record',
          requestReceipts: { abandon_record: 'task_stage_record' },
          replacementCount: 0,
          updatedAt: '2026-07-16T00:05:00.000Z',
          resourceVersion: 0,
        },
        0,
      );
    });
    const app = await buildApp(local.serverDependencies);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/lessons/lesson_abandoned_record/record',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      progress: 'abandoned',
      reviewStatus: 'generating',
      original: { sessionId: 'session_abandoned_record', messages: [] },
    });
    expect(response.json()).not.toHaveProperty('finalReviewMarkdown');
    await app.close();
    await local.close();
  });

  it('saves a schedule command without starting derived AI work', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-schedule-response-'));
    roots.push(directory);
    const provider = createMockProvider({
      id: 'slow-recommendation',
      scriptFactory: (attempt) =>
        attempt === 1
          ? [
              {
                type: 'text',
                text: '## This week\n\nInsufficient evidence to infer a stable change.',
              },
            ]
          : [
              {
                type: 'wait',
                wait: () => new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
              },
              {
                type: 'text',
                text: JSON.stringify({
                  semanticKey: 'slow-lesson',
                  rankedSemanticKeys: ['slow-lesson'],
                  rationale: 'Still the only eligible lesson.',
                  evidenceRefs: [],
                  confidence: 0.8,
                }),
              },
            ],
    });
    const local = await createLocalApplication({
      dataRoot: directory,
      csrfToken: 'test-csrf',
      providers: [provider],
    });
    const dataRoot = DataRoot.create(directory);
    const unitOfWork = createUnitOfWork({ dataRoot });
    await unitOfWork.execute({ transactionId: 'tx_seed_slow_schedule_course' }, async (tx) => {
      await local.courseRepositories.courses.save(
        tx,
        {
          id: 'slow-course',
          title: 'Slow recommendation course',
          courseMode: 'standard',
          outlineVersionId: 'slow-outline',
          lessonIds: ['slow-lesson'],
          recommendedLessonId: 'slow-lesson',
          status: 'active',
          createdAt: '2026-07-15T00:00:00.000Z',
          resourceVersion: 0,
        },
        0,
      );
      await local.courseRepositories.lessons.save(
        tx,
        {
          id: 'slow-lesson',
          courseId: 'slow-course',
          outlineVersionId: 'slow-outline',
          semanticKey: 'slow-lesson',
          title: 'Slow lesson',
          objective: 'Verify that derived AI work does not block scheduling.',
          coreKnowledgePoints: [],
          prerequisiteLessonIds: [],
          estimatedMinutes: 30,
          sourceRefs: [],
          resourceVersion: 0,
        },
        0,
      );
    });
    const app = await buildApp(local.serverDependencies);
    const before = await local.generationRuntime.getMetrics();
    const startedAt = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/schedule-assignments',
      headers: { ...baseHeaders, 'idempotency-key': 'schedule_slow_01' },
      payload: {
        courseId: 'slow-course',
        lessonId: 'slow-lesson',
        startAt: '2026-07-16T11:00:00.000Z',
        endAt: '2026-07-16T11:30:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
      },
    });
    const responseMs = Date.now() - startedAt;
    const previewStartedAt = Date.now();
    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/plan-flow-previews',
      headers: { ...baseHeaders, 'idempotency-key': 'preview_rules_01' },
      payload: {
        constraintsArtifactRef: 'constraints_manual',
        courseRefs: ['slow-course'],
        lessonRefs: ['slow-lesson'],
        timeWindowRefs: [
          'start:2026-07-16',
          'daily:30',
          'days:周四',
          'preserve:false',
          'overdue:false',
          'strategy:balanced',
        ],
        existingScheduleSnapshotRef: 'schedule_1',
      },
    });
    const previewMs = Date.now() - previewStartedAt;
    const after = await local.generationRuntime.getMetrics();
    await app.close();
    await local.close();

    expect(responseMs).toBeLessThan(500);
    expect(response.statusCode, response.body).toBe(201);
    expect(previewMs).toBeLessThan(500);
    expect(preview.statusCode, preview.body).toBe(202);
    expect(preview.json()).toMatchObject({
      state: 'preview-ready',
      generationTaskId: expect.stringMatching(/^rules_/),
      suggestions: [expect.objectContaining({ lessonId: 'slow-lesson' })],
    });
    expect(after.total).toBe(before.total);
  }, 15_000);

  it('does not expose a failed course-deletion refresh as the current learning portrait', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-portrait-state-'));
    roots.push(directory);
    const local = await createLocalApplication({ dataRoot: directory, csrfToken: 'test-csrf' });
    const app = await buildApp(local.serverDependencies);
    const unitOfWork = createUnitOfWork({ dataRoot: DataRoot.create(directory) });
    await unitOfWork.execute({ transactionId: 'tx_stale_portrait_refresh' }, (tx) =>
      stagePortraitRefreshState(tx, {
        schemaVersion: 1,
        state: 'failed',
        reason: 'course_deleted',
        courseId: 'course_deleted',
        updatedAt: '2026-07-17T00:00:00.000Z',
        errorCode: 'portrait_refresh_failed',
      }),
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/portrait' });

    expect(response.statusCode).toBe(404);
    await app.close();
    await local.close();
  });

  it('[EQ-COURSE-03..06] runs confirmation, revision, closure, review, and permanent deletion through HTTP → Module → LocalFile', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'learning-more-app-'));
    roots.push(dataRoot);
    const local = await createLocalApplication({ dataRoot, csrfToken: 'test-csrf' });
    const app = await buildApp(local.serverDependencies);
    const waitForCandidateReady = async (
      outlineSessionId: string,
      previousCandidateVersionId?: string,
    ) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/outline-sessions/${outlineSessionId}`,
          headers: { host: baseHeaders.host, origin: baseHeaders.origin },
        });
        const session = response.json<{
          state: string;
          candidateVersionId?: string;
          resourceVersion: number;
        }>();
        if (
          session.state === 'candidate-ready' &&
          session.candidateVersionId !== undefined &&
          session.candidateVersionId !== previousCandidateVersionId
        ) {
          return session;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('candidate_generation_did_not_settle');
    };
    const waitForCourseReview = async (courseId: string) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/courses/${courseId}/review`,
        });
        if (
          response.statusCode === 200 &&
          response.json<{ state: string }>().state === 'review-finalized'
        ) {
          return response;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('course_review_generation_did_not_settle');
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/outline-sessions',
      headers: { ...baseHeaders, 'idempotency-key': 'create_01' },
      payload: { topic: 'Probability', courseMode: 'standard' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const createdSession = created.json<{ outlineSessionId: string; resourceVersion: number }>();
    const sessionId = createdSession.outlineSessionId;

    const assessed = await app.inject({
      method: 'POST',
      url: `/api/v1/outline-sessions/${sessionId}/messages`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'assess_01',
        'if-match': `"${createdSession.resourceVersion}"`,
      },
      payload: { content: 'Include Bayes' },
    });
    expect(assessed.statusCode).toBe(200);
    const assessedVersion = assessed.json<{ resourceVersion: number }>().resourceVersion;
    const baselineCompleted = await app.inject({
      method: 'POST',
      url: `/api/v1/outline-sessions/${sessionId}/messages`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'assess_02',
        'if-match': `"${assessedVersion}"`,
      },
      payload: { content: 'I want to apply it to real decisions' },
    });
    expect(baselineCompleted.statusCode).toBe(200);
    const baselineVersion = baselineCompleted.json<{ resourceVersion: number }>().resourceVersion;

    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/outline-sessions/${sessionId}/candidate-generations`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'generate_01',
        'if-match': `"${baselineVersion}"`,
      },
      payload: {},
    });
    expect(generated.statusCode, generated.body).toBe(202);
    const generation = generated.json<{ taskId: string; resourceVersion: number }>();
    const session = await waitForCandidateReady(sessionId);
    expect(session.resourceVersion).toBeGreaterThan(generation.resourceVersion);

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
    let course = await local.courseRepositories.courses.get(confirmation.courseId);
    expect(course).toMatchObject({ outlineVersionId: confirmation.outlineVersionId });
    const lessons = await Promise.all(
      (course?.lessonIds ?? []).map((lessonId) => local.courseRepositories.lessons.get(lessonId)),
    );
    expect(lessons.map((lesson) => lesson?.semanticKey)).toEqual([
      'probability-space',
      'random-variable',
    ]);

    const revisionCreated = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${confirmation.courseId}/outline-adjustment-sessions`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'revision_create_01',
        'if-match': `"${course!.resourceVersion}"`,
      },
      payload: {},
    });
    expect(revisionCreated.statusCode).toBe(201);
    const createdRevisionSession = revisionCreated.json<{
      outlineSessionId: string;
      resourceVersion: number;
      candidateVersionId: string;
    }>();
    const revisionSessionId = createdRevisionSession.outlineSessionId;
    const revisionSessionAfterCreation = await app.inject({
      method: 'GET',
      url: `/api/v1/outline-sessions/${revisionSessionId}`,
      headers: { host: baseHeaders.host, origin: baseHeaders.origin },
    });
    expect(revisionSessionAfterCreation.statusCode, revisionSessionAfterCreation.body).toBe(200);
    expect(revisionSessionAfterCreation.json<{ resourceVersion: number }>().resourceVersion).toBe(
      createdRevisionSession.resourceVersion,
    );
    expect(revisionCreated.headers.etag).toBe(`"${createdRevisionSession.resourceVersion}"`);
    const revisionRequested = await app.inject({
      method: 'POST',
      url: `/api/v1/outline-sessions/${revisionSessionId}/messages`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'revision_request_01',
        'if-match': `"${createdRevisionSession.resourceVersion}"`,
      },
      payload: { content: 'Strengthen the observable evidence loop' },
    });
    expect(revisionRequested.statusCode, revisionRequested.body).toBe(200);
    const revisionCandidate = await waitForCandidateReady(
      revisionSessionId,
      createdRevisionSession.candidateVersionId,
    );
    const revised = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${confirmation.courseId}/outline-revisions`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'revision_publish_01',
        'if-match': `"${course!.resourceVersion}"`,
      },
      payload: { sourceCandidateVersionId: revisionCandidate.candidateVersionId },
    });
    expect(revised.statusCode, revised.body).toBe(201);
    const revision = revised.json<{ outlineVersionId: string; resourceVersion: number }>();
    course = await local.courseRepositories.courses.get(confirmation.courseId);
    expect(course).toMatchObject({
      outlineVersionId: revision.outlineVersionId,
      resourceVersion: revision.resourceVersion,
    });
    const confirmedOutline = await local.courseRepositories.outlineVersions.get(
      course!.outlineVersionId,
    );
    const homeView = HomeDashboardResponseSchema.parse(
      await local.serverDependencies.home!.getHome(),
    );
    expect(
      homeView.courses.find((item) => item.courseId === confirmation.courseId)?.topicTags,
    ).toEqual(confirmedOutline?.topicTags);
    expect(
      homeView.courses.find((item) => item.courseId === confirmation.courseId)?.disciplineTag,
    ).toBe(confirmedOutline?.disciplineTag);
    const home = await app.inject({ method: 'GET', url: '/api/v1/home' });
    expect(home.statusCode, home.body).toBe(200);
    expect(
      home
        .json<{
          courses: Array<{ courseId: string; disciplineTag: string; topicTags: string[] }>;
        }>()
        .courses.find((item) => item.courseId === confirmation.courseId),
    ).toMatchObject({
      disciplineTag: confirmedOutline?.disciplineTag,
      topicTags: confirmedOutline?.topicTags,
    });
    await expect(local.frameLog.readAfter(generation.taskId, 0)).resolves.toMatchObject({
      frames: expect.arrayContaining([expect.objectContaining({ type: 'artifact.ready' })]),
    });
    const scheduled = await app.inject({
      method: 'POST',
      url: '/api/v1/schedule-assignments',
      headers: { ...baseHeaders, 'idempotency-key': 'schedule_01' },
      payload: {
        courseId: confirmation.courseId,
        lessonId: course!.lessonIds[0],
        startAt: '2026-07-14T11:00:00.000Z',
        endAt: '2026-07-14T12:00:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
      },
    });
    expect(scheduled.statusCode).toBe(201);
    const [history, statistics, calendar] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/history' }),
      app.inject({ method: 'GET', url: '/api/v1/history/stats' }),
      app.inject({
        method: 'GET',
        url: '/api/v1/history/calendar?from=2026-01-01&to=2026-12-31',
      }),
    ]);
    expect([history.statusCode, statistics.statusCode, calendar.statusCode]).toEqual([
      200, 200, 200,
    ]);
    expect(
      history
        .json<{ entries: Array<{ factType: string }> }>()
        .entries.map((entry) => entry.factType),
    ).toEqual(expect.arrayContaining(['CourseCreatedFact', 'ScheduleConfirmedFact']));
    const profile = await app.inject({ method: 'GET', url: '/api/v1/profile-facts' });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      profileSchemaVersion: 1,
      sufficiency: { status: 'insufficient' },
    });
    const portrait = await app.inject({
      method: 'POST',
      url: '/api/v1/portrait-refreshes',
      headers: { ...baseHeaders, 'idempotency-key': 'portrait_01' },
      payload: { tokenBudget: 2_000 },
    });
    expect(portrait.statusCode).toBe(201);
    expect(portrait.json()).toMatchObject({
      state: 'completed',
      title: '学习画像：证据尚不足',
      claims: [],
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/portrait' })).statusCode).toBe(200);

    for (const [index, lessonId] of course!.lessonIds.entries()) {
      const started = await app.inject({
        method: 'POST',
        url: `/api/v1/lessons/${lessonId}/sessions`,
        headers: { ...baseHeaders, 'idempotency-key': `start_lesson_${index}` },
        payload: {},
      });
      expect(started.statusCode, started.body).toBe(201);
      const learning = started.json<{ resourceVersion: number }>();
      const abandoned = await app.inject({
        method: 'POST',
        url: `/api/v1/lessons/${lessonId}/abandonments`,
        headers: {
          ...baseHeaders,
          'idempotency-key': `abandon_lesson_${index}`,
          'if-match': `"${learning.resourceVersion}"`,
        },
        payload: { sourceSnapshotHash: (index % 2 === 0 ? 'a' : 'b').repeat(64) },
      });
      expect(abandoned.statusCode, abandoned.body).toBe(202);
      expect(abandoned.json()).toMatchObject({ progress: 'abandoned' });
    }

    course = await local.courseRepositories.courses.get(confirmation.courseId);
    expect(course).toBeDefined();
    const closed = await app.inject({
      method: 'POST',
      url: `/api/v1/courses/${confirmation.courseId}/closures`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'close_course_01',
        'if-match': `"${course!.resourceVersion}"`,
      },
      payload: { confirmAbandoned: true },
    });
    expect(closed.statusCode, closed.body).toBe(202);
    expect(closed.json()).toMatchObject({ state: 'generating-review' });
    expect(closed.json<{ markdown?: string }>().markdown).toBeUndefined();
    const courseReview = await waitForCourseReview(confirmation.courseId);
    expect(courseReview.statusCode, courseReview.body).toBe(200);
    expect(courseReview.json()).toMatchObject({ state: 'review-finalized' });
    course = await local.courseRepositories.courses.get(confirmation.courseId);
    expect(course).toMatchObject({ status: 'closed' });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/courses/${confirmation.courseId}`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'delete_course_01',
        'if-match': `"${course!.resourceVersion}"`,
      },
    });
    const replayedDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/courses/${confirmation.courseId}`,
      headers: {
        ...baseHeaders,
        'idempotency-key': 'delete_course_01',
        'if-match': `"${course!.resourceVersion}"`,
      },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(replayedDelete.json()).toEqual(deleted.json());
    await expect(
      local.courseRepositories.courses.get(confirmation.courseId),
    ).resolves.toBeUndefined();
    const afterDeleteHistory = await app.inject({ method: 'GET', url: '/api/v1/history' });
    expect(afterDeleteHistory.json<{ entries: unknown[] }>().entries).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/portrait' })).statusCode).toBe(200);
    await app.close();
    await local.close();
  }, 60_000);

  it('recovers a persisted committing lesson closure when the local service restarts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-app-recovery-'));
    roots.push(directory);
    const first = await createLocalApplication({ dataRoot: directory, csrfToken: 'test-csrf' });
    const dataRoot = DataRoot.create(directory);
    const unitOfWork = createUnitOfWork({ dataRoot });
    await unitOfWork.execute({ transactionId: 'tx_seed_recovery_course' }, async (tx) => {
      await first.courseRepositories.courses.save(
        tx,
        {
          id: 'course_recovery',
          title: 'Recovery course',
          courseMode: 'standard',
          outlineVersionId: 'outline_recovery',
          lessonIds: ['lesson_recovery'],
          recommendedLessonId: 'lesson_recovery',
          status: 'active',
          createdAt: '2026-07-13T00:00:00.000Z',
          resourceVersion: 0,
        },
        0,
      );
      await first.courseRepositories.lessons.save(
        tx,
        {
          id: 'lesson_recovery',
          courseId: 'course_recovery',
          outlineVersionId: 'outline_recovery',
          semanticKey: 'recovery',
          title: 'Recovery lesson',
          objective: 'Recover a committing closure',
          coreKnowledgePoints: [],
          prerequisiteLessonIds: [],
          estimatedMinutes: 30,
          sourceRefs: [],
          resourceVersion: 0,
        },
        0,
      );
    });
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
      },
      { ...context, commandId: 'message', expectedVersion: 1 },
    );
    await module.execute(
      { type: 'EstablishEvidenceCheckpoint', lessonId: 'lesson_recovery' },
      { ...context, commandId: 'observed', expectedVersion: 2 },
    );

    const learning = await module.query(
      { type: 'GetLessonLearning', lessonId: 'lesson_recovery' },
      {
        correlationId: 'query_before_recovery',
        actor: 'local-user',
        requestedAt: '2026-07-13T00:00:00.000Z',
        receivedAt: '2026-07-13T00:00:00.000Z',
      },
    );
    const sessionId = learning.learning.session?.id;
    if (sessionId === undefined) throw new Error('RECOVERY_SESSION_REQUIRED');

    const repositories = createLocalFileReviewClosureRepositories(dataRoot);
    await unitOfWork.execute({ transactionId: 'tx_pending_closure' }, (tx) =>
      repositories.lessonClosures.save(
        tx,
        {
          transactionId: 'closure_recovery',
          lessonId: 'lesson_recovery',
          sessionId,
          state: 'committing',
          sourceSessionIds: [sessionId],
          sourceMessageIds: ['message_01'],
          messageRangeChecksum: 'a'.repeat(64),
          endIntent: 'finish lesson',
          expectedSessionVersion: 2,
          generationTaskId: 'task_review_01',
          review: {
            artifactRef: 'final_review_artifact_01',
            markdown: '# Final Review',
            sourceSessionIds: [sessionId],
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

    await first.close();
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
    await restarted.close();
  }, 60_000);

  it('switches the active provider through HTTP and snapshots it on new generation tasks', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'learning-more-provider-switch-'));
    roots.push(dataRoot);
    const providerConfigRepository = createMemoryProviderConfigRepository();
    const providers = [
      createMockProvider({ id: 'old', script: [] }),
      createMockProvider({ id: 'new', script: [] }),
    ];
    const local = await createLocalApplication({
      dataRoot,
      csrfToken: 'test-csrf',
      providers,
      providerConfigRepository,
    });
    const app = await buildApp(local.serverDependencies);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai-runtime/provider-switches',
      headers: baseHeaders,
      payload: { providerId: 'new', publicConfig: {}, secretHandles: {} },
    });
    expect(response.statusCode).toBe(200);
    const task = await local.generationRuntime.submit({
      taskKey: 'provider-switch-integration',
      inputSnapshotHash: 'snapshot-new',
      taskKind: 'learning-chat',
      taskGroup: 'interactive',
      ownerRef: 'owner-new',
      providerId: 'current',
      priority: 100,
      prompt: 'hello',
    });
    await expect(local.generationRuntime.get(task.taskId)).resolves.toMatchObject({
      providerId: 'new',
    });
    await app.close();
    await local.close();
    const restarted = await createLocalApplication({
      dataRoot,
      csrfToken: 'test-csrf',
      providers,
      providerConfigRepository,
    });
    const afterRestart = await restarted.generationRuntime.submit({
      taskKey: 'provider-switch-after-restart',
      inputSnapshotHash: 'snapshot-restarted',
      taskKind: 'learning-chat',
      taskGroup: 'interactive',
      ownerRef: 'owner-restarted',
      providerId: 'current',
      priority: 100,
      prompt: 'hello again',
    });
    await expect(restarted.generationRuntime.get(afterRestart.taskId)).resolves.toMatchObject({
      providerId: 'new',
    });
    await restarted.close();
  });
});
