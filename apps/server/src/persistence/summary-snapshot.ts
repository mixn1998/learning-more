import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { checksumJson, encodeJson } from './json-codec.js';
import type { DataRoot } from './data-root.js';

type SnapshotDocument<T> = Readonly<{
  schemaVersion: number;
  sourceRevision: string;
  etag: string;
  contentSha256: string;
  value: T;
}>;

export type SummarySnapshotResult<T> = Readonly<{
  etag: string;
  freshness: 'current';
  value: T;
}>;

export interface SummarySnapshot<T> {
  current(): Promise<SummarySnapshotResult<T>>;
}

async function atomicWrite(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, encodeJson(value), 'utf8');
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export function createSummarySnapshot<T>(
  input: Readonly<{
    dataRoot: DataRoot;
    name: string;
    schemaVersion: number;
    sourceRevision(): string;
    parse(value: unknown): T;
    build(): Promise<T>;
  }>,
): SummarySnapshot<T> {
  const filePath = input.dataRoot.resolve('read-models', 'summaries', `${input.name}.json`);
  let memory: SnapshotDocument<T> | undefined;
  let inFlight: Promise<SummarySnapshotResult<T>> | undefined;

  const valid = (document: SnapshotDocument<T>, revision: string): boolean =>
    document.schemaVersion === input.schemaVersion &&
    document.sourceRevision === revision &&
    checksumJson(document.value) === document.contentSha256;

  async function load(revision: string): Promise<SnapshotDocument<T> | undefined> {
    if (memory !== undefined && valid(memory, revision)) return memory;
    try {
      const candidate = JSON.parse(await readFile(filePath, 'utf8')) as SnapshotDocument<unknown>;
      const parsed: SnapshotDocument<T> = {
        ...candidate,
        value: input.parse(candidate.value),
      };
      if (valid(parsed, revision)) {
        memory = parsed;
        return parsed;
      }
    } catch {
      // Missing, old, or damaged snapshots are rebuilt from authoritative repositories.
    }
    return undefined;
  }

  return {
    current() {
      if (inFlight !== undefined) return inFlight;
      inFlight = (async () => {
        const revision = input.sourceRevision();
        const existing = await load(revision);
        if (existing !== undefined) {
          return { etag: existing.etag, freshness: 'current' as const, value: existing.value };
        }
        const value = await input.build();
        const etag = `${input.name}:${revision}`;
        const document: SnapshotDocument<T> = {
          schemaVersion: input.schemaVersion,
          sourceRevision: revision,
          etag,
          contentSha256: checksumJson(value),
          value,
        };
        await atomicWrite(filePath, document);
        memory = document;
        return { etag, freshness: 'current' as const, value };
      })().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
