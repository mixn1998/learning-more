import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createMemorySecretStore } from './memory-secret-store.js';
import type { SecretStore } from './secret-store.js';
import { createWindowsDpapiSecretStore } from './windows-dpapi-secret-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function contract(name: string, factory: () => Promise<SecretStore>) {
  describe(`${name} SecretStore contract`, () => {
    it(
      'round-trips, overwrites, describes, and deletes Unicode handles without exposing bytes',
      async () => {
        const store = await factory();
        const first = new TextEncoder().encode('秘密-value-01');
        const second = new TextEncoder().encode('replacement-秘密-02');
        await store.put('提供商/主密钥', first);
        expect(await store.get('提供商/主密钥')).toEqual(first);
        const description = await store.describe('提供商/主密钥');
        expect(description.configured).toBe(true);
        expect(description.updatedAt).toBeTruthy();
        expect(description.fingerprint).toMatch(/^[a-f0-9]{16}$/);
        expect(JSON.stringify(description)).not.toContain('秘密-value-01');
        await store.put('提供商/主密钥', second);
        expect(await store.get('提供商/主密钥')).toEqual(second);
        await store.delete('提供商/主密钥');
        await expect(store.get('提供商/主密钥')).rejects.toThrow('secret_not_found');
        await expect(store.describe('提供商/主密钥')).resolves.toEqual({ configured: false });
      },
      name === 'Windows DPAPI' ? 15_000 : 5_000,
    );

    it('rejects empty secrets and empty handles', async () => {
      const store = await factory();
      await expect(store.put('api-key', new Uint8Array())).rejects.toThrow('secret_empty');
      await expect(store.put('', new Uint8Array([1]))).rejects.toThrow('secret_handle_invalid');
    });
  });
}

contract('Memory', async () => createMemorySecretStore());

if (process.platform === 'win32') {
  contract('Windows DPAPI', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-secrets-'));
    roots.push(root);
    return createWindowsDpapiSecretStore(root);
  });

  it('never writes DPAPI-protected plaintext to disk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-secrets-disk-'));
    roots.push(root);
    const store = createWindowsDpapiSecretStore(root);
    const plaintext = 'LM_PLAINTEXT_SENTINEL_7f4a';
    await store.put('api-key', new TextEncoder().encode(plaintext));
    const contents = await Promise.all(
      (await readdir(root)).map((name) => readFile(path.join(root, name), 'utf8')),
    );
    expect(contents.join('\n')).not.toContain(plaintext);
  });
}
