import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  CourseArchiveDeletionManifest,
  CourseArchiveDeletionReceipt,
  CourseArchiveStore,
} from '../modules/course-authoring/ports/course-archive-store.js';
import { assertSafePathSegment, DataRoot } from './data-root.js';
import { checksumJson, StorageDocumentError } from './json-codec.js';
import { createStorePaths } from './paths.js';
import type { TransactionContext } from './unit-of-work.js';

type JsonObject = Record<string, unknown>;

type StoredDocument = Readonly<{
  relativePath: string;
  document: JsonObject;
  data: JsonObject;
}>;

const entityTypes = [
  'outline-sessions',
  'outline-candidates',
  'courses',
  'outline-versions',
  'lesson-definitions',
  'lesson-progress',
  'lesson-sessions',
  'reviews',
  'lesson-closures',
  'course-reviews',
  'schedules',
  'plan-flows',
  'materials',
  'tasks',
  'weekly-reports',
] as const;

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deletionBarrierRelativePath(courseId: string): string {
  return `indexes/deleted-courses/${digest(courseId)}.json`;
}

function receiptRelativePath(idempotencyKey: string): string {
  return `idempotency/course-archive-deletions/${digest(idempotencyKey)}.json`;
}

const portraitRefreshStatePath = 'portraits/refresh-state.json';

export type PortraitRefreshState = Readonly<{
  schemaVersion: 1;
  state: 'updating' | 'failed';
  reason: 'course_deleted';
  courseId: string;
  updatedAt: string;
  errorCode?: string;
}>;

export async function readPortraitRefreshState(
  dataRoot: DataRoot,
): Promise<PortraitRefreshState | undefined> {
  const value = asObject(await readJson(dataRoot, portraitRefreshStatePath));
  if (value === undefined) return undefined;
  if (
    value.schemaVersion !== 1 ||
    (value.state !== 'updating' && value.state !== 'failed') ||
    value.reason !== 'course_deleted' ||
    typeof value.courseId !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new StorageDocumentError('storage_corrupted');
  }
  return value as PortraitRefreshState;
}

export async function stagePortraitRefreshState(
  tx: TransactionContext,
  state: PortraitRefreshState | undefined,
): Promise<void> {
  if (state === undefined) await tx.deleteOnCommit(portraitRefreshStatePath);
  else await tx.stageJson(portraitRefreshStatePath, state);
}

function messageLogRelativePath(sessionId: string): string {
  return `work/session-messages/${digest(sessionId)}.ndjson`;
}

function artifactPaths(artifactId: string): readonly string[] {
  try {
    assertSafePathSegment(artifactId);
  } catch {
    return [];
  }
  const hash = digest(artifactId);
  return [
    `entities/artifacts/${hash.slice(0, 2)}/${artifactId}`,
    `work/artifacts/${hash}/draft.md`,
  ];
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  const object = asObject(value);
  return object === undefined ? [] : Object.values(object).flatMap(strings);
}

function referencesAny(value: unknown, refs: ReadonlySet<string>): boolean {
  return strings(value).some((candidate) =>
    [...refs].some((ref) => candidate === ref || candidate.includes(ref)),
  );
}

async function walkFiles(root: string, relativeRoot: string): Promise<string[]> {
  const absoluteRoot = path.join(root, ...relativeRoot.split('/'));
  const result: string[] = [];
  for (const entry of await readdir(absoluteRoot, { withFileTypes: true }).catch(() => [])) {
    const relativePath = `${relativeRoot}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await walkFiles(root, relativePath)));
    else if (entry.isFile()) result.push(relativePath);
  }
  return result.sort();
}

async function readJson(dataRoot: DataRoot, relativePath: string): Promise<unknown> {
  try {
    return JSON.parse(
      await readFile(path.join(dataRoot.absolutePath, ...relativePath.split('/')), 'utf8'),
    ) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new StorageDocumentError('storage_corrupted', error);
  }
}

async function storedDocuments(
  dataRoot: DataRoot,
  relativeRoot: string,
): Promise<StoredDocument[]> {
  const result: StoredDocument[] = [];
  for (const relativePath of await walkFiles(dataRoot.absolutePath, relativeRoot)) {
    if (!relativePath.endsWith('.json')) continue;
    const raw = await readJson(dataRoot, relativePath);
    const document = asObject(raw);
    const data = asObject(document?.data);
    if (document === undefined || data === undefined) {
      throw new StorageDocumentError('storage_corrupted');
    }
    if (
      typeof document.contentSha256 === 'string' &&
      document.contentSha256 !== checksumJson(data)
    ) {
      throw new StorageDocumentError('storage_corrupted');
    }
    result.push({ relativePath, document, data });
  }
  return result;
}

function entityId(item: StoredDocument): string {
  const id = item.document.entityId;
  if (typeof id !== 'string') throw new StorageDocumentError('storage_corrupted');
  return id;
}

function count(counts: Record<string, number>, key: string, increment = 1): void {
  counts[key] = (counts[key] ?? 0) + increment;
}

function withoutRefs(values: unknown, removed: ReadonlySet<string>): string[] {
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string' && !removed.has(value))
    : [];
}

function updateAggregateDocument(item: StoredDocument, data: JsonObject): JsonObject {
  const resourceVersion = Number(data.resourceVersion);
  return {
    ...item.document,
    resourceVersion,
    updatedAt: new Date().toISOString(),
    contentSha256: checksumJson(data),
    data,
  };
}

export async function courseDeletionBarrierExists(
  dataRoot: DataRoot,
  courseId: string,
): Promise<boolean> {
  return (await readJson(dataRoot, deletionBarrierRelativePath(courseId))) !== undefined;
}

export function createLocalFileCourseArchiveStore(dataRoot: DataRoot): CourseArchiveStore {
  const paths = createStorePaths(dataRoot);

  return {
    async getCourse(courseId) {
      if (await courseDeletionBarrierExists(dataRoot, courseId)) return undefined;
      const absolute = paths.aggregate('courses', courseId);
      const relativePath = path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/');
      const document = asObject(await readJson(dataRoot, relativePath));
      if (document === undefined) return undefined;
      const data = asObject(document.data);
      if (data === undefined || data.id !== courseId || typeof data.resourceVersion !== 'number') {
        throw new StorageDocumentError('storage_corrupted');
      }
      if (document.contentSha256 !== checksumJson(data)) {
        throw new StorageDocumentError('storage_corrupted');
      }
      return { courseId, resourceVersion: data.resourceVersion };
    },

    async getReceipt(idempotencyKey) {
      const value = asObject(await readJson(dataRoot, receiptRelativePath(idempotencyKey)));
      if (value === undefined) return undefined;
      if (
        value.idempotencyKey !== idempotencyKey ||
        typeof value.requestHash !== 'string' ||
        typeof value.courseId !== 'string' ||
        asObject(value.result) === undefined
      ) {
        throw new StorageDocumentError('storage_corrupted');
      }
      return value as CourseArchiveDeletionReceipt;
    },

    async saveReceipt(tx, receipt) {
      await tx.stageJson(receiptRelativePath(receipt.idempotencyKey), receipt);
    },

    async stageDelete(
      tx: TransactionContext,
      courseId: string,
    ): Promise<CourseArchiveDeletionManifest> {
      const byType = new Map<string, StoredDocument[]>();
      for (const type of entityTypes) {
        byType.set(type, await storedDocuments(dataRoot, `entities/${type}`));
      }
      const facts = await storedDocuments(dataRoot, 'read-models/learning-facts');
      const evidence = await storedDocuments(dataRoot, 'portrait-evidence/candidates');
      const checkpoints = await storedDocuments(dataRoot, 'portrait-evidence/checkpoints');
      const rejections = await storedDocuments(dataRoot, 'portrait-evidence/rejections');
      const portraitFiles = await walkFiles(dataRoot.absolutePath, 'portraits');
      const globalProfileFiles = await walkFiles(dataRoot.absolutePath, 'global-profile');
      const pendingOutboxFiles = await walkFiles(dataRoot.absolutePath, 'outbox/pending');

      const course = (byType.get('courses') ?? []).find((item) => entityId(item) === courseId);
      if (course === undefined)
        throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });

      const lessons = (byType.get('lesson-definitions') ?? []).filter(
        (item) => item.data.courseId === courseId,
      );
      const lessonIds = new Set(lessons.map(entityId));
      const outlines = (byType.get('outline-versions') ?? []).filter(
        (item) => item.data.courseId === courseId,
      );
      const candidateIds = new Set(
        outlines
          .map((item) => item.data.sourceCandidateVersionId)
          .filter((value): value is string => typeof value === 'string'),
      );
      const outlineSessions = (byType.get('outline-sessions') ?? []).filter(
        (item) => asObject(item.data.session)?.confirmedCourseId === courseId,
      );
      const outlineSessionIds = new Set(
        outlineSessions
          .map((item) => asObject(item.data.session)?.outlineSessionId)
          .filter((value): value is string => typeof value === 'string'),
      );
      const candidates = (byType.get('outline-candidates') ?? []).filter(
        (item) =>
          candidateIds.has(entityId(item)) ||
          (typeof item.data.outlineSessionId === 'string' &&
            outlineSessionIds.has(item.data.outlineSessionId)),
      );
      for (const candidate of candidates) candidateIds.add(entityId(candidate));
      const materials = (byType.get('materials') ?? []).filter(
        (item) =>
          typeof item.data.outlineSessionId === 'string' &&
          outlineSessionIds.has(item.data.outlineSessionId),
      );

      const learningRecords = (byType.get('lesson-progress') ?? []).filter((item) =>
        lessonIds.has(String(item.data.lessonId)),
      );
      const sessionIds = new Set<string>();
      const reviewIds = new Set<string>();
      const taskIds = new Set<string>();
      const artifactIds = new Set<string>();
      for (const record of learningRecords) {
        const learning = asObject(record.data.learning);
        const session = asObject(learning?.session);
        if (typeof session?.id === 'string') sessionIds.add(session.id);
        if (typeof session?.stageReviewId === 'string') reviewIds.add(session.stageReviewId);
        if (typeof session?.finalReviewId === 'string') reviewIds.add(session.finalReviewId);
        if (typeof session?.activeGenerationTaskId === 'string')
          taskIds.add(session.activeGenerationTaskId);
        const finalReview = asObject(record.data.finalReview);
        if (typeof finalReview?.id === 'string') reviewIds.add(finalReview.id);
        if (typeof finalReview?.artifactRef === 'string') artifactIds.add(finalReview.artifactRef);
      }

      const supplementary = (byType.get('lesson-sessions') ?? []).filter(
        (item) => item.data.courseId === courseId || lessonIds.has(String(item.data.lessonId)),
      );
      for (const item of supplementary) sessionIds.add(entityId(item));
      const stageReviews = (byType.get('reviews') ?? []).filter((item) =>
        lessonIds.has(String(item.data.lessonId)),
      );
      for (const item of stageReviews) {
        reviewIds.add(entityId(item));
        for (const key of ['taskId', 'generationTaskId'] as const) {
          if (typeof item.data[key] === 'string') taskIds.add(item.data[key]);
        }
        for (const key of ['artifactRef', 'draftArtifactRef'] as const) {
          if (typeof item.data[key] === 'string') artifactIds.add(item.data[key]);
        }
      }
      const closures = (byType.get('lesson-closures') ?? []).filter((item) =>
        lessonIds.has(String(item.data.lessonId)),
      );
      for (const item of closures) {
        if (typeof item.data.sessionId === 'string') sessionIds.add(item.data.sessionId);
        if (typeof item.data.generationTaskId === 'string') taskIds.add(item.data.generationTaskId);
        if (typeof item.data.draftArtifactRef === 'string')
          artifactIds.add(item.data.draftArtifactRef);
        const review = asObject(item.data.review);
        if (typeof review?.artifactRef === 'string') artifactIds.add(review.artifactRef);
      }
      const courseReviews = (byType.get('course-reviews') ?? []).filter(
        (item) => item.data.courseId === courseId || entityId(item) === courseId,
      );
      for (const item of courseReviews) {
        if (typeof item.data.generationTaskId === 'string') taskIds.add(item.data.generationTaskId);
        for (const key of ['artifactRef', 'draftArtifactRef'] as const) {
          if (typeof item.data[key] === 'string') artifactIds.add(item.data[key]);
        }
      }

      for (const sessionId of sessionIds) {
        const messagePath = messageLogRelativePath(sessionId);
        try {
          const text = await readFile(
            path.join(dataRoot.absolutePath, ...messagePath.split('/')),
            'utf8',
          );
          for (const line of text.split('\n').filter(Boolean)) {
            const message = asObject(asObject(JSON.parse(line) as unknown)?.message);
            if (typeof message?.contentArtifactRef === 'string') {
              artifactIds.add(message.contentArtifactRef);
            }
            if (typeof message?.generationTaskId === 'string')
              taskIds.add(message.generationTaskId);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new StorageDocumentError('storage_corrupted', error);
          }
        }
      }

      for (const item of candidates) {
        if (typeof item.data.generationTaskId === 'string') taskIds.add(item.data.generationTaskId);
        if (typeof item.data.draftArtifactRef === 'string')
          artifactIds.add(item.data.draftArtifactRef);
      }
      for (const item of materials) {
        if (typeof item.data.artifactRef === 'string') artifactIds.add(item.data.artifactRef);
      }

      const schedules = (byType.get('schedules') ?? []).filter(
        (item) => item.data.courseId === courseId || lessonIds.has(String(item.data.lessonId)),
      );
      const scheduleIds = new Set(schedules.map(entityId));
      const deletedPlanFlows: StoredDocument[] = [];
      const updatedPlanFlows: Readonly<{ item: StoredDocument; data: JsonObject }>[] = [];
      for (const item of byType.get('plan-flows') ?? []) {
        const affected =
          referencesAny(item.data.courseRefs, new Set([courseId])) ||
          referencesAny(item.data.lessonRefs, lessonIds);
        if (!affected) continue;
        const courseRefs = withoutRefs(item.data.courseRefs, new Set([courseId]));
        const lessonRefs = withoutRefs(item.data.lessonRefs, lessonIds);
        const suggestions = Array.isArray(item.data.suggestions)
          ? item.data.suggestions.filter((suggestion) => {
              const value = asObject(suggestion);
              return value?.courseId !== courseId && !lessonIds.has(String(value?.lessonId));
            })
          : [];
        if (courseRefs.length === 0 && lessonRefs.length === 0 && suggestions.length === 0) {
          deletedPlanFlows.push(item);
          if (typeof item.data.generationTaskId === 'string')
            taskIds.add(item.data.generationTaskId);
          for (const key of [
            'constraintsArtifactRef',
            'existingScheduleSnapshotRef',
            'draftArtifactRef',
          ] as const) {
            if (typeof item.data[key] === 'string') artifactIds.add(item.data[key]);
          }
          continue;
        }
        const confirmationReceipts = Object.fromEntries(
          Object.entries(asObject(item.data.confirmationReceipts) ?? {}).map(([key, value]) => [
            key,
            withoutRefs(value, scheduleIds),
          ]),
        );
        updatedPlanFlows.push({
          item,
          data: {
            ...item.data,
            courseRefs,
            lessonRefs,
            suggestions,
            confirmationReceipts,
            confirmedScheduleItemIds: withoutRefs(item.data.confirmedScheduleItemIds, scheduleIds),
            updatedAt: new Date().toISOString(),
            resourceVersion: Number(item.data.resourceVersion ?? 0) + 1,
          },
        });
      }

      const courseFacts = facts.filter(
        (item) =>
          referencesAny(item.data.subjectRefs, new Set([courseId])) ||
          referencesAny(item.data.subjectRefs, lessonIds),
      );
      const factIds = new Set(courseFacts.map((item) => String(item.data.factId)));
      const sourceRefs = new Set([courseId, ...lessonIds, ...sessionIds, ...reviewIds, ...factIds]);
      const courseEvidence = evidence.filter(
        (item) =>
          referencesAny(item.data.sourceRefs, sourceRefs) ||
          referencesAny(item.data.sourceGroupId, sourceRefs) ||
          referencesAny(item.data.dependentSourceGroupIds, sourceRefs),
      );
      const courseRejections = rejections.filter((item) => factIds.has(String(item.data.factId)));

      for (const relativePath of portraitFiles.filter((file) => file.endsWith('.json'))) {
        const value = asObject(await readJson(dataRoot, relativePath));
        const data = asObject(value?.data);
        for (const candidate of [value, data]) {
          for (const key of ['versionId', 'generationTaskId', 'draftArtifactRef'] as const) {
            const ref = candidate?.[key];
            if (typeof ref === 'string') {
              if (key === 'generationTaskId') taskIds.add(ref);
              else if (key === 'draftArtifactRef') artifactIds.add(ref);
            }
          }
        }
      }

      const ownerRefs = new Set([
        courseId,
        ...lessonIds,
        ...sessionIds,
        ...reviewIds,
        ...outlineSessionIds,
        ...candidateIds,
        ...deletedPlanFlows.map(entityId),
      ]);
      const tasks = (byType.get('tasks') ?? []).filter(
        (item) => taskIds.has(entityId(item)) || referencesAny(item.data, ownerRefs),
      );
      for (const item of tasks) {
        for (const key of ['resultRef', 'draftArtifactRef'] as const) {
          if (typeof item.data[key] === 'string') artifactIds.add(item.data[key]);
        }
      }

      const weeklyReports = byType.get('weekly-reports') ?? [];
      for (const item of weeklyReports) {
        if (typeof item.data.artifactRef === 'string') artifactIds.add(item.data.artifactRef);
      }

      const counts: Record<string, number> = {};
      const deletions = new Set<string>();
      const add = (items: readonly StoredDocument[], key: string) => {
        for (const item of items) deletions.add(item.relativePath);
        count(counts, key, items.length);
      };
      add([course], 'courses');
      add(lessons, 'lessons');
      add(outlines, 'outlineVersions');
      add(outlineSessions, 'outlineSessions');
      add(candidates, 'candidateVersions');
      add(materials, 'materials');
      add(learningRecords, 'learningSessions');
      add(supplementary, 'supplementarySessions');
      add(stageReviews, 'reviews');
      add(closures, 'lessonClosures');
      add(courseReviews, 'courseReviews');
      add(schedules, 'schedules');
      add(deletedPlanFlows, 'planFlows');
      add(tasks, 'generationTasks');
      add(courseFacts, 'facts');
      add(courseEvidence, 'evidence');
      add(courseRejections, 'evidenceRejections');
      add(checkpoints, 'evidenceCheckpoints');
      add(weeklyReports, 'weeklyReports');
      for (const sessionId of sessionIds) deletions.add(messageLogRelativePath(sessionId));
      count(counts, 'messageLogs', sessionIds.size);
      for (const relativePath of portraitFiles) deletions.add(relativePath);
      count(counts, 'portraits', portraitFiles.length);
      for (const relativePath of globalProfileFiles) deletions.add(relativePath);
      count(counts, 'globalProfileArtifacts', globalProfileFiles.length);

      for (const pendingPath of pendingOutboxFiles) {
        if (!pendingPath.endsWith('.json')) continue;
        const pending = asObject(await readJson(dataRoot, pendingPath));
        const event = asObject(pending?.event);
        if (
          referencesAny(event?.target_refs, new Set([courseId])) ||
          referencesAny(event?.target_refs, lessonIds)
        ) {
          deletions.add(pendingPath);
          count(counts, 'pendingEvents');
        }
      }

      const allRemainingDocuments = [...byType.values()]
        .flat()
        .filter((item) => !deletions.has(item.relativePath));
      for (const artifactId of artifactIds) {
        if (allRemainingDocuments.some((item) => referencesAny(item.data, new Set([artifactId])))) {
          continue;
        }
        for (const artifactPath of artifactPaths(artifactId)) deletions.add(artifactPath);
        count(counts, 'artifacts');
      }

      for (const update of updatedPlanFlows) {
        await tx.stageJson(
          update.item.relativePath,
          updateAggregateDocument(update.item, update.data),
        );
        count(counts, 'planFlowsUpdated');
      }
      for (const relativePath of [...deletions].sort()) await tx.deleteOnCommit(relativePath);
      await tx.stageJson(deletionBarrierRelativePath(courseId), {
        schemaVersion: 1,
        courseId,
        deletedAt: new Date().toISOString(),
      });
      await stagePortraitRefreshState(tx, {
        schemaVersion: 1,
        state: 'updating',
        reason: 'course_deleted',
        courseId,
        updatedAt: new Date().toISOString(),
      });

      return { courseId, deletedCounts: counts };
    },
  };
}
