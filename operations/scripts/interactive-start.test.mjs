import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { openApplicationUrl, runInteractiveStart } from './interactive-start.mjs';

const webUrl = 'http://127.0.0.1:43119/';

describe('interactive workspace start', () => {
  it('delegates one URL open to the Windows shell after the process is spawned', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnProcess = vi.fn(() => child);

    const opened = openApplicationUrl(webUrl, spawnProcess);
    child.emit('spawn');
    await opened;

    expect(spawnProcess).toHaveBeenCalledWith(
      'rundll32.exe',
      ['url.dll,FileProtocolHandler', webUrl],
      {
        shell: false,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      },
    );
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('starts headless by default', async () => {
    const openUrl = vi.fn();
    const startLauncher = vi.fn().mockResolvedValue({ close: vi.fn() });

    const result = await runInteractiveStart({
      arguments_: [],
      startLauncher,
      openUrl,
      webUrl,
    });

    expect(startLauncher).toHaveBeenCalledTimes(1);
    expect(openUrl).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(0);
  });

  it('rejects unknown arguments before starting the Launcher', async () => {
    const startLauncher = vi.fn();

    await expect(
      runInteractiveStart({
        arguments_: ['--unexpected'],
        startLauncher,
        openUrl: vi.fn(),
        webUrl,
      }),
    ).rejects.toThrow('interactive_start_arguments_invalid:--unexpected');
    expect(startLauncher).not.toHaveBeenCalled();
  });

  it('does not open a URL when Launcher startup fails', async () => {
    const openUrl = vi.fn();

    await expect(
      runInteractiveStart({
        arguments_: ['--open'],
        startLauncher: vi.fn().mockRejectedValue(new Error('launcher_start_failed')),
        openUrl,
        webUrl,
      }),
    ).rejects.toThrow('launcher_start_failed');
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('opens exactly once after explicit startup succeeds', async () => {
    const order = [];

    const result = await runInteractiveStart({
      arguments_: ['--open'],
      startLauncher: async () => {
        order.push('start');
        return { close: vi.fn() };
      },
      openUrl: async () => {
        order.push('open');
      },
      webUrl,
    });

    expect(order).toEqual(['start', 'open']);
    expect(result.exitCode).toBe(0);
  });

  it('keeps a healthy Launcher running when the Windows URL handler fails', async () => {
    const launcher = { close: vi.fn() };

    const result = await runInteractiveStart({
      arguments_: ['--open'],
      startLauncher: vi.fn().mockResolvedValue(launcher),
      openUrl: vi.fn().mockRejectedValue(new Error('url_handler_unavailable')),
      webUrl,
    });

    expect(result).toEqual({ launcher, exitCode: 1 });
    expect(launcher.close).not.toHaveBeenCalled();
  });
});
