import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkPortableLayout } from './check-layout.js';
import { writeChecksumManifest } from './checksums.js';
import { writeDeterministicZip } from './deterministic-zip.js';
import { PINNED_NODE_VERSION, resolvePinnedNodeRuntime } from './fetch-node-runtime.js';
import { createCycloneDxSbom, createThirdPartyNotices, scanInstalledPackages } from './sbom.js';
import {
  assertWorkspaceUnchanged,
  readSourceIdentity,
  writeWorkspaceBuildManifest,
} from './source-identity.js';

function pnpmCli(projectRoot: string): string {
  if (process.env.npm_execpath !== undefined) return process.env.npm_execpath;
  return path.join(projectRoot, '.corepack', 'v1', 'pnpm', '10.34.3', 'bin', 'pnpm.cjs');
}

function runPnpm(
  projectRoot: string,
  arguments_: readonly string[],
  environment = process.env,
): void {
  execFileSync(process.execPath, [pnpmCli(projectRoot), ...arguments_], {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
  });
}

function excludedRuntimePath(sourceRoot: string, source: string): boolean {
  const relative = path.relative(sourceRoot, source).replaceAll('\\', '/');
  if (relative === '') return false;
  const segments = relative.split('/').map((segment) => segment.toLowerCase());
  const basename = segments.at(-1) ?? '';
  if (segments.some((segment) => ['test', 'tests', '__tests__', 'fixtures'].includes(segment)))
    return true;
  if (basename.endsWith('.map') || basename.endsWith('.d.ts') || basename.endsWith('.tsbuildinfo'))
    return true;
  if (/\.(?:test|spec|contract\.test)\./.test(basename)) return true;
  return false;
}

async function copyRuntimeTree(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: (candidate) => !excludedRuntimePath(source, candidate),
  });
}

function packageNodeModules(packageDirectory: string, packageName: string): string {
  return packageName.startsWith('@')
    ? path.dirname(path.dirname(packageDirectory))
    : path.dirname(packageDirectory);
}

async function resolvePackageDependency(
  packageDirectory: string,
  packageName: string,
  dependencyName: string,
): Promise<string | undefined> {
  const candidates = [
    path.join(packageDirectory, 'node_modules', ...dependencyName.split('/')),
    path.join(packageNodeModules(packageDirectory, packageName), ...dependencyName.split('/')),
  ];
  for (const candidate of candidates) {
    try {
      return await realpath(candidate);
    } catch {
      // Optional packages may not be installed on this platform.
    }
  }
  return undefined;
}

async function copyProductionPackage(
  source: string,
  destination: string,
  ancestors: ReadonlySet<string>,
): Promise<void> {
  const resolved = await realpath(source);
  const manifest = JSON.parse(await readFile(path.join(resolved, 'package.json'), 'utf8')) as {
    name: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  await cp(resolved, destination, {
    recursive: true,
    dereference: true,
    filter: (candidate) => {
      const relative = path.relative(resolved, candidate).replaceAll('\\', '/');
      if (relative === 'node_modules' || relative.startsWith('node_modules/')) return false;
      return !excludedRuntimePath(resolved, candidate);
    },
  });
  const nextAncestors = new Set(ancestors).add(resolved);
  const dependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  for (const dependencyName of Object.keys(dependencies).sort()) {
    const dependency = await resolvePackageDependency(resolved, manifest.name, dependencyName);
    if (dependency === undefined || nextAncestors.has(dependency)) continue;
    await copyProductionPackage(
      dependency,
      path.join(destination, 'node_modules', ...dependencyName.split('/')),
      nextAncestors,
    );
  }
}

async function copyProductionDependencies(projectRoot: string, serverRoot: string): Promise<void> {
  const sourceRoot = path.join(projectRoot, 'apps', 'server');
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  for (const dependencyName of Object.keys(manifest.dependencies ?? {}).sort()) {
    const source = await realpath(
      path.join(sourceRoot, 'node_modules', ...dependencyName.split('/')),
    );
    await copyProductionPackage(
      source,
      path.join(serverRoot, 'node_modules', ...dependencyName.split('/')),
      new Set(),
    );
  }
}

async function allFiles(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await allFiles(root, absolute)));
    else output.push(path.relative(root, absolute).replaceAll('\\', '/'));
  }
  return output.sort();
}

function startCommand(buildId: string): string {
  return [
    '@echo off',
    'setlocal',
    'set "ROOT=%~dp0"',
    'set "LEARNING_MORE_PROJECT_ROOT=%ROOT%"',
    'set "LEARNING_MORE_DATA_ROOT=%LOCALAPPDATA%\\Learning MORE\\data"',
    'set "LEARNING_MORE_RUNTIME_DIR=%LOCALAPPDATA%\\Learning MORE\\runtime"',
    'set "LEARNING_MORE_LOG_DIR=%LOCALAPPDATA%\\Learning MORE\\logs"',
    'set "LEARNING_MORE_SECRET_DIR=%LOCALAPPDATA%\\Learning MORE\\secrets"',
    'set "LEARNING_MORE_SERVER_ENTRY=%ROOT%app\\server\\main.js"',
    'set "LEARNING_MORE_WEB_ROOT=%ROOT%app\\web"',
    'set "LEARNING_MORE_WEB_URL=http://127.0.0.1:43119"',
    'set "LEARNING_MORE_ALLOWED_ORIGIN=http://127.0.0.1:43119"',
    `set "LEARNING_MORE_BUILD_ID=${buildId}"`,
    '"%ROOT%runtime\\node.exe" "%ROOT%app\\host\\dist\\main.js" run --project-root "%ROOT%"',
    'set "EXIT_CODE=%ERRORLEVEL%"',
    'endlocal & exit /b %EXIT_CODE%',
    '',
  ].join('\r\n');
}

function hostManagementCommand(command: 'install' | 'repair' | 'uninstall'): string {
  return [
    '@echo off',
    'setlocal',
    'set "ROOT=%~dp0"',
    `"%ROOT%runtime\\node.exe" "%ROOT%app\\host\\dist\\main.js" ${command} --project-root "%ROOT%"`,
    'set "EXIT_CODE=%ERRORLEVEL%"',
    'endlocal & exit /b %EXIT_CODE%',
    '',
  ].join('\r\n');
}

async function fileSha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

export type PortableBuildResult = Readonly<{
  expandedRoot: string;
  zipPath: string;
  zipSha256: string;
  buildId: string;
}>;

export async function buildPortableRelease(
  projectRoot = path.resolve('.'),
): Promise<PortableBuildResult> {
  const rootManifest = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  ) as {
    version: string;
    packageManager: string;
  };
  const sourceIdentity = await readSourceIdentity(projectRoot);
  const buildId = process.env.LEARNING_MORE_BUILD_ID ?? sourceIdentity.buildId;
  const outputRoot = path.join(projectRoot, 'release', 'dist');
  const workRoot = path.join(projectRoot, 'release', '.work');
  const expandedRoot = path.join(outputRoot, 'portable', 'Learning MORE');
  await rm(outputRoot, { recursive: true, force: true });
  await rm(workRoot, { recursive: true, force: true });
  await mkdir(expandedRoot, { recursive: true });

  runPnpm(projectRoot, ['--filter', '@learning-more/web', 'build'], {
    ...process.env,
    VITE_BUILD_ID: buildId,
  });
  const runtimeExecutable = await resolvePinnedNodeRuntime(projectRoot);
  await mkdir(path.join(expandedRoot, 'runtime'), { recursive: true });
  await cp(runtimeExecutable, path.join(expandedRoot, 'runtime', 'node.exe'));

  const serverRoot = path.join(expandedRoot, 'app', 'server');
  await mkdir(serverRoot, { recursive: true });
  execFileSync(
    process.execPath,
    [
      path.join(projectRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
      'apps/server/src/bootstrap/main.ts',
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--target=node24',
      '--packages=external',
      '--minify',
      '--legal-comments=none',
      `--outfile=${path.join(serverRoot, 'main.js')}`,
    ],
    { cwd: projectRoot, stdio: 'inherit' },
  );
  await writeFile(
    path.join(serverRoot, 'package.json'),
    `${JSON.stringify({ name: '@learning-more/server-portable', private: true, type: 'module' })}\n`,
    'utf8',
  );
  await copyProductionDependencies(projectRoot, serverRoot);
  await copyRuntimeTree(
    path.join(projectRoot, 'apps', 'launcher', 'dist'),
    path.join(expandedRoot, 'app', 'launcher', 'dist'),
  );
  await cp(
    path.join(projectRoot, 'apps', 'launcher', 'package.json'),
    path.join(expandedRoot, 'app', 'launcher', 'package.json'),
  );
  await copyRuntimeTree(
    path.join(projectRoot, 'apps', 'host', 'dist'),
    path.join(expandedRoot, 'app', 'host', 'dist'),
  );
  await cp(
    path.join(projectRoot, 'apps', 'host', 'package.json'),
    path.join(expandedRoot, 'app', 'host', 'package.json'),
  );
  await copyRuntimeTree(
    path.join(projectRoot, 'apps', 'web', 'dist'),
    path.join(expandedRoot, 'app', 'web'),
  );
  await copyRuntimeTree(
    path.join(projectRoot, 'tools', 'cli', 'dist'),
    path.join(expandedRoot, 'tools', 'cli', 'dist'),
  );
  await cp(
    path.join(projectRoot, 'tools', 'cli', 'package.json'),
    path.join(expandedRoot, 'tools', 'cli', 'package.json'),
  );
  await mkdir(path.join(expandedRoot, 'tools'), { recursive: true });
  await writeFile(
    path.join(expandedRoot, 'tools', 'learning-more.cmd'),
    '@echo off\r\n"%~dp0..\\runtime\\node.exe" "%~dp0cli\\dist\\main.js" %*\r\n',
    'utf8',
  );

  await copyRuntimeTree(
    path.join(projectRoot, 'packages', 'contracts', 'openapi'),
    path.join(expandedRoot, 'schemas'),
  );
  await mkdir(path.join(expandedRoot, 'prompts'), { recursive: true });
  await writeFile(
    path.join(expandedRoot, 'prompts', 'registry.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      mode: 'capability-contracts',
      templates: [
        'course-outline@v1',
        'course-review@v1',
        'planning@v1',
        'weekly-report@v1',
        'portrait@1',
      ],
    })}\n`,
    'utf8',
  );
  await mkdir(path.join(expandedRoot, 'migrations'), { recursive: true });
  await writeFile(
    path.join(expandedRoot, 'migrations', 'registry.json'),
    `${JSON.stringify({ currentStoreSchemaVersion: 1, supportedMigrationFrom: [1] })}\n`,
    'utf8',
  );
  await cp(path.join(projectRoot, 'release', 'README.txt'), path.join(expandedRoot, 'README.txt'));
  await writeFile(path.join(expandedRoot, 'START.cmd'), startCommand(buildId), 'utf8');
  await writeFile(
    path.join(expandedRoot, 'INSTALL-AUTOSTART.cmd'),
    hostManagementCommand('install'),
    'utf8',
  );
  await writeFile(
    path.join(expandedRoot, 'REPAIR-AUTOSTART.cmd'),
    hostManagementCommand('repair'),
    'utf8',
  );
  await writeFile(
    path.join(expandedRoot, 'UNINSTALL-AUTOSTART.cmd'),
    hostManagementCommand('uninstall'),
    'utf8',
  );

  const components = await scanInstalledPackages(path.join(serverRoot, 'node_modules'));
  await writeFile(
    path.join(expandedRoot, 'sbom.cdx.json'),
    `${JSON.stringify(
      createCycloneDxSbom({ applicationVersion: rootManifest.version, components }),
    )}\n`,
    'utf8',
  );
  await writeFile(
    path.join(expandedRoot, 'THIRD-PARTY-NOTICES.txt'),
    createThirdPartyNotices(components),
    'utf8',
  );
  const manifestFiles = await allFiles(expandedRoot);
  await writeFile(
    path.join(expandedRoot, 'release-manifest.json'),
    `${JSON.stringify({
      version: rootManifest.version,
      buildId,
      sourceRevision: sourceIdentity.sourceRevision,
      sourceFingerprint: sourceIdentity.sourceFingerprint,
      platform: 'win32-x64',
      protocolVersion: 1,
      storeSchemaVersion: 1,
      nodeVersion: PINNED_NODE_VERSION,
      pnpmVersion: rootManifest.packageManager.replace(/^pnpm@/, ''),
      files: manifestFiles,
    })}\n`,
    'utf8',
  );
  await writeChecksumManifest(expandedRoot);
  const layout = await checkPortableLayout(expandedRoot);
  if (!layout.valid) throw new Error(`portable_layout_invalid:${layout.issues.join(',')}`);

  const zipPath = path.join(outputRoot, `Learning-MORE-${rootManifest.version}-win-x64.zip`);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await writeDeterministicZip({
    sourceRoot: expandedRoot,
    outputPath: zipPath,
    prefix: 'Learning MORE',
  });
  const result = {
    expandedRoot,
    zipPath,
    zipSha256: await fileSha256(zipPath),
    buildId,
  };
  const finalSourceIdentity = await readSourceIdentity(projectRoot);
  try {
    assertWorkspaceUnchanged(
      sourceIdentity.sourceFingerprint,
      finalSourceIdentity.sourceFingerprint,
    );
  } catch (error) {
    await rm(outputRoot, { recursive: true, force: true });
    throw error;
  }
  await writeWorkspaceBuildManifest(projectRoot, sourceIdentity, buildId);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await rm(workRoot, { recursive: true, force: true });
  return result;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  await buildPortableRelease();
}
