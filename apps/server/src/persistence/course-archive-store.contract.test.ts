import { createHash } from 'node:crypto';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLocalFileMessageLog } from '../modules/learning-session/implementation/message-log.js';
import { createFactProjector } from '../modules/learning-facts/implementation/fact-projector.js';
import { DataRoot } from './data-root.js';
import { checksumJson } from './json-codec.js';
import { createLocalFileCourseCreationRepositories } from './course-creation-repositories.js';
import {
  courseDeletionBarrierExists,
  createLocalFileCourseArchiveStore,
  createLocalFileOutlineSessionDraftStore,
} from './course-archive-store.js';
import { createLocalFileFactRepository } from './learning-facts-repositories.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import {
  createLocalFilePlanFlowRepository,
  createLocalFileScheduleRepository,
} from './planning-repositories.js';
import { createLocalFileEvidenceRepositories } from './profile-evidence-repositories.js';
import { recoverTransactions } from './recover-transactions.js';
import { createUnitOfWork } from './unit-of-work.js';

const timestamp = '2026-07-13T08:00:00.000Z';

describe('LocalFile OutlineSessionDraftStore adapter', () => {
  it('deletes one unconfirmed session and its owned drafts while preserving unrelated data', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'learning-more-outline-draft-delete-'));
    const dataRoot = DataRoot.create(root);
    const paths = createStorePaths(dataRoot);
    await initializeStoreLayout(paths);
    const unitOfWork = createUnitOfWork({ dataRoot });
    const relative = (absolute: string) =>
      path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/');
    const document = (entityType: string, entityId: string, data: Record<string, unknown>) => ({
      schema: `learning-more/${entityType}`,
      schemaVersion: 1,
      entityType,
      entityId,
      resourceVersion: Number(data.resourceVersion ?? 1),
      createdAt: timestamp,
      updatedAt: timestamp,
      contentSha256: checksumJson(data),
      data,
    });
    const draftRef = 'draft_session_delete';
    const draftPath = `work/artifacts/${createHash('sha256').update(draftRef).digest('hex')}/draft.md`;

    await unitOfWork.execute({ transactionId: 'tx_seed_outline_draft' }, async (tx) => {
      const session = {
        session: {
          outlineSessionId: 'session_delete',
          state: 'candidate-ready',
          candidateVersionIds: ['candidate_delete'],
        },
        resourceVersion: 3,
      };
      const candidate = {
        id: 'candidate_delete',
        outlineSessionId: 'session_delete',
        generationTaskId: 'task_delete',
        draftArtifactRef: draftRef,
        resourceVersion: 1,
      };
      const material = {
        artifactRef: 'material_delete',
        outlineSessionId: 'session_delete',
        resourceVersion: 1,
      };
      const task = {
        id: 'task_delete',
        ownerRef: 'session_delete',
        resultRef: draftRef,
        resourceVersion: 1,
      };
      const keepTask = {
        id: 'task_keep',
        ownerRef: 'session_keep',
        resourceVersion: 1,
      };
      for (const [entityType, entityId, data] of [
        ['outline-sessions', 'session_delete', session],
        ['outline-candidates', 'candidate_delete', candidate],
        ['materials', 'material_delete', material],
        ['tasks', 'task_delete', task],
        ['tasks', 'task_keep', keepTask],
      ] as const) {
        await tx.stageJson(
          relative(paths.aggregate(entityType, entityId)),
          document(entityType, entityId, data),
        );
      }
      await tx.stageText(draftPath, '# incomplete candidate');
    });

    const store = createLocalFileOutlineSessionDraftStore(dataRoot);
    const manifest = await unitOfWork.execute({ transactionId: 'tx_delete_outline_draft' }, (tx) =>
      store.stageDelete(tx, 'session_delete'),
    );

    expect(manifest).toMatchObject({
      outlineSessionId: 'session_delete',
      deletedCounts: {
        outlineSessions: 1,
        candidateVersions: 1,
        materials: 1,
        generationTasks: 1,
        artifacts: 2,
      },
    });
    for (const [entityType, entityId] of [
      ['outline-sessions', 'session_delete'],
      ['outline-candidates', 'candidate_delete'],
      ['materials', 'material_delete'],
      ['tasks', 'task_delete'],
    ] as const) {
      await expect(access(paths.aggregate(entityType, entityId))).rejects.toThrow();
    }
    await expect(
      access(path.join(dataRoot.absolutePath, ...draftPath.split('/'))),
    ).rejects.toThrow();
    await expect(access(paths.aggregate('tasks', 'task_keep'))).resolves.toBeUndefined();
  });
});

describe('LocalFile CourseArchiveStore adapter', () => {
  it('completes an interrupted cascade on restart without exposing a stable partial deletion', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'learning-more-course-delete-recovery-'));
    const dataRoot = DataRoot.create(root);
    const paths = createStorePaths(dataRoot);
    await initializeStoreLayout(paths);
    const normal = createUnitOfWork({ dataRoot });
    const relative = (absolute: string) =>
      path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/');
    const document = (entityType: string, entityId: string, data: Record<string, unknown>) => ({
      schema: `learning-more/${entityType}`,
      schemaVersion: 1,
      entityType,
      entityId,
      resourceVersion: Number(data.resourceVersion ?? 1),
      createdAt: timestamp,
      updatedAt: timestamp,
      contentSha256: checksumJson(data),
      data,
    });
    const factRepository = createLocalFileFactRepository(dataRoot);
    await normal.execute({ transactionId: 'tx_seed_recovery' }, async (tx) => {
      const course = {
        id: 'course_recovery',
        title: 'Recovery',
        courseMode: 'standard',
        outlineVersionId: 'outline_recovery',
        lessonIds: ['lesson_recovery'],
        recommendedLessonId: 'lesson_recovery',
        status: 'active',
        createdAt: timestamp,
        resourceVersion: 1,
      };
      const lesson = {
        id: 'lesson_recovery',
        courseId: 'course_recovery',
        outlineVersionId: 'outline_recovery',
        semanticKey: 'recovery',
        title: 'Recovery',
        objective: 'Recover deletion',
        coreKnowledgePoints: ['atomicity'],
        prerequisiteLessonIds: [],
        estimatedMinutes: 30,
        sourceRefs: [],
        resourceVersion: 1,
      };
      await tx.stageJson(
        relative(paths.aggregate('courses', 'course_recovery')),
        document('courses', 'course_recovery', course),
      );
      await tx.stageJson(
        relative(paths.aggregate('lesson-definitions', 'lesson_recovery')),
        document('lesson-definitions', 'lesson_recovery', lesson),
      );
      await factRepository.append(tx, {
        factId: 'fact_recovery',
        factType: 'LessonCompletedFact',
        subjectRefs: { courseId: 'course_recovery', lessonId: 'lesson_recovery' },
        occurredAt: timestamp,
        recordedAt: timestamp,
        sourceEventId: 'event_recovery',
        dataKeys: ['completion.lesson_id'],
        payload: {},
        schemaVersion: 1,
      });
    });

    let crashed = false;
    const interrupted = createUnitOfWork({
      dataRoot,
      faultInjector(point) {
        if (!crashed && point === 'after-apply:0') {
          crashed = true;
          throw new Error('simulated_delete_crash');
        }
      },
    });
    const store = createLocalFileCourseArchiveStore(dataRoot);
    await expect(
      interrupted.execute({ transactionId: 'tx_delete_interrupted' }, (tx) =>
        store.stageDelete(tx, 'course_recovery'),
      ),
    ).rejects.toThrow('simulated_delete_crash');

    await expect(recoverTransactions(dataRoot)).resolves.toBe(1);
    await expect(store.getCourse('course_recovery')).resolves.toBeUndefined();
    await expect(courseDeletionBarrierExists(dataRoot, 'course_recovery')).resolves.toBe(true);
    const remainingFacts = [];
    for await (const fact of factRepository.list()) remainingFacts.push(fact.factId);
    expect(remainingFacts).toEqual([]);
  }, 15_000);

  it('[EQ-COURSE-06] physically cascades one course while preserving unrelated and shared-plan data', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'learning-more-course-delete-'));
    const dataRoot = DataRoot.create(root);
    const paths = createStorePaths(dataRoot);
    await initializeStoreLayout(paths);
    const unitOfWork = createUnitOfWork({ dataRoot });
    const courses = createLocalFileCourseCreationRepositories(dataRoot);
    const schedules = createLocalFileScheduleRepository(dataRoot);
    const planFlows = createLocalFilePlanFlowRepository(dataRoot);
    const facts = createLocalFileFactRepository(dataRoot);
    const evidence = createLocalFileEvidenceRepositories(dataRoot);
    const messages = createLocalFileMessageLog(dataRoot);

    const relative = (absolute: string) =>
      path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/');
    const stageEntity = async (
      tx: Parameters<typeof unitOfWork.execute>[1] extends (tx: infer T) => unknown ? T : never,
      entityType: string,
      entityId: string,
      data: Readonly<Record<string, unknown>>,
    ) => {
      await tx.stageJson(relative(paths.aggregate(entityType, entityId)), {
        schema: `learning-more/${entityType}`,
        schemaVersion: 1,
        entityType,
        entityId,
        resourceVersion: Number(data.resourceVersion ?? 1),
        createdAt: timestamp,
        updatedAt: timestamp,
        contentSha256: checksumJson(data),
        data,
      });
    };

    await unitOfWork.execute({ transactionId: 'tx_seed_course_archive' }, async (tx) => {
      await stageEntity(tx, 'courses', 'course_delete', {
        id: 'course_delete',
        title: 'Delete me',
        courseMode: 'standard',
        outlineVersionId: 'outline_delete',
        lessonIds: ['lesson_delete'],
        recommendedLessonId: 'lesson_delete',
        status: 'active',
        createdAt: timestamp,
        resourceVersion: 4,
      });
      await stageEntity(tx, 'courses', 'course_keep', {
        id: 'course_keep',
        title: 'Keep me',
        courseMode: 'standard',
        outlineVersionId: 'outline_keep',
        lessonIds: ['lesson_keep'],
        recommendedLessonId: 'lesson_keep',
        status: 'active',
        createdAt: timestamp,
        resourceVersion: 1,
      });
      for (const [lessonId, courseId, outlineVersionId] of [
        ['lesson_delete', 'course_delete', 'outline_delete'],
        ['lesson_keep', 'course_keep', 'outline_keep'],
      ] as const) {
        await stageEntity(tx, 'lesson-definitions', lessonId, {
          id: lessonId,
          courseId,
          outlineVersionId,
          semanticKey: lessonId,
          title: lessonId,
          objective: 'objective',
          coreKnowledgePoints: ['point'],
          prerequisiteLessonIds: [],
          estimatedMinutes: 30,
          sourceRefs: [],
          resourceVersion: 1,
        });
      }
      await stageEntity(tx, 'outline-versions', 'outline_delete', {
        id: 'outline_delete',
        courseId: 'course_delete',
        sourceCandidateVersionId: 'candidate_delete',
        outlineMarkdown: '# Delete',
        disciplineTag: 'test',
        topicTags: ['delete'],
        createdAt: timestamp,
        resourceVersion: 1,
      });
      await stageEntity(tx, 'lesson-progress', 'lesson_delete', {
        lessonId: 'lesson_delete',
        learning: {
          lessonId: 'lesson_delete',
          progress: 'in_progress',
          session: {
            id: 'session_delete',
            state: 'active',
            messageIds: ['message_delete'],
            evidenceCheckpoint: true,
          },
          processedCommandIds: [],
        },
        intervals: [
          {
            id: 'interval_delete',
            sessionId: 'session_delete',
            startedAt: timestamp,
            recovered: false,
          },
        ],
        writeLease: {
          token: 'lease_delete',
          pageInstanceId: 'page_delete',
          instanceId: 'instance_delete',
          generation: 1,
          heartbeatAt: timestamp,
          visibilityState: 'visible',
        },
        resourceVersion: 1,
      });
      await stageEntity(tx, 'teaching-ledgers', 'session_delete', {
        courseId: 'course_delete',
        lessonId: 'lesson_delete',
        sessionId: 'session_delete',
        resourceVersion: 1,
      });
      await stageEntity(tx, 'reasoning-behavior-episodes', 'reasoning_delete', {
        episodeId: 'reasoning_delete',
        courseId: 'course_delete',
        lessonId: 'lesson_delete',
        sessionId: 'session_delete',
        resourceVersion: 1,
      });
      await stageEntity(tx, 'reasoning-behavior-episodes', 'reasoning_keep', {
        episodeId: 'reasoning_keep',
        courseId: 'course_keep',
        lessonId: 'lesson_keep',
        sessionId: 'session_keep',
        resourceVersion: 1,
      });
      await stageEntity(tx, 'reasoning-behavior-analyses', 'reasoning_analysis_global', {
        snapshot: { snapshotId: 'reasoning_analysis_global' },
        resourceVersion: 1,
      });
      await stageEntity(tx, 'schedules', 'schedule_delete', {
        id: 'schedule_delete',
        courseId: 'course_delete',
        lessonId: 'lesson_delete',
        startAt: '2026-07-20T08:00:00.000Z',
        endAt: '2026-07-20T09:00:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
        source: 'plan-flow',
        status: 'scheduled',
        createdAt: timestamp,
        updatedAt: timestamp,
        processedCommandIds: [],
        resourceVersion: 1,
      });
      await stageEntity(tx, 'schedules', 'schedule_keep', {
        id: 'schedule_keep',
        courseId: 'course_keep',
        lessonId: 'lesson_keep',
        startAt: '2026-07-21T08:00:00.000Z',
        endAt: '2026-07-21T09:00:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
        source: 'plan-flow',
        status: 'scheduled',
        createdAt: timestamp,
        updatedAt: timestamp,
        processedCommandIds: [],
        resourceVersion: 1,
      });
      await stageEntity(tx, 'plan-flows', 'flow_shared', {
        id: 'flow_shared',
        state: 'confirmed',
        constraintsArtifactRef: 'constraints_shared',
        courseRefs: ['course_delete', 'course_keep'],
        lessonRefs: ['lesson_delete', 'lesson_keep'],
        timeWindowRefs: [],
        existingScheduleSnapshotRef: 'snapshot_shared',
        baseScheduleVersion: 0,
        generationTaskId: 'task_flow_shared',
        suggestions: [
          {
            courseId: 'course_delete',
            lessonId: 'lesson_delete',
            startAt: '2026-07-20T08:00:00.000Z',
            endAt: '2026-07-20T09:00:00.000Z',
            timezoneAtCreation: 'Asia/Shanghai',
            explanation: 'delete',
          },
          {
            courseId: 'course_keep',
            lessonId: 'lesson_keep',
            startAt: '2026-07-21T08:00:00.000Z',
            endAt: '2026-07-21T09:00:00.000Z',
            timezoneAtCreation: 'Asia/Shanghai',
            explanation: 'keep',
          },
        ],
        conflicts: [],
        confirmationReceipts: { confirmed: ['schedule_delete', 'schedule_keep'] },
        confirmedScheduleItemIds: ['schedule_delete', 'schedule_keep'],
        source: 'plan-flow',
        createdAt: timestamp,
        updatedAt: timestamp,
        resourceVersion: 1,
      });
      await facts.append(tx, {
        factId: 'fact_delete',
        factType: 'LessonCompletedFact',
        subjectRefs: { courseId: 'course_delete', lessonId: 'lesson_delete' },
        occurredAt: timestamp,
        recordedAt: timestamp,
        sourceEventId: 'event_delete_source',
        dataKeys: ['completion.lesson_id'],
        payload: {},
        schemaVersion: 1,
      });
      await facts.append(tx, {
        factId: 'fact_keep',
        factType: 'LessonCompletedFact',
        subjectRefs: { courseId: 'course_keep', lessonId: 'lesson_keep' },
        occurredAt: timestamp,
        recordedAt: timestamp,
        sourceEventId: 'event_keep_source',
        dataKeys: ['completion.lesson_id'],
        payload: {},
        schemaVersion: 1,
      });
      for (const [evidenceId, sourceRef] of [
        ['evidence_delete', 'fact_delete'],
        ['evidence_keep', 'fact_keep'],
      ] as const) {
        await evidence.evidence.save(
          tx,
          {
            evidenceId,
            claimDimension: 'learning.pattern',
            summary: evidenceId,
            sourceGroup: 'outcome',
            sourceGroupId: `fact:${sourceRef}`,
            dependentSourceGroupIds: [],
            sourceFactType: 'LessonCompletedFact',
            sourceRefs: [`fact:${sourceRef}`],
            dataKeys: ['completion.lesson_id'],
            observedAt: timestamp,
            strength: { score: 2, rationale: 'fixture evidence' },
            polarity: 'supporting',
            extractorVersion: 'fixture-v1',
            dedupKey: createHash('sha256').update(evidenceId).digest('hex'),
            status: 'active',
            resourceVersion: 0,
          },
          0,
        );
      }
      await messages.stageAppend(tx, 'session_delete', {
        id: 'message_delete',
        role: 'user',
        createdAt: timestamp,
        contentArtifactRef: 'artifact_message_delete',
        completionStatus: 'complete',
      });
      await tx.stageJson('outbox/pending/old-course-event.json', {
        schemaVersion: 1,
        event: {
          id: 'event_pending_delete',
          schema_version: 1,
          type: 'LessonSessionPaused',
          occurred_at: timestamp,
          recorded_at: timestamp,
          source: 'LearningSession',
          target_refs: { courseId: 'course_delete', lessonId: 'lesson_delete' },
          payload: {},
          idempotency_key: 'event_pending_delete',
          correlation_id: 'event_pending_delete',
        },
      });
    });

    const store = createLocalFileCourseArchiveStore(dataRoot);
    const manifest = await unitOfWork.execute({ transactionId: 'tx_delete_course_archive' }, (tx) =>
      store.stageDelete(tx, 'course_delete'),
    );

    expect(manifest.deletedCounts).toMatchObject({
      courses: 1,
      lessons: 1,
      learningSessions: 1,
      schedules: 1,
      facts: 1,
      evidence: 1,
      teachingLedgers: 1,
      reasoningBehaviorEpisodes: 1,
      reasoningBehaviorAnalyses: 1,
    });
    expect(await courses.courses.get('course_delete')).toBeUndefined();
    expect(await courses.courses.get('course_keep')).toMatchObject({ id: 'course_keep' });
    expect(await courses.lessons.get('lesson_delete')).toBeUndefined();
    expect(await courses.lessons.get('lesson_keep')).toMatchObject({ id: 'lesson_keep' });
    expect(await schedules.get('schedule_delete')).toBeUndefined();
    expect(await schedules.get('schedule_keep')).toMatchObject({ id: 'schedule_keep' });
    expect(await messages.list('session_delete')).toEqual([]);
    await expect(access(paths.aggregate('teaching-ledgers', 'session_delete'))).rejects.toThrow();
    await expect(
      access(paths.aggregate('reasoning-behavior-episodes', 'reasoning_delete')),
    ).rejects.toThrow();
    await expect(
      access(paths.aggregate('reasoning-behavior-episodes', 'reasoning_keep')),
    ).resolves.toBeUndefined();
    await expect(
      access(paths.aggregate('reasoning-behavior-analyses', 'reasoning_analysis_global')),
    ).rejects.toThrow();
    expect(await courseDeletionBarrierExists(dataRoot, 'course_delete')).toBe(true);

    const remainingFacts = [];
    for await (const fact of facts.list()) remainingFacts.push(fact.factId);
    expect(remainingFacts).toEqual(['fact_keep']);

    const replay = createFactProjector({ repository: facts, unitOfWork });
    await expect(
      replay.project({
        id: 'event_late_replay',
        schema_version: 1,
        type: 'LessonSessionCompleted',
        occurred_at: timestamp,
        recorded_at: timestamp,
        source: 'LearningSession',
        target_refs: { courseId: 'course_delete', lessonId: 'lesson_delete' },
        payload: { actualSeconds: 90 },
        idempotency_key: 'event_late_replay',
        correlation_id: 'event_late_replay',
      }),
    ).resolves.toEqual({ appended: 0, duplicates: 0, ignored: 1 });
    expect(await facts.get('fact_event_late_replay')).toBeUndefined();
    const remainingEvidence = [];
    for await (const candidate of evidence.evidence.list()) {
      remainingEvidence.push(candidate.evidenceId);
    }
    expect(remainingEvidence).toEqual(['evidence_keep']);

    expect(await planFlows.get('flow_shared')).toMatchObject({
      courseRefs: ['course_keep'],
      lessonRefs: ['lesson_keep'],
      confirmedScheduleItemIds: ['schedule_keep'],
      suggestions: [{ courseId: 'course_keep', lessonId: 'lesson_keep' }],
      resourceVersion: 2,
    });
  }, 15_000);
});
