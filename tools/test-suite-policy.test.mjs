import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const capacitySource = await readFile(
  new URL('../tests/performance/capacity-gate.test.ts', import.meta.url),
  'utf8',
);

describe('test suite policy', () => {
  it('keeps performance and recovery drills out of daily test commands', () => {
    expect(packageJson.scripts.test).toContain('--exclude tests/performance/**');
    expect(packageJson.scripts.test).toContain('--exclude tests/recovery/**');
    expect(packageJson.scripts['test:ci']).toContain('--exclude tests/performance/**');
    expect(packageJson.scripts['test:ci']).toContain('--exclude tests/recovery/**');
  });

  it('composes release verification without recursively invoking daily verification', () => {
    expect(packageJson.scripts.verify).toBe('node tools/verify-change.mjs');
    expect(packageJson.scripts['verify:full']).toContain('corepack pnpm format:check');
    expect(packageJson.scripts['verify:full']).toContain('corepack pnpm build');
    expect(packageJson.scripts['verify:release']).toContain('corepack pnpm verify:full');
    expect(packageJson.scripts['ci:local']).toContain('corepack pnpm verify:full');
    expect(packageJson.scripts['release:portable']).toContain('corepack pnpm verify:full');
    expect(packageJson.scripts['frontend:acceptance']).toContain('corepack pnpm verify:full');
    expect(packageJson.scripts['verify:release']).toContain('frontend:acceptance:checks');
    expect(packageJson.scripts['frontend:acceptance:checks']).not.toContain(
      'corepack pnpm verify &&',
    );
  });

  it('keeps logical capacity validation free of large filesystem allocations', () => {
    expect(capacitySource).not.toContain('truncate(');
    expect(capacitySource).not.toContain('mkdtemp(');
    expect(capacitySource).toContain('logicalBytes: 20 * 1024 ** 3');
  });
});
