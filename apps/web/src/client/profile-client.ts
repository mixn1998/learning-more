import {
  GlobalLearningProfileSchema,
  PortraitCurrentSchema,
  PortraitEvidencePageSchema,
  PortraitRefreshRequestSchema,
  PortraitVersionSchema,
  type GlobalLearningProfile,
  type PortraitClaim,
  type PortraitCurrent,
  type PortraitEvidence,
  type PortraitVersion,
} from '@learning-more/contracts';

import { apiRequest, apiRequestOptional, type CommandAttempt } from './api-client.js';

export type PortraitEvidenceView = PortraitEvidence;
export type PortraitClaimView = PortraitClaim;
export type PortraitVersionView = PortraitVersion;

export interface ProfileClient {
  getProfile(): Promise<GlobalLearningProfile>;
  getEvidence(): Promise<readonly PortraitEvidence[]>;
  getPortrait(): Promise<PortraitCurrent | undefined>;
  getPortraitVersion(versionId: string): Promise<PortraitVersion | undefined>;
  refresh(tokenBudget: number | undefined, command: CommandAttempt): Promise<PortraitVersion>;
}

export const profileClient: ProfileClient = {
  async getProfile() {
    return (
      await apiRequest('/api/v1/profile-facts', {
        schema: GlobalLearningProfileSchema,
      })
    ).data;
  },
  async getEvidence() {
    return (
      await apiRequest('/api/v1/portrait-evidence?pageSize=100', {
        schema: PortraitEvidencePageSchema,
      })
    ).data.entries;
  },
  async getPortrait() {
    return (
      await apiRequestOptional('/api/v1/portrait', {
        schema: PortraitCurrentSchema,
      })
    ).data;
  },
  async getPortraitVersion(versionId) {
    return (
      await apiRequestOptional(`/api/v1/portraits/${encodeURIComponent(versionId)}`, {
        schema: PortraitVersionSchema,
      })
    ).data;
  },
  async refresh(tokenBudget = 8_000, command) {
    const body = PortraitRefreshRequestSchema.parse({ tokenBudget });
    return (
      await apiRequest('/api/v1/portrait-refreshes', {
        method: 'POST',
        body,
        schema: PortraitVersionSchema,
        command,
      })
    ).data;
  },
};
