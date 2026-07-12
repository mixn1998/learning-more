import type { RuntimeManifest } from './runtime-manifest.js';
import { runtimeIdentityFingerprint } from './runtime-manifest.js';

export type ObservedProcessIdentity = Readonly<{
  instanceId: string;
  generation: number;
  pid: number;
  portOwnerPid: number;
  executable: string;
  projectRoot: string;
  dataRootHash: string;
  configFingerprint: string;
  buildId: string;
  protocolVersion: string;
  startedAt: string;
  identityFingerprint: string;
}>;

export function verifyProcessIdentity(
  manifest: RuntimeManifest,
  observed: ObservedProcessIdentity,
): Readonly<{ healthy: boolean; mismatches: readonly (keyof ObservedProcessIdentity)[] }> {
  const mismatches: Array<keyof ObservedProcessIdentity> = [];
  const compare = <TKey extends keyof ObservedProcessIdentity>(
    key: TKey,
    expected: ObservedProcessIdentity[TKey],
  ) => {
    if (observed[key] !== expected) mismatches.push(key);
  };
  compare('instanceId', manifest.instanceId);
  compare('generation', manifest.generation);
  compare('pid', manifest.pid);
  compare('portOwnerPid', manifest.pid);
  compare('executable', manifest.executable);
  compare('projectRoot', manifest.projectRoot);
  compare('dataRootHash', manifest.dataRootHash);
  compare('configFingerprint', manifest.configFingerprint);
  compare('buildId', manifest.buildId);
  compare('protocolVersion', manifest.protocolVersion);
  compare('startedAt', manifest.startedAt);
  compare('identityFingerprint', runtimeIdentityFingerprint(manifest));
  return { healthy: mismatches.length === 0, mismatches };
}
