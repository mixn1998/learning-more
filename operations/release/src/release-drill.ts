import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type DrillStep = Readonly<{
  name: string;
  command: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  outputTail: string;
}>;

type PortableResult = Readonly<{
  expandedRoot: string;
  zipPath: string;
  zipSha256: string;
  buildId: string;
}>;

export type ReleaseDrillReport = Readonly<{
  schemaVersion: 1;
  status: 'release-ready' | 'failed';
  createdAt: string;
  environment: {
    platform: string;
    architecture: string;
    nodeVersion: string;
    pnpmVersion: string;
    timezone: string;
    unicodeSmokePath: string;
  };
  artifacts?: {
    buildId: string;
    zipPath: string;
    zipSha256: string;
    reproducibleZip: boolean;
    sbomSha256: string;
  };
  gates: {
    quality: string;
    functionality: string;
    capacity: string;
    backupRestore: string;
    corruptionRecovery: string;
    runtimeIdentityAndPorts: string;
    unicodeOfflineStartup: string;
    supplyChain: string;
    equivalence: string;
  };
  steps: readonly DrillStep[];
}>;

function pnpmCli(projectRoot: string): string {
  if (process.env.npm_execpath !== undefined) return process.env.npm_execpath;
  return path.join(projectRoot, '.corepack', 'v1', 'pnpm', '10.34.3', 'bin', 'pnpm.cjs');
}

function tail(value: string, length = 4_000): string {
  const safe = value
    .replaceAll(/(?:api[_-]?key|secret|token)\s*[=:]\s*[^\s]+/gi, '$1=[redacted]')
    .trim();
  return safe.slice(Math.max(0, safe.length - length));
}

function runPnpm(projectRoot: string, name: string, arguments_: readonly string[]): DrillStep {
  const startedAt = Date.now();
  try {
    const output = execFileSync(process.execPath, [pnpmCli(projectRoot), ...arguments_], {
      cwd: projectRoot,
      env: { ...process.env, LEARNING_MORE_NO_OPEN: '1', NO_COLOR: '1' },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 ** 2,
      windowsHide: true,
    });
    return {
      name,
      command: `pnpm ${arguments_.join(' ')}`,
      status: 'passed',
      durationMs: Date.now() - startedAt,
      outputTail: tail(output),
    };
  } catch (error) {
    const failure = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const output = [failure.stdout?.toString(), failure.stderr?.toString(), failure.message]
      .filter((value): value is string => value !== undefined)
      .join('\n');
    return {
      name,
      command: `pnpm ${arguments_.join(' ')}`,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      outputTail: tail(output),
    };
  }
}

function portableResult(step: DrillStep): PortableResult | undefined {
  for (const line of step.outputTail.split(/\r?\n/u).reverse()) {
    try {
      const value = JSON.parse(line) as Partial<PortableResult>;
      if (
        typeof value.expandedRoot === 'string' &&
        typeof value.zipPath === 'string' &&
        typeof value.zipSha256 === 'string' &&
        typeof value.buildId === 'string'
      ) {
        return value as PortableResult;
      }
    } catch {
      // Non-JSON command output is expected before the final build result.
    }
  }
  return undefined;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

function gate(steps: readonly DrillStep[], ...names: string[]): 'passed' | 'failed' {
  return names.every((name) => steps.find((step) => step.name === name)?.status === 'passed')
    ? 'passed'
    : 'failed';
}

export function releaseReady(input: {
  steps: readonly DrillStep[];
  firstPortable?: PortableResult | undefined;
  secondPortable?: PortableResult | undefined;
}): boolean {
  return (
    input.steps.every((step) => step.status === 'passed') &&
    input.firstPortable !== undefined &&
    input.secondPortable !== undefined &&
    input.firstPortable.zipSha256 === input.secondPortable.zipSha256
  );
}

export async function executeReleaseDrill(
  projectRoot = path.resolve('.'),
): Promise<ReleaseDrillReport> {
  const steps: DrillStep[] = [];
  const run = (name: string, arguments_: readonly string[]) => {
    const step = runPnpm(projectRoot, name, arguments_);
    steps.push(step);
    return step;
  };

  run('quality', ['verify:full']);
  run('recovery', ['test:recovery']);
  run('capacity', ['test:capacity']);
  run('runtime-e2e', ['playwright:runtime']);
  run('function-e2e', ['playwright:test']);
  run('equivalence', ['equivalence:check']);
  run('supply-chain', ['supply-chain:check']);
  const firstBuild = run('portable-build-1', ['release:portable']);
  const firstPortable = portableResult(firstBuild);
  const secondBuild = run('portable-build-2', ['release:portable']);
  const secondPortable = portableResult(secondBuild);

  const unicodeRoot = path.join(
    projectRoot,
    '.local',
    'generated',
    'release',
    '全新 Windows 用户 空格路径',
  );
  if (secondPortable !== undefined && secondBuild.status === 'passed') {
    const copiedPortable = path.join(unicodeRoot, 'Learning MORE');
    await rm(unicodeRoot, { recursive: true, force: true });
    await mkdir(unicodeRoot, { recursive: true });
    await cp(secondPortable.expandedRoot, copiedPortable, { recursive: true });
    run('unicode-offline-smoke', [
      '--filter',
      '@learning-more/release',
      'smoke',
      copiedPortable,
      path.join(unicodeRoot, '本地 状态'),
    ]);
  } else {
    steps.push({
      name: 'unicode-offline-smoke',
      command: 'pnpm --filter @learning-more/release smoke',
      status: 'skipped',
      durationMs: 0,
      outputTail: 'portable build unavailable',
    });
  }

  const ready = releaseReady({ steps, firstPortable, secondPortable });
  const artifacts =
    secondPortable === undefined
      ? undefined
      : {
          buildId: secondPortable.buildId,
          zipPath: secondPortable.zipPath,
          zipSha256: secondPortable.zipSha256,
          reproducibleZip: firstPortable?.zipSha256 === secondPortable.zipSha256,
          sbomSha256: await sha256(path.join(secondPortable.expandedRoot, 'sbom.cdx.json')),
        };
  const report: ReleaseDrillReport = {
    schemaVersion: 1,
    status: ready ? 'release-ready' : 'failed',
    createdAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      pnpmVersion: '10.34.3',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unicodeSmokePath: unicodeRoot,
    },
    ...(artifacts === undefined ? {} : { artifacts }),
    gates: {
      quality: gate(steps, 'quality'),
      functionality: gate(steps, 'function-e2e'),
      capacity: gate(steps, 'capacity'),
      backupRestore: gate(steps, 'recovery'),
      corruptionRecovery: gate(steps, 'recovery'),
      runtimeIdentityAndPorts: gate(steps, 'runtime-e2e'),
      unicodeOfflineStartup: gate(steps, 'unicode-offline-smoke'),
      supplyChain: gate(steps, 'supply-chain'),
      equivalence: gate(steps, 'equivalence'),
    },
    steps,
  };
  const artifactDirectory = path.join(projectRoot, '.local', 'artifacts', 'release');
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    path.join(artifactDirectory, 'release-drill.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  if (!ready) throw new Error('release_drill_failed');
  return report;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const report = await executeReleaseDrill();
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
