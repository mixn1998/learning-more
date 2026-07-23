import { execFile } from 'node:child_process';
import path from 'node:path';

import type { ObservedProcess } from './host-lease.js';

function encodedArguments(script: string): readonly string[] {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

export function observeWindowsProcess(
  pid: number,
  options: Readonly<{ platform?: NodeJS.Platform; systemRoot?: string }> = {},
): Promise<ObservedProcess> {
  if (!Number.isInteger(pid) || pid < 1) return Promise.resolve({ state: 'missing' });
  if ((options.platform ?? process.platform) !== 'win32') {
    try {
      process.kill(pid, 0);
      return Promise.resolve({ state: 'running' });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM') return Promise.resolve({ state: 'running' });
      if (code === 'ESRCH') return Promise.resolve({ state: 'missing' });
      return Promise.resolve({ state: 'unavailable' });
    }
  }
  const powershell = path.win32.join(
    options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = `
$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue
if ($null -eq $process) { exit 0 }
[ordered]@{ executablePath = $process.ExecutablePath; commandLine = $process.CommandLine } | ConvertTo-Json -Compress
`;
  return new Promise((resolve) => {
    execFile(
      powershell,
      [...encodedArguments(script)],
      { encoding: 'utf8', shell: false, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          resolve({ state: 'unavailable' });
          return;
        }
        if (stdout.trim() === '') {
          resolve({ state: 'missing' });
          return;
        }
        try {
          const value = JSON.parse(stdout) as Record<string, unknown>;
          resolve({
            state: 'running',
            ...(typeof value.executablePath === 'string'
              ? { executablePath: value.executablePath }
              : {}),
            ...(typeof value.commandLine === 'string' ? { commandLine: value.commandLine } : {}),
          });
        } catch {
          resolve({ state: 'unavailable' });
        }
      },
    );
  });
}
