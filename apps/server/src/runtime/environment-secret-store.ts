import { assertSecretHandle, secretFingerprint, type SecretStore } from './secret-store.js';

export function createEnvironmentSecretStore(
  environment: Readonly<Record<string, string | undefined>>,
  variablesByHandle: Readonly<Record<string, string>>,
): SecretStore {
  function value(handle: string): string | undefined {
    assertSecretHandle(handle);
    const variable = variablesByHandle[handle];
    return variable === undefined ? undefined : environment[variable];
  }
  return {
    async put() {
      throw new Error('secret_store_read_only');
    },
    async get(handle) {
      const secret = value(handle);
      if (secret === undefined || secret === '') throw new Error('secret_not_found');
      return new TextEncoder().encode(secret);
    },
    async delete() {
      throw new Error('secret_store_read_only');
    },
    async describe(handle) {
      const secret = value(handle);
      return secret === undefined || secret === ''
        ? { configured: false }
        : { configured: true, fingerprint: secretFingerprint(secret) };
    },
  };
}
