import { randomUUID } from 'node:crypto';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import { DataRoot } from '../data-root.js';
import { checksumJson, encodeJson } from '../json-codec.js';
import type { UnitOfWork } from '../unit-of-work.js';
import { createProjectionCheckpointRepository } from './checkpoint-repository.js';
import type { Projection, ProjectionCheckpoint, ProjectionRunResult } from './projection.js';

export type ProjectionFaultPoint = `after-batch:${number}`;

export interface ProjectionRunRequest<TState> {
  readonly projection: Projection<TState>;
  readonly events: readonly LearningEventEnvelope[];
  readonly batchSize: number;
  readonly generation: string;
  readonly faultInjector?: (point: ProjectionFaultPoint) => void | Promise<void>;
}

export interface ProjectionRunner {
  run<TState>(request: ProjectionRunRequest<TState>): Promise<ProjectionRunResult<TState>>;
}

export function createProjectionRunner(options: {
  readonly dataRoot: DataRoot;
  readonly unitOfWork: UnitOfWork;
}): ProjectionRunner {
  const checkpoints = createProjectionCheckpointRepository(options.dataRoot);
  return {
    async run<TState>(request: ProjectionRunRequest<TState>) {
      if (!Number.isInteger(request.batchSize) || request.batchSize <= 0) {
        throw new RangeError('PROJECTION_BATCH_SIZE_INVALID');
      }
      const stored = await checkpoints.load<TState>(request.projection.name, request.generation);
      if (
        stored !== undefined &&
        stored.checkpoint.schemaVersion !== request.projection.schemaVersion
      ) {
        throw new Error('PROJECTION_SCHEMA_VERSION_MISMATCH');
      }
      let state = stored?.state ?? request.projection.initial();
      let offset = stored?.checkpoint.lastEventOffset ?? 0;
      const seen = new Set(request.events.slice(0, offset).map((event) => event.id));
      let lastEventId = stored?.checkpoint.lastEventId;
      let batchIndex = 0;

      while (offset < request.events.length) {
        const batchEnd = Math.min(offset + request.batchSize, request.events.length);
        for (const event of request.events.slice(offset, batchEnd)) {
          if (!seen.has(event.id)) {
            state = request.projection.apply(state, event);
            seen.add(event.id);
          }
          lastEventId = event.id;
        }
        offset = batchEnd;
        const checkpoint: ProjectionCheckpoint = {
          projection: request.projection.name,
          schemaVersion: request.projection.schemaVersion,
          lastEventOffset: offset,
          stateChecksum: checksumJson(state),
          ...(lastEventId === undefined ? {} : { lastEventId }),
        };
        await options.unitOfWork.execute({ transactionId: `tx_projection_${randomUUID()}` }, (tx) =>
          checkpoints.save(tx, request.projection.name, request.generation, state, checkpoint),
        );
        await request.faultInjector?.(`after-batch:${batchIndex}`);
        batchIndex += 1;
      }

      const stateJson = encodeJson(state);
      const stateChecksum = checksumJson(state);
      return {
        state,
        stateJson,
        stateChecksum,
        checkpoint: {
          projection: request.projection.name,
          schemaVersion: request.projection.schemaVersion,
          lastEventOffset: offset,
          stateChecksum,
          ...(lastEventId === undefined ? {} : { lastEventId }),
        },
      };
    },
  };
}
