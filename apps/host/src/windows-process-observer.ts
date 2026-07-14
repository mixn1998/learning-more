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

export function observeWindowsProcess(pid: number): Promise<ObservedProcess> {
  if (!Number.isInteger(pid) || pid < 1) return Promise.resolve({ exists: false });
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0);
      return Promise.resolve({ exists: true });
    } catch {
      return Promise.resolve({ exists: false });
    }
  }
  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
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
        if (error !== null || stdout.trim() === '') {
          resolve({ exists: false });
          return;
        }
        try {
          const value = JSON.parse(stdout) as Record<string, unknown>;
          resolve({
            exists: true,
            ...(typeof value.executablePath === 'string'
              ? { executablePath: value.executablePath }
              : {}),
            ...(typeof value.commandLine === 'string' ? { commandLine: value.commandLine } : {}),
          });
        } catch {
          resolve({ exists: true });
        }
      },
    );
  });
}
