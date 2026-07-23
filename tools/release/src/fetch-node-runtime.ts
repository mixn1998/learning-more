import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const nodeVersion = '24.17.0';
const distributionRoot = `https://nodejs.org/dist/v${nodeVersion}`;
const archiveName = `node-v${nodeVersion}-win-x64.zip`;

async function runtimeVersion(executable: string): Promise<string | undefined> {
  try {
    return (await executeFile(executable, ['--version'], { encoding: 'utf8' })).stdout.trim();
  } catch {
    return undefined;
  }
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || response.body === null) throw new Error('release_node_download_failed');
  await pipeline(
    Readable.fromWeb(response.body as never),
    createWriteStream(destination, { flags: 'wx' }),
  );
}

export async function resolvePinnedNodeRuntime(projectRoot: string): Promise<string> {
  const override = process.env.LEARNING_MORE_NODE_EXE;
  if (override !== undefined) {
    const resolved = path.resolve(override);
    if ((await runtimeVersion(resolved)) !== `v${nodeVersion}`) {
      throw new Error('release_node_version_invalid');
    }
    return resolved;
  }
  const executable = path.join(
    projectRoot,
    '.release-cache',
    `node-v${nodeVersion}-win-x64`,
    'node.exe',
  );
  if ((await runtimeVersion(executable)) === `v${nodeVersion}`) return executable;

  const cacheRoot = path.join(projectRoot, '.release-cache');
  const shasumsPath = path.join(cacheRoot, `SHASUMS256-v${nodeVersion}.txt`);
  let shasums = await readFile(shasumsPath, 'utf8').catch(() => undefined);
  if (shasums === undefined) {
    const shasumsResponse = await fetch(`${distributionRoot}/SHASUMS256.txt`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!shasumsResponse.ok) throw new Error('release_node_shasums_download_failed');
    shasums = await shasumsResponse.text();
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(shasumsPath, shasums, 'utf8');
  }
  const expected = shasums
    .split(/\r?\n/)
    .map(
      (line) =>
        new RegExp(`^([a-f0-9]{64}) {2}${archiveName.replaceAll('.', '\\.')}$$`).exec(line)?.[1],
    )
    .find((value): value is string => value !== undefined);
  if (expected === undefined) throw new Error('release_node_checksum_missing');
  const archivePath = path.join(cacheRoot, archiveName);
  const temporary = `${archivePath}.${process.pid}.tmp`;
  await mkdir(cacheRoot, { recursive: true });
  await rm(temporary, { force: true });
  if ((await sha256(archivePath).catch(() => undefined)) !== expected) {
    await rm(archivePath, { force: true });
    await download(`${distributionRoot}/${archiveName}`, temporary);
    if ((await sha256(temporary)) !== expected) {
      await rm(temporary, { force: true });
      throw new Error('release_node_checksum_mismatch');
    }
    await rm(archivePath, { force: true });
    await rename(temporary, archivePath);
  }
  await rm(path.dirname(executable), { recursive: true, force: true });
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  await executeFile(tar, ['-xf', archivePath, '-C', cacheRoot], { encoding: 'utf8' });
  if ((await runtimeVersion(executable)) !== `v${nodeVersion}`) {
    await rm(path.dirname(executable), { recursive: true, force: true });
    throw new Error('release_node_version_invalid');
  }
  return executable;
}

export async function pinnedNodeRuntimeChecksum(projectRoot: string): Promise<string> {
  const executable = await resolvePinnedNodeRuntime(projectRoot);
  return createHash('sha256')
    .update(await readFile(executable))
    .digest('hex');
}

export const PINNED_NODE_VERSION = nodeVersion;
