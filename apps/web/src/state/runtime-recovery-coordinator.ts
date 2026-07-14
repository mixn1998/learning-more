import type { RuntimeReady } from '@learning-more/contracts';

export type RuntimeRecoveryStage = 'verifying' | 'reconnecting' | 'waiting' | 'refreshing';

export type RuntimeRecoverySnapshot =
  | Readonly<{ kind: 'idle'; operationId: number; aiRecoveryFailed: false }>
  | Readonly<{
      kind: 'recovering';
      operationId: number;
      stage: RuntimeRecoveryStage;
      aiRecoveryFailed: false;
    }>
  | Readonly<{
      kind: 'completed';
      operationId: number;
      readiness: RuntimeReady;
      aiRecoveryFailed: boolean;
    }>
  | Readonly<{
      kind: 'failed';
      operationId: number;
      reason: string;
      aiRecoveryFailed: false;
    }>;

export type RuntimeRecoveryDependencies = Readonly<{
  verify(): Promise<void>;
  reconnect(): Promise<Readonly<{ targetBuildId?: string | undefined }>>;
  waitUntilReady(targetBuildId?: string): Promise<RuntimeReady>;
  refreshRuntime(readiness: RuntimeReady): Promise<void>;
  refreshAi(): Promise<void>;
}>;

export interface RuntimeRecoveryCoordinator {
  snapshot(): RuntimeRecoverySnapshot;
  subscribe(listener: (snapshot: RuntimeRecoverySnapshot) => void): () => void;
  recover(dependencies: RuntimeRecoveryDependencies): Promise<void>;
  reconcileReadiness(readiness: RuntimeReady): void;
  shouldTreatProbeFailureAsOffline(): boolean;
}

function errorReason(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'runtime_recovery_failed';
}

export function createRuntimeRecoveryCoordinator(): RuntimeRecoveryCoordinator {
  let current: RuntimeRecoverySnapshot = {
    kind: 'idle',
    operationId: 0,
    aiRecoveryFailed: false,
  };
  const listeners = new Set<(snapshot: RuntimeRecoverySnapshot) => void>();

  const publish = (snapshot: RuntimeRecoverySnapshot) => {
    current = snapshot;
    for (const listener of listeners) listener(snapshot);
  };

  const publishStage = (operationId: number, stage: RuntimeRecoveryStage) => {
    if (current.operationId > operationId) return false;
    publish({ kind: 'recovering', operationId, stage, aiRecoveryFailed: false });
    return true;
  };

  return {
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    async recover(dependencies) {
      const operationId = current.operationId + 1;
      publishStage(operationId, 'verifying');
      try {
        await dependencies.verify();
        if (!publishStage(operationId, 'reconnecting')) return;
        const reconnect = await dependencies.reconnect();
        if (!publishStage(operationId, 'waiting')) return;
        const readiness = await dependencies.waitUntilReady(reconnect.targetBuildId);
        if (!publishStage(operationId, 'refreshing')) return;
        await dependencies.refreshRuntime(readiness);
        let aiRecoveryFailed = false;
        try {
          await dependencies.refreshAi();
        } catch {
          aiRecoveryFailed = true;
        }
        if (current.operationId === operationId) {
          publish({ kind: 'completed', operationId, readiness, aiRecoveryFailed });
        }
      } catch (error) {
        if (current.operationId === operationId) {
          publish({
            kind: 'failed',
            operationId,
            reason: errorReason(error),
            aiRecoveryFailed: false,
          });
        }
        throw error;
      }
    },
    reconcileReadiness(readiness) {
      if (
        current.kind === 'failed' &&
        readiness.status === 'ready' &&
        readiness.storeStatus === 'ready' &&
        readiness.projectionStatus === 'ready'
      ) {
        publish({
          kind: 'completed',
          operationId: current.operationId,
          readiness,
          aiRecoveryFailed: false,
        });
      }
    },
    shouldTreatProbeFailureAsOffline() {
      return current.kind !== 'recovering';
    },
  };
}
