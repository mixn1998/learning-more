import { createHash } from 'node:crypto';
import { z } from 'zod';

import { checksumJson } from '../../../persistence/json-codec.js';
import type { PackedPortraitEvidence, PortraitInputManifest } from '../interface.js';

export const PortraitInputManifestSchema = z.strictObject({
  manifestId: z.string().min(1),
  profileVersion: z.number().int().positive(),
  evidencePackChecksum: z.string().min(1),
  includedEvidenceIds: z.array(z.string().min(1)),
  window: z.strictObject({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  }),
  policyVersion: z.string().min(1),
  promptTemplateVersion: z.string().min(1),
  providerConfigFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  manifestChecksum: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
});

export function createPortraitInputManifest(input: {
  profileVersion: number;
  packedEvidence: PackedPortraitEvidence;
  window: Readonly<{ from: string; to: string }>;
  promptTemplateVersion: string;
  providerConfigFingerprint: string;
  createdAt: string;
}): PortraitInputManifest {
  if (Date.parse(input.window.from) >= Date.parse(input.window.to)) {
    throw new Error('portrait_manifest_window_invalid');
  }
  const frozen = {
    profileVersion: input.profileVersion,
    evidencePackChecksum: checksumJson(input.packedEvidence),
    includedEvidenceIds: [...input.packedEvidence.includedEvidenceIds].sort(),
    window: input.window,
    policyVersion: input.packedEvidence.policyVersion,
    promptTemplateVersion: input.promptTemplateVersion,
    providerConfigFingerprint: input.providerConfigFingerprint,
    createdAt: input.createdAt,
  };
  const manifestChecksum = checksumJson(frozen);
  return PortraitInputManifestSchema.parse({
    ...frozen,
    manifestId: `manifest_${createHash('sha256').update(manifestChecksum).digest('hex').slice(0, 40)}`,
    manifestChecksum,
  });
}
