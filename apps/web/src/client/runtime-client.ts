import {
  ProviderSwitchRequestSchema,
  ProviderSwitchResponseSchema,
  RuntimeReadySchema,
  type ProviderSwitchRequest,
  type ProviderSwitchResponse,
  type RuntimeReady,
} from '@learning-more/contracts';

import { apiRequest, type CommandAttempt } from './api-client.js';

export async function fetchRuntimeReadiness(signal: AbortSignal): Promise<RuntimeReady> {
  const response = await fetch('/api/v1/runtime/ready', {
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error('Runtime readiness request failed');
  }
  return RuntimeReadySchema.parse(await response.json());
}

export interface RuntimeCenterClient {
  reconnect(): Promise<unknown>;
  waitUntilReady(): Promise<RuntimeReady>;
  refreshAi(): Promise<void>;
  switchProvider(
    input: ProviderSwitchRequest,
    command: CommandAttempt,
  ): Promise<ProviderSwitchResponse>;
}

async function launcherCapability(): Promise<string> {
  const storageKey = 'learning-more.launcher-capability';
  const expiryKey = 'learning-more.launcher-capability-expires-at';
  const fragment = new URLSearchParams(globalThis.location?.hash.slice(1) ?? '');
  const supplied = fragment.get('launcher-capability');
  if (supplied !== null && supplied !== '') {
    sessionStorage.setItem(storageKey, supplied);
    sessionStorage.setItem(expiryKey, String(Date.now() + 60_000));
    fragment.delete('launcher-capability');
    const suffix = fragment.toString();
    history.replaceState(
      null,
      '',
      `${location.pathname}${location.search}${suffix ? `#${suffix}` : ''}`,
    );
    return supplied;
  }
  const stored = sessionStorage.getItem(storageKey);
  const storedExpiry = Number(sessionStorage.getItem(expiryKey));
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
  const status = (await response.json()) as { capability?: unknown; capabilityExpiresAt?: unknown };
  if (typeof status.capability !== 'string' || status.capability === '') {
    throw new Error('launcher_capability_missing');
  }
  sessionStorage.setItem(storageKey, status.capability);
  if (typeof status.capabilityExpiresAt === 'number') {
    sessionStorage.setItem(expiryKey, String(status.capabilityExpiresAt));
  }
  return status.capability;
}

async function controlWrite(path: 'reconnect' | 'sync-frontend'): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:43119/control/v1/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-learning-more-capability': await launcherCapability(),
    },
    body: '{}',
  });
  if (!response.ok) throw new Error('launcher_control_failed');
  return response.json();
}

export const runtimeCenterClient: RuntimeCenterClient = {
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
