import type { RuntimeReady } from '@learning-more/contracts';
import { createContext, useContext } from 'react';

import type { RuntimeRecoverySnapshot } from './runtime-recovery-coordinator.js';

export type RuntimeVersionState =
  | Readonly<{ kind: 'compatible'; writesAllowed: true }>
  | Readonly<{ kind: 'protocol-mismatch'; writesAllowed: false }>
  | Readonly<{ kind: 'build-mismatch'; writesAllowed: false }>;

export type RuntimeUiState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'offline' }>
  | Readonly<{
      kind: 'loaded';
      readiness: RuntimeReady;
      version: RuntimeVersionState;
    }>;

export function evaluateRuntimeVersion(
  readiness: RuntimeReady,
  client: Readonly<{ buildId: string; protocolVersion: string }>,
  options: Readonly<{ recoveredBuildId?: string | undefined }> = {},
): RuntimeVersionState {
  if (readiness.protocolVersion !== client.protocolVersion) {
    return { kind: 'protocol-mismatch', writesAllowed: false };
  }
  if (readiness.buildId !== client.buildId) {
    if (options.recoveredBuildId === readiness.buildId) {
      return { kind: 'compatible', writesAllowed: true };
    }
    return { kind: 'build-mismatch', writesAllowed: false };
  }
  return { kind: 'compatible', writesAllowed: true };
}

export type RuntimeStateContextValue = Readonly<{
  state: RuntimeUiState;
  refresh(): void | Promise<RuntimeUiState>;
  recovery?: RuntimeRecoverySnapshot;
  recover?(): Promise<void>;
}>;

export const RuntimeStateContext = createContext<RuntimeStateContextValue>({
  state: { kind: 'loading' },
  refresh() {},
});

export function useRuntimeState(): RuntimeStateContextValue {
  return useContext(RuntimeStateContext);
}
