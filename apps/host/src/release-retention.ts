import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { pruneSharedRuntimeStore } from './shared-runtime-store.js';

export type ReleaseRetentionResult = Readonly<{
  removedBuildIds: readonly string[];
  removedTemporaryEntries: readonly string[];
  removedActivationEntries: readonly string[];
}>;

function isBuildId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(value);
}

async function isManagedRelease(directory: string, expectedBuildId: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(directory, 'release-manifest.json'), 'utf8'),
    ) as { buildId?: unknown };
    return manifest.buildId === expectedBuildId;
  } catch {
    return false;
  }
}

function isTemporaryReleaseEntry(name: string): boolean {
  return name.endsWith('.staging') || name.endsWith('.tmp');
}

export async function pruneReleaseCache(options: {
  releasesRoot: string;
  activeBuildId: string;
  previousBuildId?: string;
  preserveActivationRequestId?: string;
}): Promise<ReleaseRetentionResult> {
  const releasesRoot = path.resolve(options.releasesRoot);
  const protectedBuildIds = new Set(
    [options.activeBuildId, options.previousBuildId, 'workspace'].filter(
      (value): value is string => value !== undefined,
    ),
  );
  const removedBuildIds: string[] = [];
  const removedTemporaryEntries: string[] = [];
  const activationRoot = path.join(releasesRoot, '.activation-work');
  await mkdir(activationRoot, { recursive: true });

  for (const entry of await readdir(releasesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.activation-work') continue;
    if (protectedBuildIds.has(entry.name)) continue;
    const target = path.join(releasesRoot, entry.name);
    if (isTemporaryReleaseEntry(entry.name)) {
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      removedTemporaryEntries.push(entry.name);
      continue;
    }
    if (!isBuildId(entry.name) || !(await isManagedRelease(target, entry.name))) continue;
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    removedBuildIds.push(entry.name);
  }

  const removedActivationEntries: string[] = [];
  for (const entry of await readdir(activationRoot, { withFileTypes: true })) {
    if (entry.name === options.preserveActivationRequestId) continue;
    await rm(path.join(activationRoot, entry.name), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
    removedActivationEntries.push(entry.name);
  }
  await pruneSharedRuntimeStore(releasesRoot, protectedBuildIds);

  return {
    removedBuildIds: removedBuildIds.sort(),
    removedTemporaryEntries: removedTemporaryEntries.sort(),
    removedActivationEntries: removedActivationEntries.sort(),
  };
}
