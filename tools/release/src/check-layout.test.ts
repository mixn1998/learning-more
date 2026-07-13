import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkPortableLayout } from './check-layout.js';
import { writeChecksumManifest } from './checksums.js';
import { writeDeterministicZip } from './deterministic-zip.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-portable-'));
  roots.push(root);
  const files: Record<string, string> = {
    'START.cmd': '@echo off\r\n',
    'README.txt': 'Learning MORE portable\r\n',
    'runtime/node.exe': 'runtime',
    'app/server/dist/bootstrap/main.js': 'server',
    'app/server/package.json': '{}\n',
    'app/web/index.html': '<!doctype html>',
    'app/launcher/dist/main.js': 'launcher',
    'app/launcher/package.json': '{}\n',
    'schemas/course-authoring.openapi.json': '{}\n',
    'prompts/README.txt': 'Prompt assets are versioned by the application.\r\n',
    'migrations/README.txt': 'Store schema 1 has no predecessor migration.\r\n',
    'tools/learning-more.js': 'cli',
    'release-manifest.json': `${JSON.stringify({
      version: '0.0.0-development',
      files: ['runtime/node.exe', 'app/server/dist/bootstrap/main.js'],
    })}\n`,
    'THIRD-PARTY-NOTICES.txt': 'notices\r\n',
    'sbom.cdx.json': `${JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6' })}\n`,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
  await writeChecksumManifest(root);
  return root;
}

describe('portable release layout', () => {
  it('accepts the complete allowlisted layout with valid relative checksums', async () => {
    const root = await fixture();
    await expect(checkPortableLayout(root)).resolves.toMatchObject({ valid: true, issues: [] });
    expect(await readFile(path.join(root, 'checksums.sha256'), 'utf8')).not.toContain(root);
  });

  it('rejects missing runtime, schema, prompt, or legal assets', async () => {
    const root = await fixture();
    await rm(path.join(root, 'runtime', 'node.exe'));
    await rm(path.join(root, 'schemas'), { recursive: true });
    await rm(path.join(root, 'prompts'), { recursive: true });
    await rm(path.join(root, 'THIRD-PARTY-NOTICES.txt'));
    const report = await checkPortableLayout(root);
    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        'required_missing:runtime/node.exe',
        'required_missing:schemas',
        'required_missing:prompts',
        'required_missing:THIRD-PARTY-NOTICES.txt',
      ]),
    );
  });

  it.each(['.env', 'data/store.json', 'secrets/key.txt', 'app/server/main.js.map', 'tests/f.json'])(
    'rejects forbidden release content %s',
    async (relativePath) => {
      const root = await fixture();
      const absolute = path.join(root, ...relativePath.split('/'));
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, 'forbidden', 'utf8');
      const report = await checkPortableLayout(root);
      expect(report.valid).toBe(false);
      expect(report.issues).toContain(`forbidden_path:${relativePath}`);
    },
  );

  it('rejects checksum mismatches and absolute paths embedded in the release manifest', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'app', 'web', 'index.html'), 'tampered', 'utf8');
    let report = await checkPortableLayout(root);
    expect(report.issues).toContain('checksum_mismatch:app/web/index.html');

    await writeFile(
      path.join(root, 'release-manifest.json'),
      `${JSON.stringify({ version: 'test', files: ['C:\\private\\node.exe'] })}\n`,
      'utf8',
    );
    await writeChecksumManifest(root);
    report = await checkPortableLayout(root);
    expect(report.issues).toContain('release_manifest_absolute_path:C:/private/node.exe');
  });

  it('writes byte-identical ZIP files with fixed entry metadata and Unicode paths', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'prompts', '画像提示.txt'), 'portrait@1', 'utf8');
    await writeChecksumManifest(root);
    const output = await mkdtemp(path.join(os.tmpdir(), 'learning-more-zips-'));
    roots.push(output);
    const first = path.join(output, 'first.zip');
    const second = path.join(output, 'second.zip');
    await writeDeterministicZip({ sourceRoot: root, outputPath: first, prefix: 'Learning MORE' });
    await writeDeterministicZip({ sourceRoot: root, outputPath: second, prefix: 'Learning MORE' });
    const hash = (content: Buffer) => createHash('sha256').update(content).digest('hex');
    expect(hash(await readFile(first))).toBe(hash(await readFile(second)));
    expect((await readFile(first)).readUInt32LE(0)).toBe(0x04034b50);
  });
});
import { createHash } from 'node:crypto';
