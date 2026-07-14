import { afterEach, describe, expect, it, vi } from 'vitest';

import { commandMatchesLauncher, waitForLauncherReady } from './launcher-process.js';

afterEach(() => vi.unstubAllGlobals());

describe('commandMatchesLauncher', () => {
  it('accepts the direct Launcher entry and the verified workspace wrapper', () => {
    const launcherEntry = 'D:\\workspace\\Learning MORE\\apps\\launcher\\dist\\main.js';
    const wrapperEntry = 'tools\\start-learning-more.mjs';

    expect(
      commandMatchesLauncher(
        '"C:\\Program Files\\nodejs\\node.exe" "D:\\workspace\\Learning MORE\\apps\\launcher\\dist\\main.js"',
        [launcherEntry, wrapperEntry],
      ),
    ).toBe(true);
    expect(
      commandMatchesLauncher(
        '"C:\\Program Files\\nodejs\\node.exe" tools/start-learning-more.mjs',
        [launcherEntry, wrapperEntry],
      ),
    ).toBe(true);
  });

  it('rejects an unrelated Node process', () => {
    expect(
      commandMatchesLauncher('node unrelated-script.mjs', [
        'D:\\workspace\\Learning MORE\\apps\\launcher\\dist\\main.js',
      ]),
    ).toBe(false);
  });

  it('uses the local origin while verifying a candidate Launcher', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'healthy' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ready', buildId: 'build-new' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(waitForLauncherReady('build-new', 100)).resolves.toBeUndefined();

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { accept: 'application/json', origin: 'http://127.0.0.1:43119' },
    });
  });
});
