import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertSecretHandle,
  assertSecretValue,
  secretFingerprint,
  type SecretStore,
} from './secret-store.js';

type StoredSecret = Readonly<{
  schemaVersion: 1;
  handleHash: string;
  updatedAt: string;
  ciphertext: string;
}>;

function encodedPowerShellArguments(script: string): readonly string[] {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ];
}

function powershellPath(): string {
  return path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

function runDpapi(operation: 'Protect' | 'Unprotect', value: Uint8Array): Promise<Uint8Array> {
  const script = `
Add-Type -AssemblyName System.Security
$encoded = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($encoded)
$result = [System.Security.Cryptography.ProtectedData]::${operation}(
  $bytes,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn(powershellPath(), encodedPowerShellArguments(script), {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const output: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.once('error', () => reject(new Error('dpapi_unavailable')));
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error('dpapi_unavailable'));
        return;
      }
      try {
        resolve(Uint8Array.from(Buffer.from(Buffer.concat(output).toString('utf8'), 'base64')));
      } catch {
        reject(new Error('dpapi_unavailable'));
      }
    });
    child.stdin.end(Buffer.from(value).toString('base64'));
  });
}

function execute(executable: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...arguments_],
      { encoding: 'utf8', shell: false, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

let currentUserSid: Promise<string> | undefined;
function resolveCurrentUserSid(): Promise<string> {
  currentUserSid ??= execute(
    path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'),
    ['/user', '/fo', 'csv', '/nh'],
  ).then((output) => {
    const sid = output.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (sid === undefined) throw new Error('secret_acl_unavailable');
    return sid;
  });
  return currentUserSid;
}

async function restrictToCurrentUser(filePath: string): Promise<void> {
  const sid = await resolveCurrentUserSid();
  await execute(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [
    filePath,
    '/inheritance:r',
    '/grant:r',
    `*${sid}:(F)`,
  ]);
}

function parseStoredSecret(value: unknown, handleHash: string): StoredSecret {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 4
  ) {
    throw new Error('secret_record_corrupted');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    record.handleHash !== handleHash ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt)) ||
    typeof record.ciphertext !== 'string' ||
    record.ciphertext === ''
  ) {
    throw new Error('secret_record_corrupted');
  }
  return record as StoredSecret;
}

export function createWindowsDpapiSecretStore(directory: string): SecretStore {
  if (process.platform !== 'win32') throw new Error('dpapi_unavailable');
  const handleHash = (handle: string) => createHash('sha256').update(handle, 'utf8').digest('hex');
  const filePath = (hash: string) => path.join(directory, `${hash}.secret.json`);

  async function read(handle: string): Promise<StoredSecret> {
    assertSecretHandle(handle);
    const hash = handleHash(handle);
    try {
      return parseStoredSecret(JSON.parse(await readFile(filePath(hash), 'utf8')) as unknown, hash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('secret_not_found');
      throw error;
    }
  }

  return {
    async put(handle, secret) {
      assertSecretHandle(handle);
      assertSecretValue(secret);
      const hash = handleHash(handle);
      const target = filePath(hash);
      const temporary = `${target}.${randomUUID()}.tmp`;
      const previous = `${target}.${randomUUID()}.previous`;
      const ciphertext = await runDpapi('Protect', secret);
      const record: StoredSecret = {
        schemaVersion: 1,
        handleHash: hash,
        updatedAt: new Date().toISOString(),
        ciphertext: Buffer.from(ciphertext).toString('base64'),
      };
      await mkdir(directory, { recursive: true });
      let movedPrevious = false;
      try {
        await writeFile(temporary, `${JSON.stringify(record)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        await restrictToCurrentUser(temporary);
        try {
          await rename(target, previous);
          movedPrevious = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await rename(temporary, target);
        await rm(previous, { force: true });
      } catch (error) {
        if (movedPrevious) await rename(previous, target);
        throw error;
      } finally {
        await rm(temporary, { force: true });
        await rm(previous, { force: true });
      }
    },
    async get(handle) {
      const record = await read(handle);
      return runDpapi('Unprotect', Uint8Array.from(Buffer.from(record.ciphertext, 'base64')));
    },
    async delete(handle) {
      assertSecretHandle(handle);
      await rm(filePath(handleHash(handle)), { force: true });
    },
    async describe(handle) {
      try {
        const record = await read(handle);
        return {
          configured: true,
          updatedAt: record.updatedAt,
          fingerprint: secretFingerprint(record.ciphertext),
        };
      } catch (error) {
        if ((error as Error).message === 'secret_not_found') return { configured: false };
        throw error;
      }
    },
  };
}
