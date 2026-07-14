import {
  CodexLoginStartResponseSchema,
  LauncherControlStatusSchema,
  LauncherRuntimeStatusSchema,
  ProviderSwitchRequestSchema,
  ProviderSwitchResponseSchema,
  ProviderRuntimeStatusSchema,
  ProviderCatalogSchema,
  RuntimeDiagnosticsResponseSchema,
  RuntimeReadySchema,
  type ProviderSwitchRequest,
  type ProviderSwitchResponse,
  type ProviderRuntimeStatus,
  type ProviderCatalog,
  type CodexLoginStartResponse,
  type LauncherRuntimeStatus,
  type RuntimeReady,
} from '@learning-more/contracts';

import { apiRequest, type CommandAttempt } from './api-client.js';

export async function fetchRuntimeReadiness(signal: AbortSignal): Promise<RuntimeReady> {
  const response = await fetch('/api/v1/runtime/ready', {
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error('runtime_readiness_unavailable');
  return RuntimeReadySchema.parse(await response.json());
}

export interface RuntimeCenterClient {
  reconnect(): Promise<LauncherRuntimeStatus>;
  waitUntilReady(): Promise<RuntimeReady>;
  refreshAi(): Promise<void>;
  reconnectAi?(): Promise<ProviderRuntimeStatus>;
  getProviderStatus(): Promise<ProviderRuntimeStatus>;
  getProviderCatalog(options?: Readonly<{ refresh?: boolean }>): Promise<ProviderCatalog>;
  startCodexLogin?(): Promise<CodexLoginStartResponse>;
  createDiagnostics(command: CommandAttempt): Promise<Readonly<{ diagnosticId: string }>>;
  switchProvider(
    input: ProviderSwitchRequest,
    command: CommandAttempt,
  ): Promise<ProviderSwitchResponse>;
}

const launcherCapabilityStorageKey = 'learning-more.launcher-capability';
const launcherCapabilityExpiryKey = 'learning-more.launcher-capability-expires-at';

function clearLauncherCapability(): void {
  sessionStorage.removeItem(launcherCapabilityStorageKey);
  sessionStorage.removeItem(launcherCapabilityExpiryKey);
}

async function launcherCapability(forceRefresh = false): Promise<string> {
  if (forceRefresh) clearLauncherCapability();
  const fragment = new URLSearchParams(globalThis.location?.hash.slice(1) ?? '');
  const supplied = fragment.get('launcher-capability');
  if (supplied !== null && supplied !== '') {
    sessionStorage.setItem(launcherCapabilityStorageKey, supplied);
    sessionStorage.setItem(launcherCapabilityExpiryKey, String(Date.now() + 60_000));
    fragment.delete('launcher-capability');
    const suffix = fragment.toString();
    history.replaceState(
      null,
      '',
      `${location.pathname}${location.search}${suffix ? `#${suffix}` : ''}`,
    );
    return supplied;
  }
  const stored = sessionStorage.getItem(launcherCapabilityStorageKey);
  const storedExpiry = Number(sessionStorage.getItem(launcherCapabilityExpiryKey));
  if (
    stored !== null &&
    stored !== '' &&
    Number.isFinite(storedExpiry) &&
    storedExpiry > Date.now()
  ) {
    return stored;
  }
  const response = await fetch('http://127.0.0.1:43119/control/v1/status', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('launcher_capability_missing');
  const status = LauncherControlStatusSchema.parse(await response.json());
  sessionStorage.setItem(launcherCapabilityStorageKey, status.capability);
  sessionStorage.setItem(launcherCapabilityExpiryKey, String(status.capabilityExpiresAt));
  return status.capability;
}

async function controlWrite(path: 'reconnect' | 'sync-frontend'): Promise<LauncherRuntimeStatus> {
  const write = async (capability: string) =>
    fetch(`http://127.0.0.1:43119/control/v1/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-learning-more-capability': capability,
      },
      body: '{}',
    });
  let response = await write(await launcherCapability());
  if (response.status === 403) {
    const problem = (await response
      .clone()
      .json()
      .catch(() => undefined)) as Readonly<{ code?: unknown }> | undefined;
    if (problem?.code === 'control_capability_invalid') {
      response = await write(await launcherCapability(true));
    }
  }
  if (!response.ok) throw new Error('launcher_control_failed');
  return LauncherRuntimeStatusSchema.parse(await response.json());
}

export const runtimeCenterClient: RuntimeCenterClient = {
  async getProviderCatalog(input) {
    return (
      await apiRequest(`/api/v1/ai-runtime/providers${input?.refresh ? '?refresh=true' : ''}`, {
        schema: ProviderCatalogSchema,
      })
    ).data;
  },
  async startCodexLogin() {
    return (
      await apiRequest('/api/v1/ai-runtime/providers/codex-cli/login', {
        method: 'POST',
        body: {},
        schema: CodexLoginStartResponseSchema,
      })
    ).data;
  },
  async getProviderStatus() {
    return (
      await apiRequest('/api/v1/ai-runtime/status', {
        schema: ProviderRuntimeStatusSchema,
      })
    ).data;
  },
  async createDiagnostics(command) {
    const response = (
      await apiRequest('/api/v1/runtime/diagnostics', {
        method: 'POST',
        body: {},
        schema: RuntimeDiagnosticsResponseSchema,
        command,
      })
    ).data;
    return { diagnosticId: response.artifactRef };
  },
  reconnect: () => controlWrite('reconnect'),
  async waitUntilReady() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1_000);
      try {
        const readiness = await fetchRuntimeReadiness(controller.signal);
        if (readiness.status === 'ready') return readiness;
      } catch {
        // The verified server can be unavailable while Launcher replaces it.
      } finally {
        clearTimeout(timeout);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('runtime_ready_timeout');
  },
  async refreshAi() {
    await controlWrite('sync-frontend');
  },
  async reconnectAi() {
    return (
      await apiRequest('/api/v1/ai-runtime/reconnect', {
        method: 'POST',
        body: {},
        schema: ProviderRuntimeStatusSchema,
      })
    ).data;
  },
  async switchProvider(input, command) {
    const body = ProviderSwitchRequestSchema.parse(input);
    return (
      await apiRequest('/api/v1/ai-runtime/provider-switches', {
        method: 'POST',
        body,
        schema: ProviderSwitchResponseSchema,
        command,
      })
    ).data;
  },
};
