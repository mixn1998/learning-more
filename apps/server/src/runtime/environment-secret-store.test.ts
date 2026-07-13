import { describe, expect, it } from 'vitest';

import { createEnvironmentSecretStore } from './environment-secret-store.js';

describe('EnvironmentSecretStore', () => {
  it('is read-only and resolves configured handles through an explicit variable map', async () => {
    const store = createEnvironmentSecretStore(
      { PROVIDER_API_KEY: 'secret-from-ci' },
      { 'provider/api-key': 'PROVIDER_API_KEY' },
    );
    expect(new TextDecoder().decode(await store.get('provider/api-key'))).toBe('secret-from-ci');
    await expect(store.describe('provider/api-key')).resolves.toMatchObject({ configured: true });
    await expect(store.put('provider/api-key', new Uint8Array([1]))).rejects.toThrow(
      'secret_store_read_only',
    );
    await expect(store.delete('provider/api-key')).rejects.toThrow('secret_store_read_only');
  });
});
