import {
  createInMemoryRepositories,
  createInMemoryRepositoryBacking,
} from './in-memory-repositories.js';
import { runRepositoryContractSuite } from './repository-contract-suite.js';

runRepositoryContractSuite('InMemory', async () => {
  const backing = createInMemoryRepositoryBacking();
  const repositories = createInMemoryRepositories(backing);
  return {
    repositories,
    async commit(work) {
      await work({
        stageJson: async () => undefined,
        stageText: async () => undefined,
        deleteOnCommit: async () => undefined,
      });
    },
    reopen: async () => createInMemoryRepositories(backing),
    async corruptCourse(courseId) {
      backing.courses.set(courseId, { corrupted: true });
    },
    cleanup: async () => undefined,
  };
});
