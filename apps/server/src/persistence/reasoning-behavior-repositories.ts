import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ReasoningBehaviorAnalysisSnapshotSchema,
  ReasoningBehaviorClassificationSchema,
  ReasoningBehaviorEpisodeSchema,
  ReasoningDimensionDefinitionSchema,
  type ReasoningBehaviorEpisode,
} from '@learning-more/contracts';
import { z } from 'zod';

import type {
  ReasoningBehaviorAnalysisRecord,
  ReasoningBehaviorRepository,
} from '../modules/global-user-profile/ports/reasoning-behavior-repository.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { createStorePaths } from './paths.js';
import { RepositoryVersionConflictError } from './repository-errors.js';

const ReasoningBehaviorAnalysisRecordSchema = z.strictObject({
  snapshot: ReasoningBehaviorAnalysisSnapshotSchema,
  dimensions: z.array(ReasoningDimensionDefinitionSchema),
  classifications: z.array(ReasoningBehaviorClassificationSchema),
  resourceVersion: z.number().int().nonnegative(),
});

export function createInMemoryReasoningBehaviorRepository(): ReasoningBehaviorRepository {
  const episodes = new Map<string, ReasoningBehaviorEpisode>();
  const analyses = new Map<string, ReasoningBehaviorAnalysisRecord>();
  return {
    getEpisode: async (episodeId) => structuredClone(episodes.get(episodeId)),
    async saveEpisode(_tx, episode, expectedVersion) {
      const currentVersion = episodes.get(episode.episodeId)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || episode.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      episodes.set(
        episode.episodeId,
        structuredClone({ ...episode, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *listEpisodes() {
      for (const id of [...episodes.keys()].sort()) yield structuredClone(episodes.get(id)!);
    },
    getAnalysis: async (snapshotId) => structuredClone(analyses.get(snapshotId)),
    async saveAnalysis(_tx, record, expectedVersion) {
      const currentVersion = analyses.get(record.snapshot.snapshotId)?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      analyses.set(
        record.snapshot.snapshotId,
        structuredClone({ ...record, resourceVersion: expectedVersion + 1 }),
      );
    },
    async *listAnalyses() {
      for (const id of [...analyses.keys()].sort()) yield structuredClone(analyses.get(id)!);
    },
  };
}

export function createLocalFileReasoningBehaviorRepository(
  dataRoot: DataRoot,
): ReasoningBehaviorRepository {
  const paths = createStorePaths(dataRoot);
  const episodeType = 'reasoning-behavior-episodes';
  const analysisType = 'reasoning-behavior-analyses';

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

  async function ids(entityType: string): Promise<string[]> {
    const root = path.join(dataRoot.absolutePath, 'entities', entityType);
    const result: string[] = [];
    for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!shard.isDirectory()) continue;
      for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
        if (file.isFile() && file.name.endsWith('.json')) result.push(file.name.slice(0, -5));
      }
    }
    return result.sort();
  }

  async function stage(
    tx: Parameters<ReasoningBehaviorRepository['saveEpisode']>[0],
    entityType: string,
    entityId: string,
    data: unknown,
    resourceVersion: number,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const absolutePath = paths.aggregate(entityType, entityId);
    await tx.stageJson(path.relative(dataRoot.absolutePath, absolutePath).replaceAll('\\', '/'), {
      schema: `learning-more/${entityType}`,
      schemaVersion: 1,
      entityType,
      entityId,
      resourceVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
      contentSha256: checksumJson(data),
      data,
    });
  }

  const repository: ReasoningBehaviorRepository = {
    async getEpisode(episodeId) {
      return (await read(episodeType, episodeId, ReasoningBehaviorEpisodeSchema)) as
        ReasoningBehaviorEpisode | undefined;
    },
    async saveEpisode(tx, episode, expectedVersion) {
      const currentVersion = (await repository.getEpisode(episode.episodeId))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || episode.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const stored = ReasoningBehaviorEpisodeSchema.parse({
        ...episode,
        resourceVersion: expectedVersion + 1,
      });
      await stage(tx, episodeType, episode.episodeId, stored, stored.resourceVersion);
    },
    async *listEpisodes() {
      for (const id of await ids(episodeType)) {
        const episode = await repository.getEpisode(id);
        if (episode !== undefined) yield episode;
      }
    },
    async getAnalysis(snapshotId) {
      return (await read(analysisType, snapshotId, ReasoningBehaviorAnalysisRecordSchema)) as
        ReasoningBehaviorAnalysisRecord | undefined;
    },
    async saveAnalysis(tx, record, expectedVersion) {
      const currentVersion =
        (await repository.getAnalysis(record.snapshot.snapshotId))?.resourceVersion ?? 0;
      if (currentVersion !== expectedVersion || record.resourceVersion !== expectedVersion) {
        throw new RepositoryVersionConflictError(currentVersion);
      }
      const stored = ReasoningBehaviorAnalysisRecordSchema.parse({
        ...record,
        resourceVersion: expectedVersion + 1,
      });
      await stage(tx, analysisType, record.snapshot.snapshotId, stored, stored.resourceVersion);
    },
    async *listAnalyses() {
      for (const id of await ids(analysisType)) {
        const record = await repository.getAnalysis(id);
        if (record !== undefined) yield record;
      }
    },
  };
  return repository;
}
