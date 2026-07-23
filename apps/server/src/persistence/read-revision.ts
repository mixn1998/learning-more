import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type { DataRoot } from './data-root.js';
import type { TransactionContext } from './unit-of-work.js';

export const ReadRevisionScopeSchema = z.enum([
  'catalog',
  'learning',
  'schedule',
  'facts',
  'weekly',
]);
export type ReadRevisionScope = z.infer<typeof ReadRevisionScopeSchema>;

const RevisionsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revisions: z.record(ReadRevisionScopeSchema, z.number().int().nonnegative()),
});

const initialRevisions: Record<ReadRevisionScope, number> = {
  catalog: 0,
  learning: 0,
  schedule: 0,
  facts: 0,
  weekly: 0,
};

function affectedScopes(relativePaths: readonly string[]): Set<ReadRevisionScope> {
  const scopes = new Set<ReadRevisionScope>();
  for (const relativePath of relativePaths) {
    if (
      relativePath.startsWith('entities/courses/') ||
      relativePath.startsWith('entities/outline-sessions/') ||
      relativePath.startsWith('entities/lessons/')
    ) {
      scopes.add('catalog');
    }
    if (
      relativePath.startsWith('entities/lesson-progress/') ||
      relativePath.startsWith('entities/lesson-sessions/') ||
      relativePath.startsWith('entities/reviews/') ||
      relativePath.startsWith('entities/lesson-closures/') ||
      relativePath.startsWith('entities/course-reviews/')
    ) {
      scopes.add('learning');
    }
    if (
      relativePath.startsWith('entities/schedules/') ||
      relativePath.startsWith('entities/plan-flows/')
    ) {
      scopes.add('schedule');
    }
    if (relativePath.startsWith('read-models/') || relativePath.startsWith('events/')) {
      scopes.add('facts');
    }
    if (relativePath.startsWith('entities/weekly-reports/')) scopes.add('weekly');
  }
  return scopes;
}

export interface ReadRevisionTracker {
  current(scopes: readonly ReadRevisionScope[]): string;
  prepare(
    transaction: TransactionContext,
    relativePaths: readonly string[],
  ): Promise<Readonly<Record<ReadRevisionScope, number>> | undefined>;
  committed(revisions: Readonly<Record<ReadRevisionScope, number>>): void;
}

export async function createReadRevisionTracker(dataRoot: DataRoot): Promise<ReadRevisionTracker> {
  const filePath = dataRoot.resolve('read-models', 'source-revisions.json');
  let revisions = { ...initialRevisions };
  try {
    const stored = RevisionsSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
    revisions = { ...initialRevisions, ...stored.revisions };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // A missing or damaged revision file is safe: dependent snapshots rebuild once.
      revisions = { ...initialRevisions };
    }
  }

  return {
    current(scopes) {
      return scopes.map((scope) => `${scope}:${revisions[scope]}`).join('|');
    },
    async prepare(transaction, relativePaths) {
      const affected = affectedScopes(relativePaths);
      if (affected.size === 0) return undefined;
      const next = { ...revisions };
      for (const scope of affected) next[scope] += 1;
      await transaction.stageJson('read-models/source-revisions.json', {
        schemaVersion: 1,
        revisions: next,
      });
      return next;
    },
    committed(next) {
      revisions = { ...next };
    },
  };
}
