import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { DataRoot, assertSafePathSegment } from '../data-root.js';
import { checksumJson, encodeJson, StorageDocumentError } from '../json-codec.js';
import type { TransactionContext } from '../unit-of-work.js';
import type { ProjectionCheckpoint } from './projection.js';

export interface StoredProjection<TState> {
  readonly state: TState;
  readonly checkpoint: ProjectionCheckpoint;
}

export interface ProjectionCheckpointRepository {
  load<TState>(
    projection: string,
    generation: string,
  ): Promise<StoredProjection<TState> | undefined>;
  save<TState>(
    tx: TransactionContext,
    projection: string,
    generation: string,
    state: TState,
    checkpoint: ProjectionCheckpoint,
  ): Promise<void>;
}

function basePath(projection: string, generation: string): string {
  assertSafePathSegment(projection);
  assertSafePathSegment(generation);
  return `read-models/projections/${projection}/generations/${generation}`;
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function createProjectionCheckpointRepository(
  dataRoot: DataRoot,
): ProjectionCheckpointRepository {
  return {
    async load<TState>(projection: string, generation: string) {
      const base = basePath(projection, generation);
      const stateText = await readOptional(path.join(dataRoot.absolutePath, base, 'state.json'));
      const checkpointText = await readOptional(
        path.join(dataRoot.absolutePath, base, 'checkpoint.json'),
      );
      if (stateText === undefined && checkpointText === undefined) return undefined;
      if (stateText === undefined || checkpointText === undefined) {
        throw new StorageDocumentError('storage_corrupted');
      }
      try {
        const state = JSON.parse(stateText) as TState;
        const checkpoint = JSON.parse(checkpointText) as ProjectionCheckpoint;
        if (checkpoint.stateChecksum !== checksumJson(state)) {
          throw new StorageDocumentError('storage_corrupted');
        }
        return { state, checkpoint };
      } catch (error) {
        if (error instanceof StorageDocumentError) throw error;
        throw new StorageDocumentError('storage_corrupted', error);
      }
    },
    async save(tx, projection, generation, state, checkpoint) {
      const base = basePath(projection, generation);
      if (checkpoint.stateChecksum !== checksumJson(state)) {
        throw new StorageDocumentError('storage_corrupted');
      }
      await tx.stageText(`${base}/state.json`, encodeJson(state));
      await tx.stageText(`${base}/checkpoint.json`, encodeJson(checkpoint));
    },
  };
}
