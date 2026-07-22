import { describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceAutoActivationMonitor,
  isActivationRelevantPath,
} from './workspace-auto-activation.js';

describe('workspace auto activation', () => {
  it('only treats runtime source and build configuration as activation relevant', () => {
    expect(isActivationRelevantPath('apps/server/src/main.ts')).toBe(true);
    expect(isActivationRelevantPath('packages/contracts/src/review.ts')).toBe(true);
    expect(isActivationRelevantPath('pnpm-lock.yaml')).toBe(true);
    expect(isActivationRelevantPath('apps/server/dist/main.js')).toBe(false);
    expect(isActivationRelevantPath('apps/server/node_modules/pkg/index.js')).toBe(false);
    expect(isActivationRelevantPath('docs/notes.md')).toBe(false);
    expect(isActivationRelevantPath('.learning-more-data/entities/task.json')).toBe(false);
  });

  it('collapses a stable change batch into one activation request', async () => {
    vi.useFakeTimers();
    let listener: ((relativePath: string | undefined) => void) | undefined;
    const close = vi.fn();
    const publishRequest = vi.fn().mockResolvedValue(undefined);
    const monitor = createWorkspaceAutoActivationMonitor({
      projectRoot: 'D:\\workspace',
      requestPath: 'D:\\host\\request.json',
      quietMs: 100,
      nextRequestId: () => 'request-stable',
      watchWorkspace(callback) {
        listener = callback;
        return { close };
      },
      publishRequest,
    });

    monitor.start();
    listener?.('apps/server/src/a.ts');
    await vi.advanceTimersByTimeAsync(50);
    listener?.('apps/server/src/b.ts');
    await vi.advanceTimersByTimeAsync(99);
    expect(publishRequest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(publishRequest).toHaveBeenCalledOnce();
    expect(publishRequest).toHaveBeenCalledWith('request-stable');

    monitor.stop();
    expect(close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
