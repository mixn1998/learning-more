import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface TempStore {
  readonly root: string;
  dispose(): Promise<void>;
}

export async function createTempStore(): Promise<TempStore> {
  const root = await mkdtemp(path.join(tmpdir(), 'learning-more-'));
  let disposed = false;

  return {
    root,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}
