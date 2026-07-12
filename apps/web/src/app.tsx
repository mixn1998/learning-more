import type { RuntimeReady } from '@learning-more/contracts';
import { StatusBanner, type StatusBannerStatus } from '@learning-more/ui';
import { useEffect, useState } from 'react';

import { fetchRuntimeReadiness } from './client/runtime-client.js';

type RuntimeViewState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'loaded'; readiness: RuntimeReady }>
  | Readonly<{ kind: 'error' }>;

function bannerStatus(readiness: RuntimeReady): StatusBannerStatus {
  if (
    readiness.status === 'degraded' ||
    readiness.storeStatus === 'degraded' ||
    readiness.projectionStatus === 'degraded'
  ) {
    return 'degraded';
  }
  if (readiness.status === 'rebuilding' || readiness.projectionStatus === 'rebuilding') {
    return 'rebuilding';
  }
  return 'ready';
}

export function App() {
  const [requestVersion, setRequestVersion] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeViewState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setRuntime({ kind: 'loading' });
    void fetchRuntimeReadiness(controller.signal).then(
      (readiness) => setRuntime({ kind: 'loaded', readiness }),
      () => {
        if (!controller.signal.aborted) setRuntime({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [requestVersion]);

  return (
    <main className="app-shell">
      <p className="eyebrow">本地优先学习系统</p>
      <h1>Learning MORE</h1>
      {runtime.kind === 'loading' ? (
        <StatusBanner message="正在连接本地服务" status="rebuilding" />
      ) : null}
      {runtime.kind === 'loaded' ? <StatusBanner status={bannerStatus(runtime.readiness)} /> : null}
      {runtime.kind === 'error' ? (
        <section className="runtime-error">
          <StatusBanner message="无法连接本地服务" status="degraded" />
          <button type="button" onClick={() => setRequestVersion((current) => current + 1)}>
            重试连接
          </button>
        </section>
      ) : null}
    </main>
  );
}
