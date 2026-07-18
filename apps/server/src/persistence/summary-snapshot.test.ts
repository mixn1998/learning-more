import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DataRoot } from './data-root.js';
import { createSummarySnapshot } from './summary-snapshot.js';

describe('summary snapshot', () => {
  it('reuses the persisted value until its source revision changes', async () => {
    const dataRoot = DataRoot.create(await mkdtemp(path.join(os.tmpdir(), 'summary-snapshot-')));
    let revision = 'catalog:1';
    const build = vi.fn(async () => ({ value: revision }));
    const create = () =>
      createSummarySnapshot({
        dataRoot,
        name: 'test-summary',
        schemaVersion: 1,
        sourceRevision: () => revision,
        parse: (value) => value as { value: string },
        build,
      });

    expect((await create().current()).value).toEqual({ value: 'catalog:1' });
    expect((await create().current()).value).toEqual({ value: 'catalog:1' });
    expect(build).toHaveBeenCalledTimes(1);

    revision = 'catalog:2';
    expect((await create().current()).value).toEqual({ value: 'catalog:2' });
    expect(build).toHaveBeenCalledTimes(2);
  });
});
