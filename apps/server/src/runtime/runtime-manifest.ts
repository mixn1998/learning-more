import { createHash } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';

import { checksumJson } from '../persistence/json-codec.js';

export const RuntimeManifestSchema = z.strictObject({
  instanceId: z.string().min(1),
  generation: z.number().int().positive(),
  pid: z.number().int().positive(),
  executable: z.string().min(1),
  projectRoot: z.string().min(1),
  dataRootHash: z.string().regex(/^[a-f0-9]{64}$/),
  configFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  buildId: z.string().min(1),
  protocolVersion: z.string().min(1),
  startedAt: z.iso.datetime({ offset: true }),
  healthUrl: z.string().url(),
});

export type RuntimeManifest = Readonly<z.infer<typeof RuntimeManifestSchema>>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createRuntimeManifest(
  input: Omit<RuntimeManifest, 'dataRootHash'> & {
    dataRoot: string;
  },
): RuntimeManifest {
  const { dataRoot, ...identity } = input;
  return RuntimeManifestSchema.parse({
    ...identity,
    executable: path.resolve(identity.executable),
    projectRoot: path.resolve(identity.projectRoot),
    dataRootHash: sha256(path.resolve(dataRoot).toLocaleLowerCase('en-US')),
  });
}

export function runtimeIdentityFingerprint(manifest: RuntimeManifest): string {
  return sha256(
    checksumJson({
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
    }),
  );
}
