export type PortraitEvidenceView = Readonly<{
  evidenceId: string;
  summary: string;
  sourceGroup: string;
  sourceGroupId: string;
  dependentSourceGroupIds: readonly string[];
  observedAt: string;
  strength: Readonly<{ score: number; rationale: string }>;
  polarity: string;
  status: string;
}>;

export type PortraitClaimView = Readonly<{
  claimId: string;
  markdown: string;
  evidenceIds: readonly string[];
  confidence: number;
  limitations: readonly string[];
  counterEvidenceChecked: true;
}>;

export type PortraitVersionView = Readonly<{
  versionId: string;
  state: 'preparing' | 'generating' | 'failed' | 'completed';
  title?: string;
  summary?: string;
  claims: readonly PortraitClaimView[];
  errorCode?: string;
  draftArtifactRef?: string;
  updatedAt: string;
  resourceVersion: number;
}>;

export interface ProfileClient {
  getProfile(): Promise<Record<string, unknown>>;
  getEvidence(): Promise<readonly PortraitEvidenceView[]>;
  getPortrait(): Promise<PortraitVersionView | undefined>;
  getPortraitVersion(versionId: string): Promise<PortraitVersionView | undefined>;
  refresh(tokenBudget?: number): Promise<PortraitVersionView>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 404) return undefined as T;
  const body = (await response.json()) as T;
  if (!response.ok) throw body;
  return body;
}

export const profileClient: ProfileClient = {
  getProfile: () => request('/api/v1/profile-facts'),
  async getEvidence() {
    const page = await request<{ entries: readonly PortraitEvidenceView[] }>(
      '/api/v1/portrait-evidence?pageSize=100',
    );
    return page.entries;
  },
  getPortrait: () => request('/api/v1/portrait'),
  getPortraitVersion: (versionId) => request(`/api/v1/portraits/${encodeURIComponent(versionId)}`),
  refresh: (tokenBudget = 8_000) =>
    request('/api/v1/portrait-refreshes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'x-csrf-token': 'development-csrf',
      },
      body: JSON.stringify({ tokenBudget }),
    }),
};
