import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { verifyChecksumManifest } from './checksums.js';

const required = [
  'START.cmd',
  'README.txt',
  'runtime/node.exe',
  'app/server',
  'app/web/index.html',
  'app/launcher',
  'schemas',
  'prompts',
  'migrations',
  'tools',
  'release-manifest.json',
  'THIRD-PARTY-NOTICES.txt',
  'sbom.cdx.json',
  'checksums.sha256',
] as const;

async function paths(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    output.push(relative);
    if (entry.isDirectory()) output.push(...(await paths(root, absolute)));
  }
  return output.sort();
}

function forbidden(relativePath: string): boolean {
  const segments = relativePath.split('/');
  const basename = segments.at(-1)?.toLowerCase() ?? '';
  const top = segments[0]?.toLowerCase();
  if (['data', 'config', 'secret', 'secrets'].includes(top ?? '')) return true;
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  if (basename.endsWith('.map')) return true;
  if (
    segments.some((segment) =>
      ['test', 'tests', '__tests__', 'fixtures'].includes(segment.toLowerCase()),
    )
  )
    return true;
  if (segments[0] === 'app' && segments[2]?.toLowerCase() === 'src') return true;
  return false;
}

function absolutePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
}

export type LayoutReport = Readonly<{
  valid: boolean;
  issues: readonly string[];
  files: readonly string[];
}>;

export async function checkPortableLayout(root: string): Promise<LayoutReport> {
  const issues: string[] = [];
  for (const relativePath of required) {
    try {
      await stat(path.join(root, ...relativePath.split('/')));
    } catch {
      issues.push(`required_missing:${relativePath}`);
    }
  }
  let observed: string[] = [];
  try {
    observed = await paths(root);
  } catch {
    issues.push('release_root_unreadable');
  }
  for (const relativePath of observed) {
    if (forbidden(relativePath)) issues.push(`forbidden_path:${relativePath}`);
  }
  try {
    const manifest = JSON.parse(
      await readFile(path.join(root, 'release-manifest.json'), 'utf8'),
    ) as { files?: unknown };
    if (!Array.isArray(manifest.files)) issues.push('release_manifest_files_invalid');
    else {
      for (const value of manifest.files) {
        if (typeof value !== 'string') issues.push('release_manifest_files_invalid');
        else if (absolutePath(value)) {
          issues.push(`release_manifest_absolute_path:${value.replaceAll('\\', '/')}`);
        }
      }
    }
  } catch {
    issues.push('release_manifest_invalid');
  }
  try {
    const sbom = JSON.parse(await readFile(path.join(root, 'sbom.cdx.json'), 'utf8')) as {
      bomFormat?: unknown;
      specVersion?: unknown;
    };
    if (sbom.bomFormat !== 'CycloneDX' || typeof sbom.specVersion !== 'string') {
      issues.push('sbom_invalid');
    }
  } catch {
    issues.push('sbom_invalid');
  }
  issues.push(...(await verifyChecksumManifest(root)));
  const unique = [...new Set(issues)].sort();
  return { valid: unique.length === 0, issues: unique, files: observed };
}
