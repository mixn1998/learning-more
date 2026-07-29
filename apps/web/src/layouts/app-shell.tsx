import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { Badge, Button, StatusBanner, type StatusBannerStatus } from '@learning-more/ui/lite';

import {
  fetchLauncherStatus,
  fetchRuntimeReadiness,
  fetchServedWebBuild,
  runtimeCenterClient,
  verifyRuntimeActivation,
} from '../client/runtime-client.js';
import {
  AppShellBrandSubtitleContext,
  AppShellHeaderStatusContext,
  type AppShellHeaderStatus,
} from '../state/app-shell-header.js';
import {
  evaluateRuntimeVersion,
  RuntimeStateContext,
  type RuntimeUiState,
} from '../state/version-guard.js';
import {
  createRuntimeRecoveryCoordinator,
  type RuntimeRecoverySnapshot,
} from '../state/runtime-recovery-coordinator.js';
import { BrandIdentity } from '../components/brand/brand-identity.js';

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
    state.readiness.providerStatus === 'degraded' ||
    state.readiness.providerStatus === 'unconfigured'
  ) {
    return 'degraded';
  }
  if (state.readiness.status === 'rebuilding') {
    return 'rebuilding';
  }
  return 'ready';
}

function statusMessage(
  state: RuntimeUiState,
  recovery?: RuntimeRecoverySnapshot,
): string | undefined {
  if (recovery?.kind === 'recovering') return '正在重连本地服务；页面输入已保留';
  if (recovery?.kind === 'failed') return '本地服务恢复失败；页面输入已保留';
  if (state.kind === 'loading') return '正在连接本地服务';
  if (state.kind === 'offline') return '无法连接本地服务；页面输入已保留';
  if (state.version.kind === 'protocol-mismatch') return '协议版本不兼容，写入已暂停';
  if (state.version.kind === 'build-mismatch') return '检测到新版本，请刷新页面后继续';
  return undefined;
}

function runtimeClass(status: StatusBannerStatus): string {
  return status === 'ready' ? 'ok' : status === 'rebuilding' ? 'warn' : 'error';
}

export function RuntimeStatusCards(props: {
  readonly providerLabel: string;
  readonly providerReady: boolean;
  readonly status: StatusBannerStatus;
  readonly recovering?: boolean;
}) {
  return (
    <div className="lm-global-runtime">
      <NavLink
        className={`lm-runtime-button ${props.providerReady ? 'ok' : 'error'}`}
        to="/runtime"
      >
        <span aria-hidden="true" className="lm-runtime-dot" />
        <span>
          <b>AI 接口 · {props.providerLabel}</b>
          <small>{props.providerReady ? '连接正常' : '需要配置或重连'}</small>
        </span>
      </NavLink>
      <NavLink className={`lm-runtime-button ${runtimeClass(props.status)}`} to="/runtime">
        <span aria-hidden="true" className="lm-runtime-dot" />
        <span>
          <b>
            本地服务 ·{' '}
            {props.status === 'ready'
              ? '准备就绪'
              : props.recovering
                ? '重连中'
                : props.status === 'rebuilding'
                  ? '重建中'
                  : '需要处理'}
          </b>
          <small>
            {props.status === 'ready'
              ? '实例与版本已核验'
              : props.recovering
                ? '正在恢复本地服务'
                : props.status === 'rebuilding'
                  ? '正在重建数据'
                  : '打开运行中心查看'}
          </small>
        </span>
      </NavLink>
    </div>
  );
}

export function AppShellView(props: {
  readonly state: RuntimeUiState;
  readonly refresh: () => void | Promise<RuntimeUiState>;
  readonly recovery?: RuntimeRecoverySnapshot;
  readonly recover?: () => Promise<void>;
  readonly children?: ReactNode;
  readonly providerLabel?: string;
  readonly brandSubtitle?: string;
  readonly headerBeforeStatus?: ReactNode;
  readonly headerTrailing?: ReactNode;
  readonly headerStatus?: AppShellHeaderStatus;
}) {
  const location = useLocation();
  const [routeHeaderStatus, setRouteHeaderStatus] = useState<AppShellHeaderStatus>();
  const [routeBrandSubtitle, setRouteBrandSubtitle] = useState<string>();
  const context = useMemo(
    () => ({
      state: props.state,
      refresh: props.refresh,
      ...(props.recovery === undefined ? {} : { recovery: props.recovery }),
      ...(props.recover === undefined ? {} : { recover: props.recover }),
    }),
    [props.recover, props.recovery, props.refresh, props.state],
  );
  const status =
    props.recovery?.kind === 'recovering'
      ? 'rebuilding'
      : props.recovery?.kind === 'failed'
        ? 'degraded'
        : bannerStatus(props.state);
  const providerReady =
    props.state.kind === 'loaded' && props.state.readiness.providerStatus === 'ready';
  const writesAllowed =
    props.state.kind === 'loaded' &&
    props.state.version.writesAllowed &&
    props.state.readiness.status === 'ready' &&
    props.state.readiness.storeStatus === 'ready' &&
    props.state.readiness.providerStatus === 'ready' &&
    props.recovery?.kind !== 'recovering';
  const headerStatus = props.headerStatus ?? routeHeaderStatus;
  const isCourseDetailRoute =
    location.pathname.startsWith('/courses/') &&
    location.pathname !== '/courses/new' &&
    !location.pathname.startsWith('/courses/new/');
  const isWeeklyReportRoute =
    location.pathname === '/history' &&
    new URLSearchParams(location.search).get('tab') === 'weekly';

  return (
    <RuntimeStateContext.Provider value={context}>
      <div className="lm-app-frame">
        <header className="lm-app-header lm-topbar">
          <NavLink aria-label="Learning MORE 主页" className="lm-app-brand lm-brand" to="/">
            <BrandIdentity
              subtitle={
                props.brandSubtitle ?? routeBrandSubtitle ?? '学习即生活｜用 AI 重塑学习方式'
              }
            />
          </NavLink>
          <div aria-label="运行状态" className="lm-topbar-tools">
            <RuntimeStatusCards
              providerLabel={props.providerLabel ?? '检测中'}
              providerReady={providerReady}
              recovering={props.recovery?.kind === 'recovering'}
              status={status}
            />
            {props.headerBeforeStatus}
            {location.pathname === '/' ||
            location.pathname === '/planning' ||
            isCourseDetailRoute ||
            isWeeklyReportRoute ? null : (
              <NavLink className="lm-btn" to="/">
                返回主页
              </NavLink>
            )}
            {headerStatus === undefined ? null : (
              <Badge className="lm-shell-route-status" tone={headerStatus.tone}>
                {headerStatus.text}
              </Badge>
            )}
            {props.headerTrailing}
          </div>
        </header>
        <div className="lm-app-body">
          {status === 'ready' ? null : (
            <StatusBanner
              status={status}
              {...(statusMessage(props.state, props.recovery) === undefined
                ? {}
                : { message: statusMessage(props.state, props.recovery)! })}
            />
          )}
          {props.state.kind === 'offline' ? (
            <Button type="button" onClick={props.refresh}>
              重试连接
            </Button>
          ) : null}
          <AppShellBrandSubtitleContext.Provider value={setRouteBrandSubtitle}>
            <AppShellHeaderStatusContext.Provider value={setRouteHeaderStatus}>
              <fieldset
                className="runtime-write-boundary"
                disabled={!writesAllowed && location.pathname !== '/runtime'}
              >
                {props.children ?? <Outlet />}
              </fieldset>
            </AppShellHeaderStatusContext.Provider>
          </AppShellBrandSubtitleContext.Provider>
        </div>
      </div>
    </RuntimeStateContext.Provider>
  );
}

export function AppShell() {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<RuntimeUiState>({ kind: 'loading' });
  const [providerLabel, setProviderLabel] = useState('检测中');
  const recoveredBuildIdRef = useRef<string | undefined>(undefined);
  const recoveryCoordinator = useMemo(() => createRuntimeRecoveryCoordinator(), []);
  const [recovery, setRecovery] = useState(recoveryCoordinator.snapshot());
  const refresh = useCallback(() => setRequestVersion((current) => current + 1), []);

  useEffect(() => recoveryCoordinator.subscribe(setRecovery), [recoveryCoordinator]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchRuntimeReadiness(controller.signal).then(
      (readiness) => {
        const version = evaluateRuntimeVersion(readiness, clientIdentity, {
          recoveredBuildId: recoveredBuildIdRef.current,
        });
        if (version.kind === 'compatible') {
          recoveryCoordinator.reconcileReadiness(readiness);
        }
        setState({
          kind: 'loaded',
          readiness,
          version,
        });
      },
      () => {
        if (!controller.signal.aborted && recoveryCoordinator.shouldTreatProbeFailureAsOffline()) {
          setState({ kind: 'offline' });
        }
      },
    );
    void runtimeCenterClient.getProviderStatus().then(
      (provider) => setProviderLabel(provider.providerId),
      () => {
        if (!controller.signal.aborted) setProviderLabel('未配置');
      },
    );
    return () => controller.abort();
  }, [recoveryCoordinator, requestVersion]);

  const recover = useCallback(async () => {
    let targetBuildId: string | undefined;
    await recoveryCoordinator.recover({
      verify: async () => {
        await fetchLauncherStatus();
        await fetchServedWebBuild().catch(() => undefined);
      },
      reconnect: async () => {
        const status = await runtimeCenterClient.reconnect();
        targetBuildId = status.targetBuildId;
        return status;
      },
      waitUntilReady: (target) => runtimeCenterClient.waitUntilReady(target),
      verifyActivated: verifyRuntimeActivation,
      refreshRuntime: async (readiness) => {
        const recoveredBuildId =
          readiness.protocolVersion === clientIdentity.protocolVersion &&
          readiness.buildId !== clientIdentity.buildId
            ? readiness.buildId
            : undefined;
        recoveredBuildIdRef.current = recoveredBuildId;
        setState({
          kind: 'loaded',
          readiness,
          version: evaluateRuntimeVersion(readiness, clientIdentity, { recoveredBuildId }),
        });
      },
      refreshAi: async () => {
        const provider = await runtimeCenterClient.getProviderStatus();
        setProviderLabel(provider.providerId);
      },
    });
    if (targetBuildId !== undefined && targetBuildId !== clientIdentity.buildId) {
      globalThis.location.reload();
    }
  }, [recoveryCoordinator]);

  useEffect(() => {
    const timer = setInterval(refresh, 2_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <AppShellView
      providerLabel={providerLabel}
      recover={recover}
      recovery={recovery}
      refresh={refresh}
      state={state}
    />
  );
}
