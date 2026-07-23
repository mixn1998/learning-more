import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { DataKeySchema } from '@learning-more/contracts';

import type { LearningFact } from '../modules/learning-facts/interface.js';
import type { FactRepository } from '../modules/learning-facts/ports/fact-repository.js';
import { courseDeletionBarrierExists } from './course-archive-store.js';
import { DataRoot } from './data-root.js';
import { checksumJson, decodeAggregateDocument } from './json-codec.js';
import { mapConcurrentOrdered } from './concurrent-map.js';

const FactSchema = z.strictObject({
  factId: z.string().min(1),
  factType: z.enum([
    'LessonStartedFact',
    'LessonPausedFact',
    'LessonAbandonedFact',
    'LessonRestoredFact',
    'LessonCompletedFact',
    'CourseCreatedFact',
    'CourseClosedFact',
    'ReviewFinalizedFact',
    'CourseReviewFinalizedFact',
    'ScheduleConfirmedFact',
    'InteractionPromptedFact',
    'InteractionRespondedFact',
    'InteractionSkippedFact',
  ]),
  subjectRefs: z.record(z.string(), z.string()),
  occurredAt: z.iso.datetime({ offset: true }),
  recordedAt: z.iso.datetime({ offset: true }),
  sourceEventId: z.string().min(1),
  dataKeys: z.array(DataKeySchema),
  payload: z.record(z.string(), z.unknown()),
  schemaVersion: z.number().int().positive(),
});

function relativeFactPath(factId: string): string {
  const shard = createHash('sha256').update(factId, 'utf8').digest('hex').slice(0, 2);
  return `read-models/learning-facts/${shard}/${factId}.json`;
}

export function createLocalFileFactRepository(dataRoot: DataRoot): FactRepository {
  const repository: FactRepository = {
    async get(factId) {
      try {
        return decodeAggregateDocument(
          await readFile(path.join(dataRoot.absolutePath, relativeFactPath(factId)), 'utf8'),
          FactSchema,
        ).data as LearningFact;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async append(tx, fact) {
      const courseId = fact.subjectRefs.courseId;
      if (courseId !== undefined && (await courseDeletionBarrierExists(dataRoot, courseId))) {
        return 'ignored_deleted_course';
      }
      const existing = await repository.get(fact.factId);
      if (existing !== undefined) {
        if (
          existing.sourceEventId !== fact.sourceEventId ||
          existing.factType !== fact.factType ||
          JSON.stringify(existing) !== JSON.stringify(fact)
        ) {
          throw new Error('FACT_ID_COLLISION');
        }
        return 'duplicate';
      }
      await tx.stageJson(relativeFactPath(fact.factId), {
        schema: 'learning-more/learning-fact',
        schemaVersion: 1,
        entityType: 'learning-facts',
        entityId: fact.factId,
        resourceVersion: 1,
        createdAt: fact.recordedAt,
        updatedAt: fact.recordedAt,
        contentSha256: checksumJson(fact),
        data: fact,
      });
      return 'appended';
    },
    async retractCourse(tx, courseId) {
      let retracted = 0;
      for await (const fact of repository.list()) {
        if (fact.subjectRefs.courseId !== courseId) continue;
        await tx.deleteOnCommit(relativeFactPath(fact.factId));
        retracted += 1;
      }
      return retracted;
    },
    async *list() {
      const root = path.join(dataRoot.absolutePath, 'read-models', 'learning-facts');
      const factIds: string[] = [];
      for (const shard of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!shard.isDirectory()) continue;
        for (const file of await readdir(path.join(root, shard.name), { withFileTypes: true })) {
          if (!file.isFile() || !file.name.endsWith('.json')) continue;
          factIds.push(file.name.slice(0, -5));
        }
      }
      const facts = (
        await mapConcurrentOrdered(factIds, (factId) => repository.get(factId))
      ).filter((fact): fact is LearningFact => fact !== undefined);
      for (const fact of facts.sort((left, right) =>
        left.occurredAt === right.occurredAt
          ? left.factId.localeCompare(right.factId)
          : left.occurredAt.localeCompare(right.occurredAt),
      )) {
        yield fact;
      }
    },
  };
  return repository;
}
