import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DataRoot } from './data-root.js';
import { createLocalFileRepositories } from './local-file-repositories.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { runRepositoryContractSuite } from './repository-contract-suite.js';
import { createUnitOfWork } from './unit-of-work.js';

runRepositoryContractSuite('LocalFile', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-local-repositories-'));
  const dataRoot = DataRoot.create(directory);
  const paths = createStorePaths(dataRoot);
  await initializeStoreLayout(paths);
  const unitOfWork = createUnitOfWork({ dataRoot });
  const repositories = createLocalFileRepositories(dataRoot);

  return {
    repositories,
    commit: (work) => unitOfWork.execute({ transactionId: `tx_${crypto.randomUUID()}` }, work),
    reopen: async () => createLocalFileRepositories(dataRoot),
    async corruptCourse(courseId) {
      await writeFile(paths.aggregate('courses', courseId), '{"corrupted":true}\n', 'utf8');
    },
    cleanup: () => rm(directory, { force: true, recursive: true }),
  };
});
