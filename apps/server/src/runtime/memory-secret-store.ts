import {
  assertSecretHandle,
  assertSecretValue,
  secretFingerprint,
  type SecretStore,
} from './secret-store.js';

export function createMemorySecretStore(now: () => Date = () => new Date()): SecretStore {
  const values = new Map<string, { secret: Uint8Array; updatedAt: string }>();
  return {
    async put(handle, secret) {
      assertSecretHandle(handle);
      assertSecretValue(secret);
      values.set(handle, { secret: Uint8Array.from(secret), updatedAt: now().toISOString() });
    },
    async get(handle) {
      assertSecretHandle(handle);
      const value = values.get(handle);
      if (value === undefined) throw new Error('secret_not_found');
      return Uint8Array.from(value.secret);
    },
    async delete(handle) {
      assertSecretHandle(handle);
      values.delete(handle);
    },
    async describe(handle) {
      assertSecretHandle(handle);
      const value = values.get(handle);
      return value === undefined
        ? { configured: false }
        : {
            configured: true,
            updatedAt: value.updatedAt,
            fingerprint: secretFingerprint(value.secret),
          };
    },
  };
}
