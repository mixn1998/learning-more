import { describe, expect, it, vi } from 'vitest';

const executeFile = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ execFile: executeFile }));

import { observeWindowsProcess } from './windows-process-observer.js';

describe('Windows process observer', () => {
  it('reports an unavailable observation instead of a missing process when CIM fails', async () => {
    executeFile.mockImplementationOnce(
      (
        _executable: string,
        _arguments: readonly string[],
        _options: unknown,
        callback: (error: Error, stdout: string) => void,
      ) => callback(new Error('cim_temporarily_unavailable'), ''),
    );

    await expect(observeWindowsProcess(43_119, { platform: 'win32' })).resolves.toEqual({
      state: 'unavailable',
    });
  });

  it('reports missing only when CIM successfully observes no process', async () => {
    executeFile.mockImplementationOnce(
      (
        _executable: string,
        _arguments: readonly string[],
        _options: unknown,
        callback: (error: null, stdout: string) => void,
      ) => callback(null, ''),
    );

    await expect(observeWindowsProcess(43_119, { platform: 'win32' })).resolves.toEqual({
      state: 'missing',
    });
  });

  it('returns the verified identity of a running process', async () => {
    executeFile.mockImplementationOnce(
      (
        _executable: string,
        _arguments: readonly string[],
        _options: unknown,
        callback: (error: null, stdout: string) => void,
      ) =>
        callback(
          null,
          JSON.stringify({
            executablePath: 'C:\\Program Files\\nodejs\\node.exe',
            commandLine: 'node tools\\start-learning-more.mjs',
          }),
        ),
    );

    await expect(observeWindowsProcess(43_119, { platform: 'win32' })).resolves.toEqual({
      state: 'running',
      executablePath: 'C:\\Program Files\\nodejs\\node.exe',
      commandLine: 'node tools\\start-learning-more.mjs',
    });
  });
});
