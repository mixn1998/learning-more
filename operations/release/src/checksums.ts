import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function releaseFiles(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) throw new Error(`release_symlink_forbidden:${relative}`);
    if (entry.isDirectory()) output.push(...(await releaseFiles(root, absolute)));
    else if (relative !== 'checksums.sha256') output.push(relative);
  }
  return output.sort();
}

async function checksum(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

export async function writeChecksumManifest(root: string): Promise<string> {
  const lines: string[] = [];
  for (const relativePath of await releaseFiles(root)) {
    lines.push(`${await checksum(path.join(root, ...relativePath.split('/')))}  ${relativePath}`);
  }
  const content = `${lines.join('\n')}\n`;
  await writeFile(path.join(root, 'checksums.sha256'), content, 'utf8');
  return content;
}

export async function verifyChecksumManifest(root: string): Promise<readonly string[]> {
  const issues: string[] = [];
  let content: string;
  try {
    content = await readFile(path.join(root, 'checksums.sha256'), 'utf8');
  } catch {
    return ['required_missing:checksums.sha256'];
  }
  const expected = new Map<string, string>();
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    const match = /^([a-f0-9]{64}) {2}([^\\]+)$/.exec(line);
    if (match === null) {
      issues.push('checksum_manifest_invalid');
      continue;
    }
    const [, digest, relativePath] = match;
    if (relativePath === undefined || digest === undefined || expected.has(relativePath)) {
      issues.push('checksum_manifest_invalid');
      continue;
    }
    expected.set(relativePath, digest);
  }
  let observed: string[];
  try {
    observed = await releaseFiles(root);
  } catch (error) {
    issues.push((error as Error).message);
    return issues;
  }
  for (const relativePath of observed) {
    const digest = expected.get(relativePath);
    if (digest === undefined) {
      issues.push(`checksum_entry_missing:${relativePath}`);
      continue;
    }
    if ((await checksum(path.join(root, ...relativePath.split('/')))) !== digest) {
      issues.push(`checksum_mismatch:${relativePath}`);
    }
    expected.delete(relativePath);
  }
  for (const relativePath of expected.keys()) issues.push(`checksum_file_missing:${relativePath}`);
  return issues.sort();
}

export async function assertRegularFile(filePath: string): Promise<void> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('release_file_invalid');
}
