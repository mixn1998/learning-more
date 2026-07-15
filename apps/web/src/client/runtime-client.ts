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
  WebBuildMetaSchema,
  WorkspaceActivationProgressSchema,
  type ProviderSwitchRequest,
  type ProviderSwitchResponse,
  type ProviderRuntimeStatus,
  type ProviderCatalog,
  type CodexLoginStartResponse,
  type LauncherRuntimeStatus,
  type RuntimeReady,
  type WebBuildMeta,
  type WorkspaceActivationProgress,
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
  waitUntilReady(targetBuildId?: string): Promise<RuntimeReady>;
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
const terminalActivationErrors = new Set([
  'source_identity_unavailable',
  'workspace_identity_changed',
  'candidate_build_failed',
  'candidate_stage_failed',
  'candidate_verification_failed',
  'activation_rolled_back',
  'host_unavailable',
  'host_identity_mismatch',
  'external_port_owner',
  'runtime_ready_timeout',
  'served_web_build_mismatch',
]);

export class RuntimeActivationClientError extends Error {
  constructor(
    code: string,
    readonly activation?: WorkspaceActivationProgress,
    readonly oldRuntimeAvailable?: boolean,
  ) {
    super(code);
  }
}

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

export async function fetchLauncherStatus(): Promise<LauncherRuntimeStatus> {
  const response = await fetch('http://127.0.0.1:43119/control/v1/status', {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('launcher_status_unavailable');
  const control = LauncherControlStatusSchema.parse(await response.json());
  sessionStorage.setItem(launcherCapabilityStorageKey, control.capability);
  sessionStorage.setItem(launcherCapabilityExpiryKey, String(control.capabilityExpiresAt));
  const status: Record<string, unknown> = { ...control };
  delete status.capability;
  delete status.capabilityExpiresAt;
  return LauncherRuntimeStatusSchema.parse(status);
}

export async function fetchServedWebBuild(): Promise<WebBuildMeta> {
  const response = await fetch(`/build-meta.json?operation=${Date.now()}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('served_web_identity_unavailable');
  return WebBuildMetaSchema.parse(await response.json());
}

export async function verifyRuntimeActivation(
  targetBuildId: string,
  readiness: RuntimeReady,
): Promise<void> {
  const [launcher, web] = await Promise.all([fetchLauncherStatus(), fetchServedWebBuild()]);
  const activationMatches =
    launcher.activation === undefined
      ? launcher.state === 'healthy'
      : launcher.activation.phase === 'activated' &&
        (launcher.activation.activeBuildId ?? launcher.targetBuildId) === targetBuildId;
  if (!activationMatches || readiness.buildId !== targetBuildId) {
    throw new Error('runtime_build_mismatch');
  }
  if (web.buildId !== targetBuildId || web.protocolVersion !== readiness.protocolVersion) {
    throw new Error('served_web_build_mismatch');
  }
}

async function recoverControlWrite(previousRequestId?: string): Promise<LauncherRuntimeStatus> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const status = await fetchLauncherStatus();
      if (
        (status.activation !== undefined && status.activation.requestId !== previousRequestId) ||
        (previousRequestId === undefined &&
          (status.state === 'rebuilding' || status.state === 'activation_failed'))
      ) {
        return status;
      }
    } catch {
      // The old Launcher can exit after accepting the request and before sending the response.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('launcher_control_failed');
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
  const baseline = await fetchLauncherStatus();
  const capability = await launcherCapability();
  let response: Response;
  try {
    response = await write(capability);
  } catch {
    clearLauncherCapability();
    return recoverControlWrite(baseline.activation?.requestId);
  }
  if (response.status === 403) {
    const problem = (await response
      .clone()
      .json()
      .catch(() => undefined)) as Readonly<{ code?: unknown }> | undefined;
    if (problem?.code === 'control_capability_invalid') {
      response = await write(await launcherCapability(true));
    }
  }
  if (!response.ok) {
    const problem = (await response.json().catch(() => undefined)) as
      | Readonly<{
          code?: unknown;
          activation?: unknown;
          oldRuntimeAvailable?: unknown;
        }>
      | undefined;
    const code =
      typeof problem?.code === 'string' && /^[a-z0-9_]+$/u.test(problem.code)
        ? problem.code
        : 'launcher_control_failed';
    const activation = WorkspaceActivationProgressSchema.safeParse(problem?.activation);
    throw new RuntimeActivationClientError(
      code,
      activation.success ? activation.data : undefined,
      typeof problem?.oldRuntimeAvailable === 'boolean' ? problem.oldRuntimeAvailable : undefined,
    );
  }
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
  async waitUntilReady(targetBuildId) {
    const deadline = Date.now() + (targetBuildId === undefined ? 10_000 : 21 * 60_000);
    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1_000);
      try {
        const [launcher, readiness] = await Promise.all([
          fetchLauncherStatus(),
          fetchRuntimeReadiness(controller.signal),
        ]);
        if (
          launcher.activation?.phase === 'failed' &&
          (targetBuildId === undefined ||
            launcher.activation.targetBuildId === targetBuildId ||
            launcher.targetBuildId === targetBuildId)
        ) {
          throw new RuntimeActivationClientError(
            launcher.activation.errorCode ?? 'candidate_build_failed',
            launcher.activation,
            launcher.activation.activeBuildId !== undefined,
          );
        }
        const activationReady =
          targetBuildId === undefined
            ? launcher.state === 'healthy'
            : launcher.activation?.phase === 'activated' &&
              (launcher.activation.activeBuildId ?? launcher.targetBuildId) === targetBuildId;
        if (
          activationReady &&
          readiness.status === 'ready' &&
          (targetBuildId === undefined || readiness.buildId === targetBuildId)
        ) {
          return readiness;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (terminalActivationErrors.has(error.message) || error.name === 'ZodError')
        ) {
          throw error;
        }
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
