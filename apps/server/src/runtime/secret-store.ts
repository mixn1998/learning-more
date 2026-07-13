import { createHash } from 'node:crypto';

export interface SecretStore {
  put(handle: string, secret: Uint8Array): Promise<void>;
  get(handle: string): Promise<Uint8Array>;
  delete(handle: string): Promise<void>;
  describe(handle: string): Promise<{
    configured: boolean;
    updatedAt?: string;
    fingerprint?: string;
  }>;
}

export function assertSecretHandle(handle: string): void {
  if (handle.trim() === '' || handle.length > 500) throw new Error('secret_handle_invalid');
}

export function assertSecretValue(secret: Uint8Array): void {
  if (secret.byteLength === 0) throw new Error('secret_empty');
}

export function secretFingerprint(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
