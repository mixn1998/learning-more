import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createActivationRepository } from './activation-repository.js';
import { acquireHostLease } from './host-lease.js';
import { createHostManager, type HostManager } from './host-manager.js';
import { startOrAdoptLauncher, waitForLauncherReady } from './launcher-process.js';
import { createHostSupervisor } from './supervisor.js';
import { createWorkspaceActivationWorker } from './workspace-activation.js';
import type { HostTaskDefinition } from './task-scheduler.js';
import { createWindowsTaskScheduler } from './windows-task-scheduler.js';
import { observeWindowsProcess } from './windows-process-observer.js';

export async function executeHostCommand(
  arguments_: readonly string[],
  dependencies: Readonly<{
    manager: Pick<HostManager, 'install' | 'status' | 'repair' | 'uninstall'>;
    runHost(): Promise<void>;
    output(value: string): void;
  }>,
): Promise<void> {
  const command = arguments_[0];
  if (command === 'run') {
    await dependencies.runHost();
    return;
  }
  if (command === 'install') {
    dependencies.output(JSON.stringify(await dependencies.manager.install()));
    return;
  }
  if (command === 'status') {
    dependencies.output(JSON.stringify(await dependencies.manager.status()));
    return;
  }
  if (command === 'repair') {
    dependencies.output(JSON.stringify(await dependencies.manager.repair()));
    return;
  }
  if (command === 'uninstall') {
    await dependencies.manager.uninstall();
    dependencies.output(JSON.stringify({ state: 'uninstalled' }));
    return;
  }
  throw new Error('host_command_invalid');
}

function option(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  const value = index < 0 ? undefined : arguments_[index + 1];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function layout(
  projectRoot: string,
  isPortable: boolean,
): Readonly<{
  launcherEntry: string;
  serverEntry: string;
  webRoot: string;
}> {
  const workspace = {
    launcherEntry: path.join(projectRoot, 'apps', 'launcher', 'dist', 'main.js'),
    serverEntry: path.join(projectRoot, 'apps', 'server', 'dist', 'bootstrap', 'main.js'),
    webRoot: path.join(projectRoot, 'apps', 'web', 'dist'),
  };
  const portableLayout = {
    launcherEntry: path.join(projectRoot, 'app', 'launcher', 'dist', 'main.js'),
    serverEntry: path.join(projectRoot, 'app', 'server', 'main.js'),
    webRoot: path.join(projectRoot, 'app', 'web'),
  };
  return isPortable ? portableLayout : workspace;
}

function manifestBuildId(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('release_manifest_build_id_invalid');
  }
  const buildId = (value as Record<string, unknown>).buildId;
  if (typeof buildId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(buildId)) {
    throw new Error('release_manifest_build_id_invalid');
  }
  return buildId;
}

async function optionalManifestBuildId(filePath: string): Promise<string | undefined> {
  try {
    return manifestBuildId(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function readReleaseIdentity(
  projectRoot: string,
): Promise<Readonly<{ portable: boolean; buildId: string }>> {
  const portableBuildId = await optionalManifestBuildId(
    path.join(projectRoot, 'release-manifest.json'),
  );
  if (portableBuildId !== undefined) return { portable: true, buildId: portableBuildId };
  const workspaceBuildId = await optionalManifestBuildId(
    path.join(projectRoot, '.learning-more-build.json'),
  );
  return {
    portable: false,
    buildId: workspaceBuildId ?? process.env.LEARNING_MORE_BUILD_ID ?? 'development',
  };
}

function currentUserId(): string {
  const username = process.env.USERNAME;
  if (username === undefined || username === '') throw new Error('host_current_user_missing');
  return username;
}

function hostRunnerArguments(input: {
  node: string;
  entry: string;
  projectRoot: string;
}): readonly string[] {
  const configuration = Buffer.from(JSON.stringify(input), 'utf8').toString('base64');
  const script = [
    "$ErrorActionPreference = 'Continue'",
    `$configJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${configuration}'))`,
    '$config = $configJson | ConvertFrom-Json',
    'while ($true) {',
    "  & $config.node $config.entry 'run' '--project-root' $config.projectRoot",
    '  Start-Sleep -Seconds 2',
    '}',
  ].join('\r\n');
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

export function desiredHostTask(input: {
  entryPath: string;
  projectRoot: string;
  userId?: string;
}): HostTaskDefinition {
  const projectRoot = path.resolve(input.projectRoot);
  return {
    name: 'Learning MORE',
    executable: path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    arguments: hostRunnerArguments({
      node: path.resolve(process.execPath),
      entry: path.resolve(input.entryPath),
      projectRoot,
    }),
    userId: input.userId ?? currentUserId(),
    trigger: 'logon',
    startWhenAvailable: true,
    allowStartOnBatteries: true,
    stopIfGoingOnBatteries: false,
    multipleInstances: 'ignore-new',
    restartIntervalMinutes: 1,
    restartCount: 999,
    executionTimeLimit: 'PT0S',
  };
}

export async function runHost(projectRoot: string): Promise<void> {
  const resolvedRoot = path.resolve(projectRoot);
  const identity = await readReleaseIdentity(resolvedRoot);
  const application = layout(resolvedRoot, identity.portable);
  await Promise.all([
    access(application.launcherEntry),
    access(application.serverEntry),
    access(application.webRoot),
  ]);
  const localApplicationData =
    process.env.LOCALAPPDATA ??
    path.join(process.env.USERPROFILE ?? resolvedRoot, 'AppData', 'Local');
  const hostRoot = path.join(localApplicationData, 'Learning MORE', 'host');
  const runtimeDirectory = identity.portable
    ? path.join(localApplicationData, 'Learning MORE', 'runtime')
    : path.join(resolvedRoot, '.learning-more-runtime');
  const dataRoot = identity.portable
    ? path.join(localApplicationData, 'Learning MORE', 'data')
    : path.join(resolvedRoot, '.learning-more-data');
  const secretDirectory = path.join(localApplicationData, 'Learning MORE', 'secrets');
  const releasesRoot = path.join(hostRoot, 'releases');
  const activationRequestPath = path.join(hostRoot, 'workspace-activation-request.json');
  const activationStatusPath = path.join(hostRoot, 'workspace-activation-status.json');
  await mkdir(path.join(releasesRoot, 'workspace'), { recursive: true });

  const lease = await acquireHostLease({
    filePath: path.join(hostRoot, 'host.lock'),
    executablePath: process.execPath,
    releaseRoot: resolvedRoot,
    observeProcess: observeWindowsProcess,
  });
  const activation = createActivationRepository({
    statePath: path.join(hostRoot, 'host-state.json'),
    releasesRoot,
    initialActiveBuildId: 'workspace',
  });
  const recoveredActivation = await activation.recover();
  const activeReleaseRoot =
    recoveredActivation.activeBuildId === 'workspace'
      ? resolvedRoot
      : activation.releaseRoot(recoveredActivation.activeBuildId);
  const supervisor = createHostSupervisor({
    activation,
    startLauncher: async (releaseRoot) => {
      const selected = releaseRoot === resolvedRoot ? application : layout(releaseRoot, true);
      const selectedIdentity =
        releaseRoot === resolvedRoot ? identity : await readReleaseIdentity(releaseRoot);
      return startOrAdoptLauncher({
        projectRoot: releaseRoot,
        runtimeDirectory,
        dataRoot,
        secretDirectory,
        launcherEntry: selected.launcherEntry,
        serverEntry: selected.serverEntry,
        webRoot: selected.webRoot,
        buildId: selectedIdentity.buildId,
        ...(identity.portable ? {} : { activationRequestPath, activationStatusPath }),
        acceptedCommandMarkers:
          releaseRoot === resolvedRoot && !identity.portable
            ? [selected.launcherEntry, path.join('tools', 'start-learning-more.mjs')]
            : [selected.launcherEntry],
        observeProcess: observeWindowsProcess,
      });
    },
    verifyCandidate: async (releaseRoot) => {
      const selected = layout(releaseRoot, true);
      await Promise.all([
        access(selected.launcherEntry),
        access(selected.serverEntry),
        access(selected.webRoot),
      ]);
    },
    verifyReady: async (releaseRoot) =>
      waitForLauncherReady((await readReleaseIdentity(releaseRoot)).buildId),
    wait: async (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    now: Date.now,
  });
  const stop = () => void supervisor.stop();
  const workspaceActivation = identity.portable
    ? undefined
    : createWorkspaceActivationWorker({
        projectRoot: resolvedRoot,
        releasesRoot,
        requestPath: activationRequestPath,
        statusPath: activationStatusPath,
        supervisor,
      });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    workspaceActivation?.start();
    await supervisor.run(activeReleaseRoot);
    if (supervisor.status().state === 'blocked_restart_storm') {
      throw new Error('host_launcher_restart_storm');
    }
  } finally {
    workspaceActivation?.stop();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await supervisor.stop();
    await lease.release();
  }
}

async function main(arguments_: readonly string[]): Promise<void> {
  const projectRoot = path.resolve(option(arguments_, '--project-root') ?? process.cwd());
  const entryPath = fileURLToPath(import.meta.url);
  const manager = createHostManager({
    scheduler: createWindowsTaskScheduler(),
    desired: desiredHostTask({ entryPath, projectRoot }),
  });
  await executeHostCommand(arguments_, {
    manager,
    runHost: () => runHost(projectRoot),
    output: (value) => process.stdout.write(`${value}\n`),
  });
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof Error && error.message === 'host_already_running') {
      process.stdout.write(`${JSON.stringify({ state: 'already-running' })}\n`);
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
