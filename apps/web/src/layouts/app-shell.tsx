import { StatusBanner, type StatusBannerStatus } from '@learning-more/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { fetchRuntimeReadiness } from '../client/runtime-client.js';
import {
  evaluateRuntimeVersion,
  RuntimeStateContext,
  type RuntimeUiState,
} from '../state/version-guard.js';

const clientIdentity = {
  buildId: import.meta.env.VITE_BUILD_ID ?? 'development',
  protocolVersion: '1',
} as const;

function bannerStatus(state: RuntimeUiState): StatusBannerStatus {
  if (state.kind !== 'loaded') return state.kind === 'loading' ? 'rebuilding' : 'degraded';
  if (state.version.kind !== 'compatible') return 'degraded';
  if (
    state.readiness.status === 'degraded' ||
    state.readiness.storeStatus === 'degraded' ||
    state.readiness.projectionStatus === 'degraded'
  ) {
    return 'degraded';
  }
  if (
    state.readiness.status === 'rebuilding' ||
    state.readiness.projectionStatus === 'rebuilding'
  ) {
    return 'rebuilding';
  }
  return 'ready';
}

function statusMessage(state: RuntimeUiState): string | undefined {
  if (state.kind === 'loading') return '正在连接本地服务';
  if (state.kind === 'offline') return '无法连接本地服务；页面输入已保留';
  if (state.version.kind === 'protocol-mismatch') return '协议版本不兼容，写入已暂停';
  if (state.version.kind === 'build-mismatch') return '检测到新版本，请刷新页面后继续';
  return undefined;
}

export function AppShell() {
  const location = useLocation();
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<RuntimeUiState>({ kind: 'loading' });
  const refresh = useCallback(() => setRequestVersion((current) => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchRuntimeReadiness(controller.signal).then(
      (readiness) =>
        setState({
          kind: 'loaded',
          readiness,
          version: evaluateRuntimeVersion(readiness, clientIdentity),
        }),
      () => {
        if (!controller.signal.aborted) setState({ kind: 'offline' });
      },
    );
    return () => controller.abort();
  }, [requestVersion]);

  useEffect(() => {
    const timer = setInterval(refresh, 2_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const writesAllowed =
    state.kind === 'loaded' &&
    state.version.writesAllowed &&
    state.readiness.status === 'ready' &&
    state.readiness.storeStatus === 'ready' &&
    state.readiness.projectionStatus === 'ready';
  const context = useMemo(() => ({ state, refresh }), [refresh, state]);

  return (
    <RuntimeStateContext.Provider value={context}>
      <div className="global-shell">
        <header className="global-header">
          <NavLink className="brand" to="/">
            Learning MORE
          </NavLink>
          <nav aria-label="主导航">
            <NavLink to="/courses/new">创建课程</NavLink>
            <NavLink to="/planning">排期</NavLink>
            <NavLink to="/history">历史</NavLink>
            <NavLink to="/profile">画像</NavLink>
            <NavLink to="/runtime">运行中心</NavLink>
          </nav>
        </header>
        <StatusBanner
          status={bannerStatus(state)}
          {...(statusMessage(state) === undefined ? {} : { message: statusMessage(state)! })}
        />
        {state.kind === 'offline' ? (
          <button type="button" onClick={refresh}>
            重试连接
          </button>
        ) : null}
        <fieldset
          className="runtime-write-boundary"
          disabled={!writesAllowed && location.pathname !== '/runtime'}
        >
          <Outlet />
        </fieldset>
      </div>
    </RuntimeStateContext.Provider>
  );
}
