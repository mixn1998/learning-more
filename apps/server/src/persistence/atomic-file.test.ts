import { describe, expect, it, vi } from 'vitest';

import { replaceFileAtomic, retryTransientFileOperation } from './atomic-file.js';

describe('replaceFileAtomic', () => {
  it.each(['EPERM', 'EBUSY'])(
    'retries a transient Windows %s replacement failure',
    async (code) => {
      const renameFile = vi
        .fn<(_source: string, _target: string) => Promise<void>>()
        .mockRejectedValueOnce(Object.assign(new Error(code), { code }))
        .mockRejectedValueOnce(Object.assign(new Error(code), { code }))
        .mockResolvedValue(undefined);
      const wait = vi.fn(async () => undefined);

      await expect(
        replaceFileAtomic('staged.json', 'task.json', { renameFile, wait, maxAttempts: 4 }),
      ).resolves.toBeUndefined();

      expect(renameFile).toHaveBeenCalledTimes(3);
      expect(wait).toHaveBeenNthCalledWith(1, 4);
      expect(wait).toHaveBeenNthCalledWith(2, 8);
    },
  );

  it('does not hide a permanent storage failure', async () => {
    const error = Object.assign(new Error('disk unavailable'), { code: 'EIO' });
    const renameFile = vi.fn(async () => {
      throw error;
    });

    await expect(replaceFileAtomic('staged.json', 'task.json', { renameFile })).rejects.toBe(error);
    expect(renameFile).toHaveBeenCalledOnce();
  });

  it('also retries transient operations used to prepare rollback data', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EPERM' }))
      .mockResolvedValue('copied');

    await expect(
      retryTransientFileOperation(operation, { wait: async () => undefined }),
    ).resolves.toBe('copied');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
