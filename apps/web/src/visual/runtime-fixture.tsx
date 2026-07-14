import type { ProviderCatalog } from '@learning-more/contracts';

import { RuntimeCenter } from '../features/runtime/runtime-center.js';
import { AppShellView } from '../layouts/app-shell.js';
import type { RuntimeUiState } from '../state/version-guard.js';

const readyRuntime = {
  kind: 'loaded',
  readiness: {
    status: 'ready',
    instanceId: 'lm_8797_a31f',
    buildId: 'web-20260712.4',
    protocolVersion: '1',
    storeStatus: 'ready',
    projectionStatus: 'ready',
    providerStatus: 'ready',
    identityFingerprint: '98c731da98c731da98c731da98c731da98c731da98c731da98c731da98c731da',
  },
  version: { kind: 'compatible', writesAllowed: true },
} satisfies RuntimeUiState;

const providerStatus = {
  providerId: 'codex-cli',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'high',
  configurationState: 'applied',
  capabilities: {
    id: 'codex-cli',
    kind: 'cli',
    maxConcurrency: 1,
    supportsStreaming: true,
  },
  health: { status: 'healthy' },
} as const;

const providerCatalog: ProviderCatalog = {
  providers: [
    {
      providerId: 'codex-cli',
      capabilities: providerStatus.capabilities,
      health: providerStatus.health,
      models: [
        {
          id: 'gpt-5.6-sol',
          displayName: 'GPT-5.6-Sol',
          defaultReasoningEffort: 'low',
          supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        },
      ],
    },
  ],
};

export function RuntimeFixture() {
  return (
    <AppShellView providerLabel="Codex CLI" refresh={() => undefined} state={readyRuntime}>
      <RuntimeCenter
        api={{
          reconnect: async () => ({ state: 'healthy', crashCount: 0 }),
          waitUntilReady: async () => readyRuntime.readiness,
          refreshAi: async () => undefined,
          reconnectAi: async () => providerStatus,
          getProviderStatus: async () => providerStatus,
          getProviderCatalog: async () => providerCatalog,
          createDiagnostics: async () => ({ diagnosticId: 'diagnostics_public_01' }),
          switchProvider: async () => providerStatus,
        }}
      />
    </AppShellView>
  );
}
