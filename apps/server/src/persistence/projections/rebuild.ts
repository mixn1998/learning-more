import { randomUUID } from 'node:crypto';

import type { LearningEventEnvelope } from '@learning-more/contracts';

import { DataRoot } from '../data-root.js';
import type { UnitOfWork } from '../unit-of-work.js';
import type { Projection, ProjectionRunResult } from './projection.js';
import { createProjectionRunner } from './projection-runner.js';

export interface ProjectionRebuildResult<TState> extends ProjectionRunResult<TState> {
  readonly generation: string;
}

export async function rebuildProjection<TState>(options: {
  readonly dataRoot: DataRoot;
  readonly unitOfWork: UnitOfWork;
  readonly projection: Projection<TState>;
  readonly events: readonly LearningEventEnvelope[];
  readonly batchSize: number;
}): Promise<ProjectionRebuildResult<TState>> {
  const generation = `${options.projection.name}-v${options.projection.schemaVersion}-${randomUUID()}`;
  const output = await createProjectionRunner(options).run({
    projection: options.projection,
    events: options.events,
    batchSize: options.batchSize,
    generation,
  });
  await options.unitOfWork.execute(
    { transactionId: `tx_projection_switch_${randomUUID()}` },
    (tx) =>
      tx.stageJson(`read-models/projections/${options.projection.name}/current.json`, {
        schemaVersion: options.projection.schemaVersion,
        generation,
        stateChecksum: output.stateChecksum,
        freshness: 'current',
      }),
  );
  return { ...output, generation };
}
