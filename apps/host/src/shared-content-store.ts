import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export type SharedContentCategory = 'code' | 'visual' | 'native';

export type SharedContentEntry = Readonly<{
  category: SharedContentCategory;
  relativePath: string;
  sha256: string;
  size: number;
}>;

export type SharedContentManifest = Readonly<{
  schemaVersion: 1;
  buildId: string;
  entries: readonly SharedContentEntry[];
}>;

const CATEGORY_EXTENSIONS: Readonly<Record<SharedContentCategory, ReadonlySet<string>>> = {
  code: new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.map']),
  visual: new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.avif',
    '.svg',
    '.ico',
    '.bmp',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',
  ]),
  native: new Set(['.node', '.wasm', '.dll']),
};

const CATEGORIES = ['code', 'visual', 'native'] as const;

function contentRoot(releasesRoot: string): string {
  return path.join(path.resolve(releasesRoot), '.shared-content');
}

function manifestPath(releasesRoot: string, buildId: string): string {
  return path.join(contentRoot(releasesRoot), 'manifests', `${buildId}.json`);
}

function validBuildId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(value);
}

function categoryFor(filePath: string): SharedContentCategory | undefined {
  const extension = path.extname(filePath).toLocaleLowerCase('en-US');
  return CATEGORIES.find((category) => CATEGORY_EXTENSIONS[category].has(extension));
}

async function files(root: string, directory = root): Promise<readonly string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('shared_content_symlink_forbidden');
    if (entry.isDirectory()) output.push(...(await files(root, absolute)));
    else if (entry.isFile()) output.push(absolute);
  }
  return output.sort((left, right) =>
    path.relative(root, left).localeCompare(path.relative(root, right), 'en-US'),
  );
}

async function digest(filePath: string): Promise<Readonly<{ sha256: string; size: number }>> {
  const content = await readFile(filePath);
  return {
    sha256: createHash('sha256').update(content).digest('hex'),
    size: content.byteLength,
  };
}

async function ensureSharedObject(source: string, target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await access(target);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
    await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  } finally {
    await rm(temporary, { force: true });
  }
}

async function replaceWithHardLink(source: string, shared: string): Promise<void> {
  await rm(source, { force: true });
  await link(shared, source);
}

async function candidateBuildId(candidateRoot: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(path.join(candidateRoot, 'release-manifest.json'), 'utf8'),
  ) as { buildId?: unknown };
  if (!validBuildId(manifest.buildId)) throw new Error('shared_content_build_id_invalid');
  return manifest.buildId;
}

async function writeManifest(releasesRoot: string, manifest: SharedContentManifest): Promise<void> {
  const target = manifestPath(releasesRoot, manifest.buildId);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`, 'utf8');
    await rm(target, { force: true });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function shareCandidateContent(
  candidateRoot: string,
  releasesRoot: string,
): Promise<SharedContentManifest> {
  const buildId = await candidateBuildId(candidateRoot);
  const root = contentRoot(releasesRoot);
  const entries: SharedContentEntry[] = [];
  for (const filePath of await files(candidateRoot)) {
    const category = categoryFor(filePath);
    if (category === undefined) continue;
    const relativePath = path.relative(candidateRoot, filePath).replaceAll('\\', '/');
    const content = await digest(filePath);
    const shared = path.join(root, category, content.sha256);
    await ensureSharedObject(filePath, shared);
    await replaceWithHardLink(filePath, shared);
    entries.push({ category, relativePath, ...content });
  }
  const manifest: SharedContentManifest = { schemaVersion: 1, buildId, entries };
  await writeManifest(releasesRoot, manifest);
  return manifest;
}

function parseManifest(value: unknown, expectedBuildId: string): SharedContentManifest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as { schemaVersion?: unknown; buildId?: unknown; entries?: unknown };
  if (
    candidate.schemaVersion !== 1 ||
    candidate.buildId !== expectedBuildId ||
    !Array.isArray(candidate.entries)
  ) {
    return undefined;
  }
  const entries: SharedContentEntry[] = [];
  for (const entry of candidate.entries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
    const item = entry as Record<string, unknown>;
    if (
      !CATEGORIES.includes(item.category as SharedContentCategory) ||
      typeof item.relativePath !== 'string' ||
      typeof item.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(item.sha256) ||
      typeof item.size !== 'number' ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0
    ) {
      return undefined;
    }
    entries.push({
      category: item.category as SharedContentCategory,
      relativePath: item.relativePath,
      sha256: item.sha256,
      size: item.size,
    });
  }
  return { schemaVersion: 1, buildId: expectedBuildId, entries };
}

async function readManifest(
  releasesRoot: string,
  buildId: string,
): Promise<SharedContentManifest | undefined> {
  try {
    return parseManifest(
      JSON.parse(await readFile(manifestPath(releasesRoot, buildId), 'utf8')) as unknown,
      buildId,
    );
  } catch {
    return undefined;
  }
}

export async function pruneSharedContentStore(
  releasesRoot: string,
  protectedBuildIds: ReadonlySet<string>,
): Promise<readonly string[]> {
  const referenced = new Set<string>();
  let protectedManifestCount = 0;
  for (const buildId of protectedBuildIds) {
    if (buildId === 'workspace') continue;
    const manifest = await readManifest(releasesRoot, buildId);
    if (manifest === undefined) return [];
    protectedManifestCount += 1;
    for (const entry of manifest.entries) referenced.add(`${entry.category}/${entry.sha256}`);
  }
  if (protectedManifestCount === 0) return [];

  const root = contentRoot(releasesRoot);
  const removed: string[] = [];
  for (const category of CATEGORIES) {
    const directory = path.join(root, category);
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    )) {
      if (!entry.isFile() || entry.name.endsWith('.tmp')) continue;
      const key = `${category}/${entry.name}`;
      if (referenced.has(key)) continue;
      await rm(path.join(directory, entry.name), { force: true });
      removed.push(key);
    }
  }

  const manifestsRoot = path.join(root, 'manifests');
  for (const entry of await readdir(manifestsRoot, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  )) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const buildId = entry.name.slice(0, -5);
    if (protectedBuildIds.has(buildId)) continue;
    await rm(path.join(manifestsRoot, entry.name), { force: true });
  }
  return removed.sort();
}
