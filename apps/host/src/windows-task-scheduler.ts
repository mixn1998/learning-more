import { execFile } from 'node:child_process';
import path from 'node:path';

import type { HostTaskDefinition, TaskSchedulerPort } from './task-scheduler.js';

type RunResult = Readonly<{ exitCode: number; stdout: string; stderr: string }>;
type RunPowerShell = (executable: string, arguments_: readonly string[]) => Promise<RunResult>;

function defaultRun(executable: string, arguments_: readonly string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      executable,
      [...arguments_],
      { encoding: 'utf8', shell: false, windowsHide: true },
      (error, stdout, stderr) =>
        resolve({
          exitCode: typeof error?.code === 'number' ? error.code : error === null ? 0 : 1,
          stdout,
          stderr,
        }),
    );
  });
}

function encodedArguments(script: string): readonly string[] {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

function quoteWindowsArgument(argument: string): string {
  if (argument === '') return '""';
  if (!/[\s"]/u.test(argument)) return argument;
  let output = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      output += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    output += '\\'.repeat(backslashes) + character;
    backslashes = 0;
  }
  return `${output}${'\\'.repeat(backslashes * 2)}"`;
}

function joinWindowsArguments(arguments_: readonly string[]): string {
  return arguments_.map(quoteWindowsArgument).join(' ');
}

function parseWindowsArguments(commandLine: string): string[] {
  const output: string[] = [];
  let index = 0;
  while (index < commandLine.length) {
    while (/\s/u.test(commandLine[index] ?? '')) index += 1;
    if (index >= commandLine.length) break;
    let value = '';
    let quoted = false;
    while (index < commandLine.length) {
      let backslashes = 0;
      while (commandLine[index] === '\\') {
        backslashes += 1;
        index += 1;
      }
      if (commandLine[index] === '"') {
        value += '\\'.repeat(Math.floor(backslashes / 2));
        if (backslashes % 2 === 0) quoted = !quoted;
        else value += '"';
        index += 1;
        continue;
      }
      value += '\\'.repeat(backslashes);
      const character = commandLine[index];
      if (character === undefined || (!quoted && /\s/u.test(character))) break;
      value += character;
      index += 1;
    }
    output.push(value);
    while (/\s/u.test(commandLine[index] ?? '')) index += 1;
  }
  return output;
}

function parseDefinition(stdout: string): HostTaskDefinition {
  const value = JSON.parse(stdout.trim()) as Record<string, unknown>;
  if (
    value.name !== 'Learning MORE' ||
    typeof value.executable !== 'string' ||
    typeof value.argumentString !== 'string' ||
    typeof value.userId !== 'string' ||
    value.trigger !== 'logon' ||
    typeof value.startWhenAvailable !== 'boolean' ||
    value.multipleInstances !== 'ignore-new' ||
    typeof value.restartIntervalMinutes !== 'number' ||
    typeof value.restartCount !== 'number' ||
    value.executionTimeLimit !== 'PT0S'
  ) {
    throw new Error('host_task_definition_invalid');
  }
  return {
    name: 'Learning MORE',
    executable: value.executable,
    arguments: parseWindowsArguments(value.argumentString),
    userId: value.userId,
    trigger: 'logon',
    startWhenAvailable: value.startWhenAvailable as true,
    multipleInstances: 'ignore-new',
    restartIntervalMinutes: value.restartIntervalMinutes as 1,
    restartCount: value.restartCount,
    executionTimeLimit: 'PT0S',
  };
}

async function execute(run: RunPowerShell, executable: string, script: string): Promise<RunResult> {
  return run(executable, encodedArguments(script));
}

export function createWindowsTaskScheduler(
  options: {
    run?: RunPowerShell;
    systemRoot?: string;
  } = {},
): TaskSchedulerPort {
  const run = options.run ?? defaultRun;
  const powershell = path.join(
    options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const readScript = `
$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'Learning MORE' -ErrorAction SilentlyContinue
if ($null -eq $task) { [Console]::Out.Write('__LEARNING_MORE_TASK_MISSING__'); exit 3 }
$action = @($task.Actions)[0]
$trigger = @($task.Triggers)[0]
$executionLimit = if ($task.Settings.ExecutionTimeLimit -eq [TimeSpan]::Zero) { 'PT0S' } else { $task.Settings.ExecutionTimeLimit.ToString() }
$restartInterval = [string]$task.Settings.RestartInterval
[ordered]@{
  name = $task.TaskName
  executable = $action.Execute
  argumentString = $action.Arguments
  userId = $task.Principal.UserId
  trigger = if ($trigger.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger') { 'logon' } else { 'unknown' }
  startWhenAvailable = [bool]$task.Settings.StartWhenAvailable
  multipleInstances = if ($task.Settings.MultipleInstances.ToString() -eq 'IgnoreNew') { 'ignore-new' } else { $task.Settings.MultipleInstances.ToString() }
  restartIntervalMinutes = [int]([Xml.XmlConvert]::ToTimeSpan($restartInterval).TotalMinutes)
  restartCount = [int]$task.Settings.RestartCount
  executionTimeLimit = $executionLimit
} | ConvertTo-Json -Compress
`;

  return {
    async read() {
      const result = await execute(run, powershell, readScript);
      if (result.exitCode === 3 && result.stdout.includes('__LEARNING_MORE_TASK_MISSING__')) {
        return undefined;
      }
      if (result.exitCode !== 0) {
        throw new Error(`host_task_read_failed:${result.stderr.trim()}`);
      }
      return parseDefinition(result.stdout);
    },
    async replace(definition) {
      const payload = Buffer.from(
        JSON.stringify({
          ...definition,
          argumentString: joinWindowsArguments(definition.arguments),
        }),
        'utf8',
      ).toString('base64');
      const script = `
$ErrorActionPreference = 'Stop'
$definitionJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$definition = $definitionJson | ConvertFrom-Json
$action = New-ScheduledTaskAction -Execute $definition.executable -Argument $definition.argumentString
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $definition.userId
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount $definition.restartCount -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $definition.userId -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $definition.name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
`;
      const result = await execute(run, powershell, script);
      if (result.exitCode !== 0) {
        throw new Error(`host_task_replace_failed:${result.stderr.trim()}`);
      }
    },
    async remove() {
      const result = await execute(
        run,
        powershell,
        "$task = Get-ScheduledTask -TaskName 'Learning MORE' -ErrorAction SilentlyContinue; if ($null -ne $task) { Stop-ScheduledTask -TaskName 'Learning MORE' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'Learning MORE' -Confirm:$false -ErrorAction Stop }",
      );
      if (result.exitCode !== 0) throw new Error(`host_task_remove_failed:${result.stderr.trim()}`);
    },
    async start() {
      const result = await execute(
        run,
        powershell,
        "Start-ScheduledTask -TaskName 'Learning MORE' -ErrorAction Stop",
      );
      if (result.exitCode !== 0) throw new Error(`host_task_start_failed:${result.stderr.trim()}`);
    },
  };
}
