import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const LINT_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const FORMAT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const TEST_FILE = /\.(?:contract\.)?test\.(?:[cm]?js|tsx?)$/u;
const SPECIAL_TEST_PATH = /^(?:engineering\/tests\/(?:performance|recovery))\//u;
const WORKSPACE_BASES = ['apps', 'packages', 'operations', 'engineering'];

function slash(value) {
  return value.replaceAll('\\', '/');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function repositoryPath(repositoryRoot, inputPath) {
  const resolved = path.resolve(repositoryRoot, inputPath);
  const relative = path.relative(repositoryRoot, resolved);
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error('verification_path_outside_repository');
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`verification_path_not_found:${slash(relative)}`);
  }
  return slash(relative);
}

function normalizeRepositoryPaths(repositoryRoot, inputPaths) {
  return uniqueSorted(
    inputPaths
      .filter((inputPath) => inputPath !== '--' && inputPath.trim() !== '')
      .map((inputPath) => repositoryPath(repositoryRoot, inputPath)),
  );
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readWorkspacePackages(repositoryRoot) {
  const workspaces = [];
  for (const base of WORKSPACE_BASES) {
    const basePath = path.join(repositoryRoot, base);
    if (!existsSync(basePath)) continue;
    for (const entry of readdirSync(basePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = slash(path.join(base, entry.name));
      const manifestPath = path.join(repositoryRoot, directory, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = readJson(manifestPath);
      if (typeof manifest.name !== 'string' || manifest.name.trim() === '') continue;
      const dependencyNames = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      workspaces.push({
        name: manifest.name,
        directory,
        dependencyNames,
        hasTypecheck: typeof manifest.scripts?.typecheck === 'string',
      });
    }
  }
  return workspaces;
}

function owningWorkspace(workspaces, file) {
  return workspaces
    .filter(
      (workspace) => file === workspace.directory || file.startsWith(`${workspace.directory}/`),
    )
    .sort((left, right) => right.directory.length - left.directory.length)[0];
}

function reverseDependencyClosure(workspaces, initialNames) {
  const selected = new Set(initialNames);
  let changed = true;
  while (changed) {
    changed = false;
    for (const workspace of workspaces) {
      if (selected.has(workspace.name)) continue;
      if ([...workspace.dependencyNames].some((dependency) => selected.has(dependency))) {
        selected.add(workspace.name);
        changed = true;
      }
    }
  }
  return workspaces
    .filter((workspace) => selected.has(workspace.name) && workspace.hasTypecheck)
    .map((workspace) => workspace.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function fullVerificationReason(files) {
  if (
    files.some(
      (file) =>
        file === 'engineering/verification/verify-change.mjs' ||
        file === 'engineering/verification/verify-change.test.mjs' ||
        file === 'engineering/verification/test-suite-policy.test.mjs',
    )
  ) {
    return 'verification_framework_changed';
  }
  if (
    files.some((file) =>
      [
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'tsconfig.base.json',
        'vitest.config.ts',
        'eslint.config.mjs',
      ].includes(file),
    )
  ) {
    return 'root_configuration_changed';
  }
  if (
    files.some(
      (file) =>
        /^(?:apps|packages|operations|engineering)\/[^/]+\/(?:package\.json|tsconfig(?:\.[^/]+)?\.json)$/u.test(
          file,
        ) || file.startsWith('.github/workflows/'),
    )
  ) {
    return 'workspace_or_ci_configuration_changed';
  }
  return undefined;
}

function conditionalGates(files) {
  const gates = [];
  if (
    files.some(
      (file) =>
        file.startsWith('packages/contracts/src/') ||
        file.startsWith('packages/contracts/openapi/') ||
        file.startsWith('packages/contracts/scripts/'),
    )
  ) {
    gates.push('schema');
  }
  if (
    files.some(
      (file) =>
        file.startsWith('packages/contracts/src/') ||
        file.startsWith('apps/server/src/modules/') ||
        file.startsWith('apps/server/src/bootstrap/') ||
        file.startsWith('engineering/architecture/'),
    )
  ) {
    gates.push('architecture');
  }
  if (
    files.some(
      (file) =>
        file.includes('equivalence') ||
        file.startsWith('docs/equivalence/') ||
        file === '.local/artifacts/tests/unit.json',
    )
  ) {
    gates.push('equivalence');
  }
  return uniqueSorted(gates);
}

export function planAffectedVerification(repositoryRoot, inputPaths) {
  const files = normalizeRepositoryPaths(repositoryRoot, inputPaths);
  const workspaces = readWorkspacePackages(repositoryRoot);
  const typecheckOwners = new Set(
    files
      .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
      .map((file) => owningWorkspace(workspaces, file)?.name)
      .filter((name) => name !== undefined),
  );
  const directTestFiles = files.filter((file) => TEST_FILE.test(file));
  return {
    files,
    formatFiles: files.filter((file) => FORMAT_EXTENSIONS.has(path.extname(file))),
    lintFiles: files.filter((file) => LINT_EXTENSIONS.has(path.extname(file))),
    directTestFiles,
    relatedTestSources: files.filter(
      (file) => SOURCE_EXTENSIONS.has(path.extname(file)) && !TEST_FILE.test(file),
    ),
    typecheckPackages: reverseDependencyClosure(workspaces, typecheckOwners),
    gates: conditionalGates(files),
    fullReason: fullVerificationReason(files),
  };
}

function gitExecutable() {
  if (process.platform !== 'win32') return 'git';
  const installed = 'C:\\Program Files\\Git\\cmd\\git.exe';
  return existsSync(installed) ? installed : 'git.exe';
}

function capture(command, arguments_, repositoryRoot) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `verification_discovery_failed:${String(result.stderr ?? result.stdout ?? '').trim()}`,
    );
  }
  return String(result.stdout ?? '');
}

export function discoverChangedFiles(repositoryRoot) {
  const git = gitExecutable();
  const outputs = [
    capture(git, ['diff', '--name-only', '--diff-filter=ACMR'], repositoryRoot),
    capture(git, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], repositoryRoot),
    capture(git, ['ls-files', '--others', '--exclude-standard'], repositoryRoot),
  ];
  return uniqueSorted(
    outputs
      .flatMap((output) => output.split(/\r?\n/u))
      .map((file) => file.trim())
      .filter(Boolean),
  );
}

function toolEntry(repositoryRoot, tool) {
  const relative =
    tool === 'prettier'
      ? ['node_modules', 'prettier', 'bin', 'prettier.cjs']
      : tool === 'eslint'
        ? ['node_modules', 'eslint', 'bin', 'eslint.js']
        : ['node_modules', 'vitest', 'vitest.mjs'];
  const entry = path.join(repositoryRoot, ...relative);
  if (!existsSync(entry)) throw new Error(`verification_tool_missing:${tool}`);
  return entry;
}

function run(command, arguments_, repositoryRoot) {
  console.log(`[verify] $ ${path.basename(command)} ${arguments_.join(' ')}`);
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runNodeTool(repositoryRoot, tool, arguments_) {
  run(process.execPath, [toolEntry(repositoryRoot, tool), ...arguments_], repositoryRoot);
}

function runPnpm(repositoryRoot, arguments_) {
  const pnpmEntry = process.env.npm_execpath;
  if (pnpmEntry === undefined || pnpmEntry.trim() === '') {
    throw new Error('verification_requires_pnpm_invocation');
  }
  run(process.execPath, [pnpmEntry, ...arguments_], repositoryRoot);
}

function printPlan(plan) {
  console.log(`[verify] files (${plan.files.length}): ${plan.files.join(', ') || 'none'}`);
  if (plan.fullReason !== undefined) {
    console.log(`[verify] scope: full (${plan.fullReason})`);
    return;
  }
  const checks = [
    plan.formatFiles.length > 0 ? `format:${plan.formatFiles.length}` : undefined,
    plan.lintFiles.length > 0 ? `lint:${plan.lintFiles.length}` : undefined,
    plan.directTestFiles.length + plan.relatedTestSources.length > 0
      ? `tests:${plan.directTestFiles.length + plan.relatedTestSources.length}`
      : undefined,
    plan.typecheckPackages.length > 0 ? `typecheck:${plan.typecheckPackages.join(',')}` : undefined,
    ...plan.gates,
  ].filter((check) => check !== undefined);
  console.log(`[verify] scope: affected (${checks.join(' | ') || 'no executable checks'})`);
}

function runAffectedChecks(repositoryRoot, plan) {
  if (plan.formatFiles.length > 0) {
    runNodeTool(repositoryRoot, 'prettier', ['--check', ...plan.formatFiles]);
  }
  if (plan.lintFiles.length > 0) {
    runNodeTool(repositoryRoot, 'eslint', plan.lintFiles);
  }

  const specialTests = plan.directTestFiles.filter((file) => SPECIAL_TEST_PATH.test(file));
  const regularTestInputs = [
    ...plan.directTestFiles.filter((file) => !SPECIAL_TEST_PATH.test(file)),
    ...plan.relatedTestSources,
  ];
  if (regularTestInputs.length > 0) {
    runNodeTool(repositoryRoot, 'vitest', [
      'related',
      ...regularTestInputs,
      '--run',
      '--passWithNoTests',
      '--maxWorkers=2',
      '--exclude',
      'engineering/tests/performance/**',
      '--exclude',
      'engineering/tests/recovery/**',
    ]);
  }
  if (specialTests.length > 0) {
    runNodeTool(repositoryRoot, 'vitest', ['run', ...specialTests, '--maxWorkers=2']);
  }
  if (plan.typecheckPackages.length > 0) {
    const filters = plan.typecheckPackages.flatMap((packageName) => ['--filter', packageName]);
    runPnpm(repositoryRoot, [...filters, 'typecheck']);
  }
  for (const gate of plan.gates) {
    runPnpm(repositoryRoot, [`${gate}:check`]);
  }
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const explicitPaths = process.argv.slice(2).filter((argument) => argument !== '--');
  const files = explicitPaths.length > 0 ? explicitPaths : discoverChangedFiles(repositoryRoot);
  const plan = planAffectedVerification(repositoryRoot, files);
  printPlan(plan);
  if (plan.files.length === 0) return;
  if (plan.fullReason !== undefined) {
    runPnpm(repositoryRoot, ['verify:full']);
    return;
  }
  runAffectedChecks(repositoryRoot, plan);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
