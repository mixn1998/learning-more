import { randomUUID } from 'node:crypto';

import { DataRoot } from '../../persistence/data-root.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import { createStorePaths, initializeStoreLayout } from '../../persistence/paths.js';
import { recoverTransactions } from '../../persistence/recover-transactions.js';
import { createUnitOfWork } from '../../persistence/unit-of-work.js';
import type { LocalApplicationOptions } from './contracts.js';

export type LocalFoundation = Readonly<{
  dataRoot: DataRoot;
  unitOfWork: ReturnType<typeof createUnitOfWork>;
  artifactStore: ReturnType<typeof createMarkdownArtifactStore>;
  now: () => Date;
  instanceId: string;
}>;

export async function createLocalFoundation(
  options: LocalApplicationOptions,
): Promise<LocalFoundation> {
  const dataRoot = DataRoot.create(options.dataRoot);
  await initializeStoreLayout(createStorePaths(dataRoot));
  await recoverTransactions(dataRoot);
  const unitOfWork = createUnitOfWork({ dataRoot });
  return {
    dataRoot,
    unitOfWork,
    artifactStore: createMarkdownArtifactStore(dataRoot, unitOfWork),
    now: options.now ?? (() => new Date()),
    instanceId: options.runtimeIdentity?.instanceId ?? `instance_${randomUUID()}`,
  };
}
