import { describe, expect, it, vi } from 'vitest';

import type { HostTaskDefinition } from './task-scheduler.js';
import { createWindowsTaskScheduler } from './windows-task-scheduler.js';

const definition: HostTaskDefinition = {
  name: 'Learning MORE',
  executable: 'C:\\Program Files\\nodejs\\node.exe',
  arguments: ['C:\\Learning MORE\\host\\main.js', 'run', '--project-root', 'D:\\Growth OS'],
  userId: 'WORKSTATION\\developer',
  trigger: 'logon',
  runLevel: 'highest',
  startWhenAvailable: true,
  allowStartOnBatteries: true,
  stopIfGoingOnBatteries: false,
  stopOnIdleEnd: false,
  allowHardTerminate: false,
  multipleInstances: 'ignore-new',
  restartIntervalMinutes: 1,
  restartCount: 999,
  executionTimeLimit: 'PT0S',
};

describe('Windows Task Scheduler adapter', () => {
  it('uses encoded PowerShell with the exact logon, restart, and single-instance contract', async () => {
    const scripts: string[] = [];
    const run = vi.fn(async (_executable: string, arguments_: readonly string[]) => {
      const encoded = arguments_[arguments_.indexOf('-EncodedCommand') + 1]!;
      const script = Buffer.from(encoded, 'base64').toString('utf16le');
      scripts.push(script);
      if (script.includes('__LEARNING_MORE_TASK_MISSING__')) {
        return { exitCode: 3, stdout: '__LEARNING_MORE_TASK_MISSING__', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const scheduler = createWindowsTaskScheduler({ run, systemRoot: 'C:\\Windows' });

    await expect(scheduler.read('Learning MORE')).resolves.toBeUndefined();
    await scheduler.replace(definition);

    expect(run).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-EncodedCommand']),
    );
    const registration = scripts.find((script) => script.includes('Register-ScheduledTask'))!;
    expect(registration).toContain('New-ScheduledTaskTrigger -AtLogOn');
    expect(registration).not.toContain('New-ScheduledTaskTrigger -Once');
    expect(registration).not.toContain('RepetitionInterval');
    expect(registration).toContain('MultipleInstances IgnoreNew');
    expect(registration).toContain('AllowStartIfOnBatteries');
    expect(registration).toContain('DontStopIfGoingOnBatteries');
    expect(registration).toContain('DontStopOnIdleEnd');
    expect(registration).toContain('DisallowHardTerminate');
    expect(registration).toContain('RestartInterval (New-TimeSpan -Minutes 1)');
    expect(registration).toContain('ExecutionTimeLimit ([TimeSpan]::Zero)');
    expect(registration).toContain('RunLevel Highest');
    expect(registration).not.toContain('RunLevel Limited');
    expect(registration).toContain('Stop-ScheduledTask');
    expect(registration.indexOf('Stop-ScheduledTask')).toBeLessThan(
      registration.indexOf('Register-ScheduledTask'),
    );
    expect(registration).not.toContain(definition.executable);
    expect(registration).not.toContain(definition.userId);
  });

  it('reads battery continuity settings into the task contract', async () => {
    const run = vi.fn(async (_executable: string, arguments_: readonly string[]) => {
      const encoded = arguments_[arguments_.indexOf('-EncodedCommand') + 1]!;
      const script = Buffer.from(encoded, 'base64').toString('utf16le');
      if (!script.includes('Get-ScheduledTask')) {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          name: definition.name,
          executable: definition.executable,
          argumentString: '"C:\\Learning MORE\\host\\main.js" run --project-root "D:\\Growth OS"',
          userId: definition.userId,
          trigger: definition.trigger,
          runLevel: definition.runLevel,
          startWhenAvailable: definition.startWhenAvailable,
          allowStartOnBatteries: definition.allowStartOnBatteries,
          stopIfGoingOnBatteries: definition.stopIfGoingOnBatteries,
          stopOnIdleEnd: definition.stopOnIdleEnd,
          allowHardTerminate: definition.allowHardTerminate,
          multipleInstances: definition.multipleInstances,
          restartIntervalMinutes: definition.restartIntervalMinutes,
          restartCount: definition.restartCount,
          executionTimeLimit: definition.executionTimeLimit,
        }),
        stderr: '',
      };
    });
    const scheduler = createWindowsTaskScheduler({ run, systemRoot: 'C:\\Windows' });

    await expect(scheduler.read('Learning MORE')).resolves.toEqual(definition);
  });
});
