import { createHash } from 'node:crypto';

import type { StartupObservation } from './recovery-policy.js';

export type RuntimeManifest = Readonly<{
  instanceId: string;
  generation: number;
  pid: number;
  executable: string;
  projectRoot: string;
  dataRootHash: string;
  configFingerprint: string;
  buildId: string;
  protocolVersion: string;
  startedAt: string;
  healthUrl: string;
}>;

export type PublicReadiness = Readonly<{
  status: string;
  instanceId: string;
  generation?: number;
  startedAt?: string;
  identityFingerprint?: string;
  buildId: string;
  protocolVersion: string;
}>;

const manifestKeys = [
  'instanceId',
  'generation',
  'pid',
  'executable',
  'projectRoot',
  'dataRootHash',
  'configFingerprint',
  'buildId',
  'protocolVersion',
  'startedAt',
  'healthUrl',
] as const;

export function parseRuntimeManifest(value: unknown): RuntimeManifest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('runtime_manifest_invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== manifestKeys.length ||
    manifestKeys.some((key) => !(key in record)) ||
    typeof record.instanceId !== 'string' ||
    !Number.isInteger(record.generation) ||
    (record.generation as number) < 1 ||
    !Number.isInteger(record.pid) ||
    (record.pid as number) < 1 ||
    typeof record.executable !== 'string' ||
    typeof record.projectRoot !== 'string' ||
    typeof record.dataRootHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.dataRootHash) ||
    typeof record.configFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.configFingerprint) ||
    typeof record.buildId !== 'string' ||
    typeof record.protocolVersion !== 'string' ||
    typeof record.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.startedAt)) ||
    typeof record.healthUrl !== 'string' ||
    !record.healthUrl.startsWith('http://127.0.0.1:')
  ) {
    throw new Error('runtime_manifest_invalid');
  }
  return record as RuntimeManifest;
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function runtimeIdentityFingerprint(manifest: RuntimeManifest): string {
  const identity = {
    instanceId: manifest.instanceId,
    generation: manifest.generation,
    pid: manifest.pid,
    executable: manifest.executable,
    projectRoot: manifest.projectRoot,
    dataRootHash: manifest.dataRootHash,
    configFingerprint: manifest.configFingerprint,
    buildId: manifest.buildId,
    protocolVersion: manifest.protocolVersion,
    startedAt: manifest.startedAt,
  };
  const encoded = `${JSON.stringify(canonical(identity))}\n`;
  return sha256(`sha256:${sha256(encoded)}`);
}

function sameExecutable(left: string | undefined, right: string): boolean {
  return left?.replaceAll('\\', '/').toLowerCase() === right.replaceAll('\\', '/').toLowerCase();
}

export function observeExistingRuntime(
  input: Readonly<{
    manifest?: RuntimeManifest;
    portOwnerPid?: number;
    processExecutable?: string;
    readiness?: PublicReadiness;
    configValid?: boolean;
    storeState?: StartupObservation['storeState'];
  }>,
): StartupObservation {
  const base = {
    configValid: input.configValid ?? true,
    storeState: input.storeState ?? 'ready',
  } as const;
  if (input.manifest === undefined) {
    return input.portOwnerPid === undefined
      ? {
          ...base,
          manifestState: 'missing',
          processState: 'missing',
          portState: 'free',
          healthState: 'unreachable',
        }
      : {
          ...base,
          manifestState: 'missing',
          processState: 'foreign_or_reused_pid',
          portState: 'foreign_owner',
          healthState: 'identity_mismatch',
        };
  }
  if (input.portOwnerPid === undefined) {
    return {
      ...base,
      manifestState: 'stale',
      processState: 'missing',
      portState: 'free',
      healthState: 'unreachable',
    };
  }

  const manifest = input.manifest;
  const ownsPort = input.portOwnerPid === manifest.pid;
  const processMatches = ownsPort && sameExecutable(input.processExecutable, manifest.executable);
  const readiness = input.readiness;
  const healthMatches =
    processMatches &&
    readiness !== undefined &&
    readiness.status === 'ready' &&
    readiness.instanceId === manifest.instanceId &&
    readiness.generation === manifest.generation &&
    readiness.startedAt === manifest.startedAt &&
    readiness.identityFingerprint === runtimeIdentityFingerprint(manifest) &&
    readiness.buildId === manifest.buildId &&
    readiness.protocolVersion === manifest.protocolVersion;
  return {
    ...base,
    manifestState: 'valid',
    processState: processMatches ? 'verified_owned' : 'foreign_or_reused_pid',
    portState: ownsPort ? 'owned_by_manifest' : 'foreign_owner',
    healthState: healthMatches ? 'identity_verified' : 'identity_mismatch',
  };
}
