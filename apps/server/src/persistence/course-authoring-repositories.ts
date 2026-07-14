import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { CandidateOutlineMetadataSchema } from '../modules/course-authoring/implementation/schemas/candidate-outline.js';
import type { CandidateVersionRepository } from '../modules/course-authoring/ports/candidate-version-repository.js';
import type {
  OutlineSessionRecord,
  OutlineSessionRepository,
} from '../modules/course-authoring/ports/outline-session-repository.js';
import type {
  MaterialRecord,
  MaterialRepository,
} from '../modules/course-authoring/ports/material-repository.js';
import {
  ImmutableResourceError,
  RepositoryVersionConflictError,
} from './local-file-repositories.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';

const CourseModeSchema = z.enum([
  'standard',
  'brainstorm',
  'argument_clash',
  'case_study',
  'business_insight',
  'process_decomposition',
  'decision_analysis',
  'cross_explore',
  'reading_seminar',
]);
function migrateOutlineSessionRecord(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const rawSession = record.session;
  if (typeof rawSession !== 'object' || rawSession === null || Array.isArray(rawSession)) {
    return value;
  }
  const session = rawSession as Record<string, unknown>;
  const { assessmentArtifactId: _legacyAssessmentArtifactId, ...currentSession } = session;
  void _legacyAssessmentArtifactId;
  return {
    ...record,
    session: {
      ...currentSession,
      ...(session.state === 'ready-for-candidates' ? { state: 'assessment-ready' } : {}),
    },
  };
}

const CurrentOutlineSessionRecordSchema = z.strictObject({
  resourceVersion: z.number().int().nonnegative(),
  candidateCommandReceipts: z.record(z.string(), z.strictObject({ taskId: z.string() })),
  session: z.strictObject({
    outlineSessionId: z.string(),
    courseMode: CourseModeSchema,
    topic: z.string(),
    state: z.enum([
      'collecting-input',
      'assessing',
      'assessment-turn-running',
      'assessment-ready',
      'alignment-turn-running',
      'generating-candidates',
      'candidate-ready',
      'confirming',
      'confirmed',
    ]),
    messageIds: z.array(z.string()).default([]),
    completedAssessmentRounds: z.number().int().nonnegative().default(0),
    activeUserMessageId: z.string().optional(),
    pendingAlignment: z
      .strictObject({
        action: z.enum(['regenerate', 'patch']),
        targetModuleIds: z.array(z.string()),
      })
      .optional(),
    activeCandidateTaskId: z.string().optional(),
    candidateVersionIds: z.array(z.string()),
    latestCandidateVersionId: z.string().optional(),
    confirmingCandidateVersionId: z.string().optional(),
    confirmedCourseId: z.string().optional(),
    savedAsDraft: z.boolean().optional(),
  }),
  messages: z
    .array(
      z.strictObject({
        messageId: z.string(),
        role: z.enum(['user', 'assistant']),
        content: z.string(),
        status: z.enum(['complete', 'failed']),
        createdAt: z.string(),
        inReplyToMessageId: z.string().optional(),
        alignmentAction: z.enum(['clarify', 'regenerate', 'patch']).optional(),
        targetModuleIds: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});
const OutlineSessionRecordSchema = z.preprocess(
  migrateOutlineSessionRecord,
  CurrentOutlineSessionRecordSchema,
);
function migrateCandidateVersion(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const version = value as Record<string, unknown>;
  const rawCandidate = version.candidate;
  if (
    typeof rawCandidate !== 'object' ||
    rawCandidate === null ||
    Array.isArray(rawCandidate) ||
    'modules' in rawCandidate
  ) {
    return value;
  }
  const candidate = rawCandidate as Record<string, unknown>;
  if (!Array.isArray(candidate.lessons)) return value;
  const modules = candidate.lessons.flatMap((rawLesson, index) => {
    if (typeof rawLesson !== 'object' || rawLesson === null || Array.isArray(rawLesson)) return [];
    const lesson = rawLesson as Record<string, unknown>;
    if (typeof lesson.id !== 'string' || typeof lesson.title !== 'string') return [];
    return [
      {
        id: `module_legacy_${index + 1}`,
        title: lesson.title,
        lessonIds: [lesson.id],
      },
    ];
  });
  return { ...version, candidate: { ...candidate, modules } };
}

const CurrentCandidateVersionSchema = z.strictObject({
  id: z.string(),
  outlineSessionId: z.string(),
  parentVersionId: z.string().optional(),
  generationTaskId: z.string(),
  draftArtifactRef: z.string(),
  candidate: CandidateOutlineMetadataSchema.extend({ outlineMarkdown: z.string() }),
  createdAt: z.string(),
  resourceVersion: z.number().int().nonnegative(),
});
const CandidateVersionSchema = z.preprocess(migrateCandidateVersion, CurrentCandidateVersionSchema);
const MaterialRecordSchema = z.strictObject({
  artifactRef: z.string(),
  outlineSessionId: z.string(),
  originalFileName: z.string(),
  format: z.enum(['markdown', 'text', 'pdf']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.string(),
  parserVersion: z.literal('material-ingestion-v1'),
  extractedText: z.string(),
  sections: z.array(
    z.strictObject({
      title: z.string(),
      level: z.number().int().positive(),
      startPage: z.number().int().positive().optional(),
      endPage: z.number().int().positive().optional(),
    }),
  ),
  warnings: z.array(z.string()),
  resourceVersion: z.number().int().nonnegative(),
});

export interface CourseAuthoringRepositories {
  readonly outlineSessions: OutlineSessionRepository;
  readonly candidateVersions: CandidateVersionRepository;
  readonly materials: MaterialRepository;
}

export function createInMemoryCourseAuthoringRepositories(): CourseAuthoringRepositories {
  const sessions = new Map<string, OutlineSessionRecord>();
  const candidates = new Map<string, Awaited<ReturnType<CandidateVersionRepository['get']>>>();
  const materialsMap = new Map<string, MaterialRecord>();
  const outlineSessions: OutlineSessionRepository = {
    get: async (id) => structuredClone(sessions.get(id)),
    async save(_tx, record, expectedVersion) {
      const currentVersion = sessions.get(record.session.outlineSessionId)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      sessions.set(
        record.session.outlineSessionId,
        structuredClone({ ...record, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *list() {
      for (const id of [...sessions.keys()].sort()) yield structuredClone(sessions.get(id)!);
    },
  };
  const candidateVersions: CandidateVersionRepository = {
    get: async (id) => structuredClone(candidates.get(id)),
    async save(_tx, version, expectedVersion) {
      if (expectedVersion !== 0) throw new RepositoryVersionConflictError(0);
      if (candidates.has(version.id)) throw new ImmutableResourceError();
      candidates.set(version.id, structuredClone({ ...version, resourceVersion: 1 }));
    },
    async *listBySession(outlineSessionId) {
      for (const value of [...candidates.values()].filter(
        (candidate) => candidate?.outlineSessionId === outlineSessionId,
      )) {
        if (value !== undefined) yield structuredClone(value);
      }
    },
  };
  const materials: MaterialRepository = {
    get: async (id) => structuredClone(materialsMap.get(id)),
    async save(_tx, material, expectedVersion) {
      if (expectedVersion !== 0) throw new RepositoryVersionConflictError(0);
      if (materialsMap.has(material.artifactRef)) throw new ImmutableResourceError();
      materialsMap.set(material.artifactRef, structuredClone({ ...material, resourceVersion: 1 }));
    },
    async *listBySession(outlineSessionId) {
      for (const material of materialsMap.values()) {
        if (material.outlineSessionId === outlineSessionId) yield structuredClone(material);
      }
    },
  };
  return { outlineSessions, candidateVersions, materials };
}

async function listIds(dataRoot: DataRoot, entityType: string): Promise<string[]> {
  const root = path.join(dataRoot.absolutePath, 'entities', entityType);
  const shards = await readdir(root, { withFileTypes: true }).catch(() => []);
  const ids: string[] = [];
  for (const shard of shards) {
    if (!shard.isDirectory()) continue;
    for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.json')) ids.push(file.name.slice(0, -5));
    }
  }
  return ids.sort();
}

export function createLocalFileCourseAuthoringRepositories(
  dataRoot: DataRoot,
): CourseAuthoringRepositories {
  const paths = createStorePaths(dataRoot);
  async function read<TSchema extends z.ZodType>(
    entityType: string,
    id: string,
    schema: TSchema,
  ): Promise<z.output<TSchema> | undefined> {
    try {
      return decodeAggregateDocument(
        await readFile(paths.aggregate(entityType, id), 'utf8'),
        schema,
      ).data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async function stage(
    tx: Parameters<OutlineSessionRepository['save']>[0],
    entityType: string,
    id: string,
    resourceVersion: number,
    data: unknown,
  ) {
    const absolute = paths.aggregate(entityType, id);
    await tx.stageJson(path.relative(dataRoot.absolutePath, absolute).replaceAll('\\', '/'), {
      schema: `learning-more/${entityType}`,
      schemaVersion: 1,
      entityType,
      entityId: id,
      resourceVersion,
      createdAt: 'preserved-in-data',
      updatedAt: new Date().toISOString(),
      contentSha256: checksumJson(data),
      data,
    });
  }
  const outlineSessions: OutlineSessionRepository = {
    get: (id) =>
      read('outline-sessions', id, OutlineSessionRecordSchema) as Promise<
        OutlineSessionRecord | undefined
      >,
    async save(tx, record, expectedVersion) {
      const current = await outlineSessions.get(record.session.outlineSessionId);
      const currentVersion = current?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const stored = { ...record, resourceVersion: expectedVersion + 1 };
      await stage(
        tx,
        'outline-sessions',
        record.session.outlineSessionId,
        expectedVersion + 1,
        stored,
      );
    },
    async *list() {
      for (const id of await listIds(dataRoot, 'outline-sessions')) {
        const record = await outlineSessions.get(id);
        if (record !== undefined) yield record;
      }
    },
  };
  const candidateVersions: CandidateVersionRepository = {
    get: (id) =>
      read('outline-candidates', id, CandidateVersionSchema) as ReturnType<
        CandidateVersionRepository['get']
      >,
    async save(tx, version, expectedVersion) {
      if (expectedVersion !== 0) throw new RepositoryVersionConflictError(0);
      if ((await candidateVersions.get(version.id)) !== undefined)
        throw new ImmutableResourceError();
      await stage(tx, 'outline-candidates', version.id, 1, { ...version, resourceVersion: 1 });
    },
    async *listBySession(outlineSessionId) {
      for (const id of await listIds(dataRoot, 'outline-candidates')) {
        const version = await candidateVersions.get(id);
        if (version?.outlineSessionId === outlineSessionId) yield version;
      }
    },
  };
  const materialStorageId = (artifactRef: string) =>
    createHash('sha256').update(artifactRef, 'utf8').digest('hex');
  const materials: MaterialRepository = {
    async get(artifactRef) {
      const record = (await read(
        'materials',
        materialStorageId(artifactRef),
        MaterialRecordSchema,
      )) as MaterialRecord | undefined;
      if (record !== undefined && record.artifactRef !== artifactRef) {
        throw new ImmutableResourceError();
      }
      return record;
    },
    async save(tx, material, expectedVersion) {
      if (expectedVersion !== 0) throw new RepositoryVersionConflictError(0);
      if ((await materials.get(material.artifactRef)) !== undefined) {
        throw new ImmutableResourceError();
      }
      await stage(tx, 'materials', materialStorageId(material.artifactRef), 1, {
        ...material,
        resourceVersion: 1,
      });
    },
    async *listBySession(outlineSessionId) {
      for (const id of await listIds(dataRoot, 'materials')) {
        const record = (await read('materials', id, MaterialRecordSchema)) as
          MaterialRecord | undefined;
        if (record?.outlineSessionId === outlineSessionId) yield record;
      }
    },
  };
  return { outlineSessions, candidateVersions, materials };
}
