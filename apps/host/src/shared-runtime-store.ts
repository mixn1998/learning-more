import { createHash, randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

function storeRoot(releasesRoot: string): string {
  return path.join(path.resolve(releasesRoot), '.shared-runtime');
}

export async function shareCandidateRuntime(
  candidateRoot: string,
  releasesRoot: string,
): Promise<string> {
  const executable = path.join(candidateRoot, 'runtime', 'node.exe');
  const checksum = await sha256(executable);
  const root = storeRoot(releasesRoot);
  const shared = path.join(root, `${checksum}.exe`);
  await mkdir(root, { recursive: true });
  const temporary = `${shared}.${randomUUID()}.tmp`;
  try {
    await copyFile(executable, temporary);
    await link(temporary, shared).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  } finally {
    await rm(temporary, { force: true });
  }
  await rm(executable, { force: true });
  await link(shared, executable);
  return checksum;
}

export async function pruneSharedRuntimeStore(
  releasesRoot: string,
  protectedBuildIds: ReadonlySet<string>,
): Promise<readonly string[]> {
  const referenced = new Set<string>();
  for (const buildId of protectedBuildIds) {
    try {
      referenced.add(await sha256(path.join(releasesRoot, buildId, 'runtime', 'node.exe')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const root = storeRoot(releasesRoot);
  const removed: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  )) {
    if (!entry.isFile() || !entry.name.endsWith('.exe')) continue;
    const checksum = entry.name.slice(0, -4);
    if (referenced.has(checksum)) continue;
    await rm(path.join(root, entry.name), { force: true });
    removed.push(checksum);
  }
  return removed.sort();
}
