import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type SourceIdentity = Readonly<{
  sourceRevision: string;
  sourceFingerprint: string;
  buildId: string;
  files: readonly string[];
}>;

const PRODUCT_ROOT_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
]);
const PRODUCT_SOURCE_ROOTS = new Set([
  'apps',
  'packages',
  'operations',
  'migrations',
  'prompts',
  'release',
  'schemas',
]);
const NON_RUNTIME_SEGMENTS = new Set([
  '.work',
  'coverage',
  'dist',
  'fixtures',
  'node_modules',
  'test',
  'tests',
  '__tests__',
]);

function gitOutput(projectRoot: string, arguments_: readonly string[]): string {
  return execFileSync('git', [...arguments_], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function normalizedWorkspacePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((entry) => entry.replaceAll('\\', '/')))].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
}

export function isProductSourcePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (PRODUCT_ROOT_FILES.has(normalized)) return true;
  const segments = normalized.split('/').filter(Boolean);
  const sourceRoot = segments[0];
  if (sourceRoot === undefined || segments.length < 2 || !PRODUCT_SOURCE_ROOTS.has(sourceRoot)) {
    return false;
  }
  if (segments.some((segment) => NON_RUNTIME_SEGMENTS.has(segment.toLowerCase()))) return false;
  const basename = segments.at(-1)?.toLowerCase() ?? '';
  return !/\.(?:test|spec)\.[^/]+$/u.test(basename);
}

export async function computeSourceFingerprint(
  projectRoot: string,
  workspacePaths: readonly string[],
): Promise<string> {
  const hash = createHash('sha256');
  for (const relativePath of normalizedWorkspacePaths(workspacePaths)) {
    const pathBytes = Buffer.from(relativePath, 'utf8');
    hash.update(`path:${pathBytes.length}:`, 'utf8');
    hash.update(pathBytes);
    try {
      const contents = await readFile(path.join(projectRoot, ...relativePath.split('/')));
      hash.update(`:file:${contents.length}:`, 'utf8');
      hash.update(contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update(':deleted:', 'utf8');
    }
    hash.update('\0', 'utf8');
  }
  return hash.digest('hex');
}

export function formatBuildId(shortRevision: string, sourceFingerprint: string): string {
  if (!/^[a-f0-9]{12}$/u.test(shortRevision) || !/^[a-f0-9]{64}$/u.test(sourceFingerprint)) {
    throw new Error('source_identity_invalid');
  }
  return `${shortRevision}-w${sourceFingerprint.slice(0, 12)}`;
}

export function assertWorkspaceUnchanged(before: string, after: string): void {
  if (before !== after) throw new Error('workspace_changed_during_build');
}

export async function readSourceIdentity(projectRoot: string): Promise<SourceIdentity> {
  const sourceRevision = gitOutput(projectRoot, ['rev-parse', 'HEAD']).trim();
  const shortRevision = gitOutput(projectRoot, ['rev-parse', '--short=12', 'HEAD']).trim();
  const files = normalizedWorkspacePaths(
    gitOutput(projectRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter((entry) => entry !== '' && isProductSourcePath(entry)),
  );
  const sourceFingerprint = await computeSourceFingerprint(projectRoot, files);
  return {
    sourceRevision,
    sourceFingerprint,
    buildId: formatBuildId(shortRevision, sourceFingerprint),
    files,
  };
}

export async function writeWorkspaceBuildManifest(
  projectRoot: string,
  identity: SourceIdentity,
  buildId = identity.buildId,
): Promise<void> {
  const target = path.join(projectRoot, '.learning-more-build.json');
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      `${JSON.stringify({
        schemaVersion: 1,
        buildId,
        sourceRevision: identity.sourceRevision,
        sourceFingerprint: identity.sourceFingerprint,
      })}\n`,
      'utf8',
    );
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
