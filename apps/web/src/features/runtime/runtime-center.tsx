import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ProviderCatalog, ProviderRuntimeStatus } from '@learning-more/contracts';
import { Dialog, tabId, tabPanelId, Tabs } from '@learning-more/ui';

import { runtimeCenterClient, type RuntimeCenterClient } from '../../client/runtime-client.js';
import { useCommandAttempts } from '../../state/use-command-attempt.js';
import { useRuntimeState } from '../../state/version-guard.js';
import './runtime-center.css';

type Stage =
  'idle' | 'verifying' | 'reconnecting' | 'waiting' | 'refreshing' | 'completed' | 'failed';
type ProviderConnectionState = 'connecting' | 'connected' | 'error';

const runtimeTabsIdPrefix = 'runtime-center';

function waitFor(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function stageLabel(
  current: Stage,
  stage: Exclude<Stage, 'idle' | 'completed' | 'failed'>,
): string {
  const order = ['verifying', 'reconnecting', 'waiting', 'refreshing'] as const;
  if (current === 'completed') return '完成';
  if (current === 'failed') return '需处理';
  const currentIndex = order.indexOf(current as (typeof order)[number]);
  const stageIndex = order.indexOf(stage);
  if (currentIndex > stageIndex) return '完成';
  return current === stage ? '进行中' : '待执行';
}

export function RuntimeCenter({
  api = runtimeCenterClient,
  pollIntervalMs = 5_000,
}: {
  api?: RuntimeCenterClient;
  pollIntervalMs?: number;
}) {
  const { state, refresh, recovery, recover: recoverRuntime } = useRuntimeState();
  const navigate = useNavigate();
  const closeRuntimeCenter = () => navigate(-1);
  const [activeTab, setActiveTab] = useState<'ai' | 'service'>('ai');
  const [stage, setStage] = useState<Stage>('idle');
  const [providerId, setProviderId] = useState('mock');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [apiKeyHandle, setApiKeyHandle] = useState('');
  const [providerSwitchState, setProviderSwitchState] = useState<'idle' | 'saved' | 'failed'>(
    'idle',
  );
  const [providerStatus, setProviderStatus] = useState<ProviderRuntimeStatus>();
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog>({ providers: [] });
  const [providerConnectionState, setProviderConnectionState] =
    useState<ProviderConnectionState>('connecting');
  const [lastProviderSyncAt, setLastProviderSyncAt] = useState<Date>();
  const [loginState, setLoginState] = useState<'idle' | 'starting' | 'waiting' | 'failed'>('idle');
  const [aiRecoveryFailed, setAiRecoveryFailed] = useState(false);
  const loginAbort = useRef<AbortController | undefined>(undefined);
  const manualProviderOperation = useRef(false);
  const [diagnosticsState, setDiagnosticsState] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'creating' }
    | { readonly kind: 'created'; readonly diagnosticId: string }
    | { readonly kind: 'failed' }
  >({ kind: 'idle' });
  const commands = useCommandAttempts();
  const visibleStage: Stage =
    recovery === undefined || recovery.kind === 'idle'
      ? stage
      : recovery.kind === 'recovering'
        ? recovery.stage
        : recovery.kind === 'completed'
          ? 'completed'
          : 'failed';

  useEffect(() => {
    let cancelled = false;
    let initialized = false;
    let polling = false;
    const synchronize = async () => {
      if (polling || manualProviderOperation.current) return;
      polling = true;
      try {
        const [status, catalog] = await Promise.all([
          api.getProviderStatus(),
          api.getProviderCatalog(),
        ]);
        if (cancelled) return;
        setProviderStatus(status);
        setProviderCatalog(catalog);
        if (!initialized) {
          setProviderId(status.providerId);
          const catalogProvider = catalog.providers.find(
            (entry) => entry.providerId === status.providerId,
          );
          const catalogModel = catalogProvider?.models.find(
            (candidate) => candidate.id === status.model,
          );
          const fallbackModel = catalogProvider?.models[0];
          setModel(status.model ?? fallbackModel?.id ?? '');
          setReasoningEffort(
            status.reasoningEffort ??
              catalogModel?.defaultReasoningEffort ??
              fallbackModel?.defaultReasoningEffort ??
              '',
          );
          initialized = true;
        }
        setProviderConnectionState(
          status.configurationState === 'connecting'
            ? 'connecting'
            : status.configurationState === 'applied' && status.health.status === 'healthy'
              ? 'connected'
              : 'error',
        );
        setLastProviderSyncAt(new Date());
      } catch {
        if (!cancelled) setProviderConnectionState('error');
      } finally {
        polling = false;
      }
    };
    setProviderConnectionState('connecting');
    void synchronize();
    const interval = window.setInterval(() => void synchronize(), pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [api, pollIntervalMs]);

  useEffect(
    () => () => {
      loginAbort.current?.abort();
    },
    [],
  );

  const beginProviderOperation = () => {
    manualProviderOperation.current = true;
    setProviderConnectionState('connecting');
  };

  const completeProviderOperation = (succeeded: boolean) => {
    manualProviderOperation.current = false;
    setProviderConnectionState(succeeded ? 'connected' : 'error');
    if (succeeded) setLastProviderSyncAt(new Date());
  };

  const reconnect = async () => {
    setAiRecoveryFailed(false);
    if (recoverRuntime !== undefined) {
      try {
        await recoverRuntime();
        beginProviderOperation();
        try {
          const status =
            api.reconnectAi === undefined ? await api.getProviderStatus() : await api.reconnectAi();
          const catalog = await api.getProviderCatalog({ refresh: true });
          setProviderStatus(status);
          setProviderCatalog(catalog);
          completeProviderOperation(true);
        } catch {
          setAiRecoveryFailed(true);
          completeProviderOperation(false);
        }
      } catch {
        // The shared coordinator keeps the stable local failure state.
      }
      return;
    }
    try {
      setStage('verifying');
      if (state.kind !== 'loaded') throw new Error('runtime_identity_unavailable');
      setStage('reconnecting');
      await api.reconnect();
      setStage('waiting');
      await api.waitUntilReady();
      setStage('refreshing');
      beginProviderOperation();
      try {
        const status =
          api.reconnectAi === undefined ? await api.getProviderStatus() : await api.reconnectAi();
        const catalog = await api.getProviderCatalog({ refresh: true });
        setProviderStatus(status);
        setProviderCatalog(catalog);
        await api.refreshAi();
        completeProviderOperation(true);
      } catch {
        setAiRecoveryFailed(true);
        completeProviderOperation(false);
      }
      setStage('completed');
      refresh();
    } catch {
      setStage('failed');
    }
  };

  const switchProvider = async () => {
    const commandKey = `provider-switch:${providerId}:${model}:${apiKeyHandle}`;
    beginProviderOperation();
    try {
      await api.switchProvider(
        {
          providerId,
          publicConfig: {
            ...(model === '' ? {} : { model }),
            ...(baseUrl === '' ? {} : { baseUrl }),
            ...(providerId === 'codex-cli' ? { reasoningEffort } : {}),
          },
          secretHandles: apiKeyHandle === '' ? {} : { apiKey: apiKeyHandle },
        },
        commands.attemptFor(commandKey),
      );
      commands.complete(commandKey);
      setProviderSwitchState('saved');
      const [status, catalog] = await Promise.all([
        api.getProviderStatus(),
        api.getProviderCatalog({ refresh: true }),
      ]);
      setProviderStatus(status);
      setProviderCatalog(catalog);
      completeProviderOperation(true);
      refresh();
    } catch {
      setProviderSwitchState('failed');
      completeProviderOperation(false);
    }
  };

  const createDiagnostics = async () => {
    const commandKey = 'runtime-diagnostics';
    setDiagnosticsState({ kind: 'creating' });
    try {
      const result = await api.createDiagnostics(commands.attemptFor(commandKey));
      commands.complete(commandKey);
      setDiagnosticsState({ kind: 'created', diagnosticId: result.diagnosticId });
    } catch {
      setDiagnosticsState({ kind: 'failed' });
    }
  };

  const reconnectProvider = async () => {
    beginProviderOperation();
    try {
      const status =
        api.reconnectAi === undefined ? await api.getProviderStatus() : await api.reconnectAi();
      const catalog = await api.getProviderCatalog({ refresh: true });
      setProviderStatus(status);
      setProviderCatalog(catalog);
      setProviderId(status.providerId);
      setModel(status.model ?? '');
      setProviderSwitchState('saved');
      completeProviderOperation(true);
      refresh();
    } catch {
      setProviderSwitchState('failed');
      completeProviderOperation(false);
    }
  };

  const checkProvider = async () => {
    beginProviderOperation();
    try {
      const [status, catalog] = await Promise.all([
        api.getProviderStatus(),
        api.getProviderCatalog({ refresh: true }),
      ]);
      setProviderStatus(status);
      setProviderCatalog(catalog);
      setProviderSwitchState('saved');
      completeProviderOperation(true);
    } catch {
      setProviderSwitchState('failed');
      completeProviderOperation(false);
    }
  };

  const startCodexLogin = async () => {
    if (api.startCodexLogin === undefined) {
      setLoginState('failed');
      return;
    }
    loginAbort.current?.abort();
    const controller = new AbortController();
    loginAbort.current = controller;
    setLoginState('starting');
    beginProviderOperation();
    try {
      await api.startCodexLogin();
      setLoginState('waiting');
      for (let attempt = 0; attempt < 60 && !controller.signal.aborted; attempt += 1) {
        const catalog = await api.getProviderCatalog({ refresh: true });
        if (controller.signal.aborted) return;
        setProviderCatalog(catalog);
        const cli = catalog.providers.find((entry) => entry.providerId === 'codex-cli');
        if (cli?.health.status === 'healthy' && cli.models.length > 0) {
          const first = cli.models[0]!;
          setModel(first.id);
          setReasoningEffort(first.defaultReasoningEffort);
          setLoginState('idle');
          completeProviderOperation(true);
          return;
        }
        await waitFor(2_000, controller.signal);
      }
      if (!controller.signal.aborted) {
        setLoginState('failed');
        completeProviderOperation(false);
      }
    } catch {
      if (!controller.signal.aborted) {
        setLoginState('failed');
        completeProviderOperation(false);
      }
    }
  };

  const providerName =
    providerStatus?.providerId === 'codex-cli'
      ? 'Codex CLI'
      : providerStatus?.providerId === 'api'
        ? 'API-compatible'
        : providerStatus?.providerId === 'mock'
          ? 'Mock'
          : (providerStatus?.providerId ?? 'AI Provider');
  const providerConnecting = providerConnectionState === 'connecting';
  const providerSyncFailed = providerConnectionState === 'error';
  const providerHealthy =
    providerConnectionState === 'connected' && providerStatus?.health.status === 'healthy';
  const serviceRecovering = recovery?.kind === 'recovering';
  const serviceFailed = recovery?.kind === 'failed';
  const serviceReady =
    !serviceRecovering &&
    !serviceFailed &&
    state.kind === 'loaded' &&
    state.readiness.status === 'ready';
  const serviceStatusClass = serviceRecovering ? 'warn' : serviceReady ? 'ok' : 'error';
  const currentModel = providerStatus?.model ?? 'Provider 默认模型';
  const selectedCatalogProvider = providerCatalog.providers.find(
    (entry) => entry.providerId === providerId,
  );
  const selectedCatalogModel = selectedCatalogProvider?.models.find(
    (candidate) => candidate.id === model,
  );
  const selectedProviderHealthy = selectedCatalogProvider?.health.status === 'healthy';
  const selectedProviderActive = providerStatus?.providerId === providerId;
  const selectedProviderConnected =
    selectedProviderActive && selectedProviderHealthy && providerConnectionState === 'connected';
  const codexNeedsLogin =
    providerId === 'codex-cli' &&
    selectedCatalogProvider?.health.message === 'codex_cli_not_authenticated';
  const configStateText =
    selectedProviderActive && providerConnecting
      ? '正在同步当前 Provider 的真实状态'
      : providerId === 'codex-cli'
        ? selectedProviderHealthy
          ? selectedProviderActive
            ? '本地 CLI 已连接并通过检查'
            : '本地 CLI 可用，尚未连接为当前 Provider'
          : codexNeedsLogin
            ? '需要完成 Codex 账号验证'
            : selectedCatalogProvider === undefined
              ? '未发现可执行的 Codex CLI'
              : '本地 CLI 未通过检查'
        : providerId === 'api'
          ? providerStatus?.providerId === providerId && providerHealthy
            ? 'API 配置已通过检查'
            : 'API 配置修改后需要验证'
          : providerStatus?.providerId === providerId && providerHealthy
            ? 'Mock 确定性检查通过'
            : '切换后执行确定性检查';

  const selectProvider = (nextProviderId: string) => {
    setProviderId(nextProviderId);
    const catalogProvider = providerCatalog.providers.find(
      (entry) => entry.providerId === nextProviderId,
    );
    const firstModel = catalogProvider?.models[0];
    if (nextProviderId === 'codex-cli') {
      const appliedModel =
        providerStatus?.providerId === nextProviderId
          ? catalogProvider?.models.find((candidate) => candidate.id === providerStatus.model)
          : undefined;
      const nextModel = appliedModel ?? firstModel;
      const appliedReasoningEffort =
        appliedModel !== undefined &&
        providerStatus?.reasoningEffort !== undefined &&
        appliedModel.supportedReasoningEfforts.includes(providerStatus.reasoningEffort)
          ? providerStatus.reasoningEffort
          : undefined;
      setModel(nextModel?.id ?? '');
      setReasoningEffort(appliedReasoningEffort ?? nextModel?.defaultReasoningEffort ?? '');
    } else if (nextProviderId === 'mock') {
      setModel('');
      setReasoningEffort('');
    }
  };

  const providerCatalogEntry = (candidateProviderId: string) =>
    providerCatalog.providers.find((entry) => entry.providerId === candidateProviderId);

  const providerStateLabel = (candidateProviderId: string) => {
    if (providerStatus?.providerId === candidateProviderId) {
      if (providerConnecting) return '连接中';
      return providerStatus.health.status === 'healthy' ? '当前使用' : '连接异常';
    }
    const entry = providerCatalogEntry(candidateProviderId);
    if (entry?.health.status === 'healthy') return '可用 · 未连接';
    if (entry?.health.message === 'codex_cli_not_authenticated') return '待登录';
    return entry === undefined ? '未发现' : '不可用';
  };

  const providerStateClass = (candidateProviderId: string) => {
    const entry = providerCatalogEntry(candidateProviderId);
    if (providerStatus?.providerId === candidateProviderId) {
      if (providerConnecting) return ' warn';
      return providerStatus.health.status === 'healthy' ? ' ok' : '';
    }
    if (entry?.health.status === 'healthy') return '';
    return candidateProviderId === 'api' || entry !== undefined ? ' warn' : '';
  };

  const providerConnectionLabel = providerConnecting
    ? '连接中'
    : providerSyncFailed
      ? '同步失败'
      : providerHealthy
        ? '已连接'
        : '连接异常';
  const lastProviderSyncLabel =
    lastProviderSyncAt === undefined
      ? '尚未完成'
      : lastProviderSyncAt.toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <Dialog
      chrome="custom"
      className="rc-frame runtime-center-workspace"
      initialFocusId="runtime-center-title"
      labelledBy="runtime-center-title"
      onClose={closeRuntimeCenter}
      open
    >
      <header className="rc-top">
        <div className="rc-brand">
          <strong>Learning MORE</strong>
          <span>学习即生活｜用 AI 重塑学习方式</span>
        </div>
        <div className="rc-capsules">
          <button
            aria-live="polite"
            className={`rc-capsule ${providerConnecting ? 'warn' : providerHealthy ? 'ok' : 'error'}`}
            onClick={() => setActiveTab('ai')}
            type="button"
          >
            <span className="rc-dot" />
            <span>
              <b>
                {providerName} · {providerConnectionLabel}
              </b>
              <small>{providerConnecting ? '正在读取真实运行状态' : currentModel}</small>
            </span>
          </button>
          <button
            className={`rc-capsule ${serviceStatusClass}`}
            onClick={() => setActiveTab('service')}
            type="button"
          >
            <span className="rc-dot" />
            <span>
              <b>
                本地服务 · {serviceRecovering ? '重连中' : serviceReady ? '准备就绪' : '需要处理'}
              </b>
              <small>
                {serviceRecovering
                  ? '正在等待本地服务恢复'
                  : serviceReady
                    ? '实例与版本均已核验'
                    : '打开面板查看诊断'}
              </small>
            </span>
          </button>
        </div>
      </header>
      <div className="rc-stage">
        <div aria-hidden="true" className="rc-page-bg">
          <div className="rc-ghost">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="rc-ghost-row" key={index} />
            ))}
          </div>
          <div className="rc-ghost">
            {Array.from({ length: 3 }, (_, index) => (
              <div className="rc-ghost-row" key={index} />
            ))}
          </div>
        </div>
        <div aria-hidden="true" className="rc-backdrop" />
        <section className="rc-panel">
          <header className="rc-head">
            <div>
              <div className="rc-kicker">Runtime Center</div>
              <h1 className="lm-dialog-initial-focus" id="runtime-center-title" tabIndex={-1}>
                运行中心
              </h1>
              <p>
                查看 AI 连接与本地服务状态。两套状态独立判断，恢复本地服务后会自动刷新 AI 接口。
              </p>
            </div>
            <button
              aria-label="关闭"
              className="rc-close"
              onClick={closeRuntimeCenter}
              type="button"
            >
              ×
            </button>
          </header>
          <Tabs
            active={activeTab}
            as="nav"
            className="rc-tabs"
            idPrefix={runtimeTabsIdPrefix}
            label="运行中心"
            onChange={setActiveTab}
            options={[
              {
                id: 'ai',
                label: (
                  <>
                    AI 接口{' '}
                    <span
                      className={`rc-tab-badge${providerConnecting ? ' warn' : providerHealthy ? '' : ' error'}`}
                    >
                      {providerConnectionLabel}
                    </span>
                  </>
                ),
              },
              {
                id: 'service',
                label: (
                  <>
                    本地服务{' '}
                    <span
                      className={`rc-tab-badge${serviceRecovering ? ' warn' : serviceReady ? '' : ' error'}`}
                    >
                      {serviceRecovering ? '重连中' : serviceReady ? '健康' : '异常'}
                    </span>
                  </>
                ),
              },
            ]}
            tabClassName={(_option, active) => `rc-tab${active ? ' active' : ''}`}
          />
          <main className="rc-body">
            <section
              aria-labelledby={tabId(runtimeTabsIdPrefix, 'ai')}
              className={`rc-view${activeTab === 'ai' ? ' active' : ''}`}
              hidden={activeTab !== 'ai'}
              id={tabPanelId(runtimeTabsIdPrefix, 'ai')}
              role="tabpanel"
              tabIndex={0}
            >
              <div className="rc-status-hero">
                <div className="rc-status-main">
                  <span
                    className={`rc-dot ${providerConnecting ? 'warn' : providerHealthy ? 'ok' : 'error'}`}
                  />
                  <div>
                    <h2>
                      {providerName} {providerConnectionLabel}
                    </h2>
                    <p>
                      当前 AI 请求由 {providerName} 提供。
                      {providerConnecting
                        ? '正在向后端读取当前 Provider、模型和健康状态。'
                        : providerHealthy
                          ? '健康检查通过，可以开始课程对话与 Review 生成。'
                          : providerSyncFailed
                            ? '最近一次实时同步失败，保留上次状态并继续自动重试。'
                            : '当前 Provider 未通过健康检查，原配置保持不变。'}
                    </p>
                  </div>
                </div>
                <div className="rc-status-meta">
                  <span>
                    当前模型<b>{currentModel}</b>
                  </span>
                  <span>
                    最近同步<b>{lastProviderSyncLabel}</b>
                  </span>
                  <span>
                    实际 Provider<b>{providerName}</b>
                  </span>
                </div>
              </div>
              <div
                aria-live="polite"
                className={`rc-alert ${providerConnecting ? '' : providerHealthy ? 'ok' : 'error'}`}
              >
                {providerConnecting
                  ? '正在同步真实运行状态，请稍候；此时不会将接口误报为已连接或异常。'
                  : providerHealthy
                    ? '接口状态与实际运行时一致。关闭面板不会影响正在执行的 AI 任务。'
                    : providerSyncFailed
                      ? '状态同步暂时失败，系统会自动重试；本地服务仍可独立诊断。'
                      : 'AI 接口当前不可用；本地服务仍可独立诊断。'}
              </div>
              <div className="rc-section-head">
                <div>
                  <h2>选择 AI 接口</h2>
                  <p>切换前先核验目标接口；验证失败时保留当前 Provider。</p>
                </div>
                <button className="rc-mini-btn" onClick={() => void checkProvider()} type="button">
                  重新检查全部接口
                </button>
              </div>
              <div className="rc-providers">
                {(
                  [
                    [
                      'mock',
                      'Mock',
                      '确定性测试接口，不访问外部模型，适合流程与回归检查。',
                      '切换使用',
                    ],
                    [
                      'api',
                      'API-compatible',
                      '使用 API 地址、模型和仅保存在运行内存中的密钥。',
                      '配置并核验',
                    ],
                    [
                      'codex-cli',
                      'Codex CLI',
                      '使用本地 Codex CLI 与实时模型目录，支持账号验证、连接切换和当前接口重连。',
                      '管理配置',
                    ],
                  ] as const
                ).map(([id, label, description, action]) => (
                  <button
                    className={`rc-provider${providerId === id ? ' active' : ''}`}
                    key={id}
                    onClick={() => selectProvider(id)}
                    type="button"
                  >
                    <span className="rc-provider-head">
                      <h3>{label}</h3>
                      <span className={`rc-state${providerStateClass(id)}`}>
                        {providerStateLabel(id)}
                      </span>
                    </span>
                    <p>{description}</p>
                    <small>主要操作：{action}</small>
                  </button>
                ))}
              </div>
              <section className="rc-config">
                <header className="rc-config-head">
                  <strong>
                    {providerId === 'codex-cli'
                      ? 'Codex CLI'
                      : providerId === 'api'
                        ? 'API-compatible'
                        : 'Mock'}{' '}
                    配置
                  </strong>
                  <span>{configStateText}</span>
                </header>
                <div className="rc-config-body">
                  <div className="rc-field">
                    <label htmlFor="runtime-model">
                      {providerId === 'codex-cli' ? 'Codex CLI 子模型' : '模型（公开配置）'}
                    </label>
                    {providerId === 'codex-cli' ? (
                      <select
                        className="rc-control"
                        disabled={(selectedCatalogProvider?.models.length ?? 0) === 0}
                        id="runtime-model"
                        onChange={(event) => {
                          const nextModel = selectedCatalogProvider?.models.find(
                            (candidate) => candidate.id === event.target.value,
                          );
                          setModel(event.target.value);
                          setReasoningEffort(nextModel?.defaultReasoningEffort ?? '');
                        }}
                        value={model}
                      >
                        {(selectedCatalogProvider?.models.length ?? 0) === 0 ? (
                          <option value="">未发现可用模型</option>
                        ) : (
                          selectedCatalogProvider?.models.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.displayName}
                            </option>
                          ))
                        )}
                      </select>
                    ) : (
                      <input
                        className="rc-control"
                        id="runtime-model"
                        onChange={(event) => setModel(event.target.value)}
                        placeholder="由 Provider 默认选择"
                        value={model}
                      />
                    )}
                  </div>
                  {providerId === 'codex-cli' ? (
                    <div className="rc-field">
                      <label htmlFor="runtime-reasoning-effort">
                        推理强度
                        {selectedCatalogModel === undefined ? null : (
                          <span className="rc-field-note">
                            模型默认 {selectedCatalogModel.defaultReasoningEffort}，可调整
                          </span>
                        )}
                      </label>
                      <select
                        className="rc-control"
                        disabled={selectedCatalogModel === undefined}
                        id="runtime-reasoning-effort"
                        onChange={(event) => setReasoningEffort(event.target.value)}
                        value={reasoningEffort}
                      >
                        {selectedCatalogModel === undefined ? (
                          <option value="">请先选择模型</option>
                        ) : (
                          selectedCatalogModel.supportedReasoningEfforts.map((effort) => (
                            <option key={effort} value={effort}>
                              {effort}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  ) : null}
                  <div className="rc-field">
                    <label htmlFor="runtime-connection">连接状态</label>
                    <input
                      className="rc-control"
                      id="runtime-connection"
                      readOnly
                      value={
                        selectedProviderActive && providerConnecting
                          ? '连接中 · 正在同步真实状态'
                          : selectedProviderConnected
                            ? '已连接 · 当前使用且健康检查通过'
                            : selectedProviderHealthy
                              ? '可用 · 未连接（需切换）'
                              : codexNeedsLogin
                                ? '需要账号验证'
                                : '等待验证'
                      }
                    />
                  </div>
                  {providerId === 'api' ? (
                    <>
                      <div className="rc-field">
                        <label htmlFor="runtime-base-url">API Base URL</label>
                        <input
                          className="rc-control"
                          id="runtime-base-url"
                          onChange={(event) => setBaseUrl(event.target.value)}
                          placeholder="https://api.example.com/v1"
                          value={baseUrl}
                        />
                      </div>
                      <div className="rc-field">
                        <label htmlFor="runtime-key-handle">API Key handle</label>
                        <input
                          className="rc-control"
                          id="runtime-key-handle"
                          onChange={(event) => setApiKeyHandle(event.target.value)}
                          placeholder="provider/api-key"
                          value={apiKeyHandle}
                        />
                      </div>
                    </>
                  ) : null}
                  <div className="rc-config-actions">
                    {codexNeedsLogin ? (
                      <button
                        className="rc-btn"
                        disabled={loginState === 'starting' || loginState === 'waiting'}
                        onClick={() => void startCodexLogin()}
                        type="button"
                      >
                        {loginState === 'starting' || loginState === 'waiting'
                          ? '等待浏览器验证…'
                          : '登录 Codex'}
                      </button>
                    ) : null}
                    <button
                      className="rc-btn"
                      disabled={
                        providerConnecting ||
                        (providerId === 'codex-cli' &&
                          (!selectedProviderHealthy || model === '' || reasoningEffort === ''))
                      }
                      onClick={() => void switchProvider()}
                      type="button"
                    >
                      {selectedProviderActive ? '应用模型' : '连接并切换'}
                    </button>
                    <button
                      className="rc-btn soft"
                      disabled={!selectedProviderActive || providerConnecting}
                      onClick={() => void reconnectProvider()}
                      type="button"
                    >
                      重连当前接口
                    </button>
                    {providerId === 'codex-cli' ? null : (
                      <button
                        className="rc-btn primary"
                        disabled={providerConnecting}
                        onClick={() => void checkProvider()}
                        type="button"
                      >
                        启动并检查
                      </button>
                    )}
                  </div>
                </div>
              </section>
              {loginState === 'waiting' ? (
                <p className="sr-only" role="status">
                  已打开 Codex 账号验证网站，正在等待验证完成
                </p>
              ) : loginState === 'failed' ? (
                <p className="sr-only" role="alert">
                  Codex 账号验证未完成，请重新登录
                </p>
              ) : null}
              {providerSwitchState === 'saved' ? (
                <p className="sr-only" role="status">
                  Provider 已切换
                </p>
              ) : null}
              {providerSwitchState === 'failed' ? (
                <p className="sr-only" role="alert">
                  Provider 切换失败，原配置未改变
                </p>
              ) : null}
            </section>

            <section
              aria-labelledby={tabId(runtimeTabsIdPrefix, 'service')}
              className={`rc-view${activeTab === 'service' ? ' active' : ''}`}
              hidden={activeTab !== 'service'}
              id={tabPanelId(runtimeTabsIdPrefix, 'service')}
              role="tabpanel"
              tabIndex={0}
            >
              <div className="rc-status-hero">
                <div className="rc-status-main">
                  <span className={`rc-dot ${serviceStatusClass}`} />
                  <div>
                    <h2>
                      本地服务
                      {serviceRecovering ? '重连中' : serviceReady ? '准备就绪' : '需要处理'}
                    </h2>
                    <p>
                      {serviceRecovering
                        ? '正在执行受控重连，瞬态探测失败不会被误判为最终故障。'
                        : serviceReady
                          ? '健康响应、运行时 manifest 与当前页面期望配置完全一致。'
                          : '本地实例未通过完整身份核验。'}
                    </p>
                  </div>
                </div>
                <div className="rc-status-meta">
                  <span>
                    协议<b>{state.kind === 'loaded' ? state.readiness.protocolVersion : '—'}</b>
                  </span>
                  <span>
                    构建<b>{state.kind === 'loaded' ? state.readiness.buildId : '—'}</b>
                  </span>
                  <span>
                    最近核验<b>刚刚</b>
                  </span>
                </div>
              </div>
              <div
                className={`rc-alert${serviceRecovering ? '' : serviceReady ? ' ok' : ' error'}`}
              >
                {serviceRecovering
                  ? '受控恢复仍在进行，当前状态尚未形成最终结论。'
                  : serviceReady
                    ? '当前实例身份可信，没有发现版本漂移。'
                    : '实例身份或版本未通过核验；恢复操作保持有界。'}
              </div>
              <div className="rc-service-grid">
                <article className="rc-card">
                  <h3>实例身份</h3>
                  <p>健康不只检查 HTTP 200，还必须匹配 manifest 与期望运行配置。</p>
                  <div className="rc-identity">
                    <div className="rc-id-item">
                      <span>instanceId</span>
                      <b>{state.kind === 'loaded' ? state.readiness.instanceId : '不可用'}</b>
                    </div>
                    <div className="rc-id-item">
                      <span>buildId</span>
                      <b>{state.kind === 'loaded' ? state.readiness.buildId : '不可用'}</b>
                    </div>
                    <div className="rc-id-item">
                      <span>协议版本</span>
                      <b>{state.kind === 'loaded' ? state.readiness.protocolVersion : '不可用'}</b>
                    </div>
                    <div className="rc-id-item">
                      <span>配置指纹</span>
                      <b>
                        {state.kind === 'loaded' &&
                        state.readiness.identityFingerprint !== undefined
                          ? `${state.readiness.identityFingerprint.slice(0, 4)}…${state.readiness.identityFingerprint.slice(-4)} · 匹配`
                          : '未公开'}
                      </b>
                    </div>
                  </div>
                </article>
                <article className="rc-card">
                  <h3>健康核验</h3>
                  <p>每项检查独立显示，不展示密钥或本地绝对路径。</p>
                  <div className="rc-health-list">
                    <div className="rc-health-row">
                      <span>HTTP 健康响应</span>
                      <b>{serviceReady ? '通过' : '失败'}</b>
                    </div>
                    <div className="rc-health-row">
                      <span>实例与 manifest</span>
                      <b>{state.kind === 'loaded' ? '匹配' : '待核验'}</b>
                    </div>
                    <div className="rc-health-row">
                      <span>Store</span>
                      <b>{state.kind === 'loaded' ? state.readiness.storeStatus : '未知'}</b>
                    </div>
                    <div className="rc-health-row">
                      <span>投影</span>
                      <b>{state.kind === 'loaded' ? state.readiness.projectionStatus : '未知'}</b>
                    </div>
                    <div className="rc-health-row">
                      <span>Provider</span>
                      <b>{state.kind === 'loaded' ? state.readiness.providerStatus : '未知'}</b>
                    </div>
                  </div>
                </article>
              </div>
              <section className="rc-heal">
                <header className="rc-heal-head">
                  <div>
                    <h3>一键重连与自愈</h3>
                    <p>恢复过程有次数和超时上限；端口被外部进程占用时停止，不强杀。</p>
                  </div>
                  <span
                    className={`rc-heal-status${visibleStage === 'failed' ? ' error' : visibleStage === 'idle' || visibleStage === 'completed' ? '' : ' warn'}`}
                  >
                    {visibleStage === 'idle'
                      ? '无需恢复'
                      : visibleStage === 'completed'
                        ? '恢复完成'
                        : visibleStage === 'failed'
                          ? '需要处理'
                          : '正在恢复'}
                  </span>
                </header>
                <ol aria-label="安全重连阶段" className="rc-heal-steps">
                  <li
                    className={`rc-heal-step ${stageLabel(visibleStage, 'verifying') === '完成' ? 'done' : visibleStage === 'verifying' ? 'active' : ''}`}
                  >
                    <strong>1. 核验实例</strong>
                    <span>{stageLabel(visibleStage, 'verifying')}</span>
                  </li>
                  <li
                    className={`rc-heal-step ${stageLabel(visibleStage, 'reconnecting') === '完成' ? 'done' : visibleStage === 'reconnecting' ? 'active' : ''}`}
                  >
                    <strong>2. 重连服务</strong>
                    <span>{stageLabel(visibleStage, 'reconnecting')}</span>
                  </li>
                  <li
                    className={`rc-heal-step ${stageLabel(visibleStage, 'waiting') === '完成' ? 'done' : visibleStage === 'waiting' ? 'active' : ''}`}
                  >
                    <strong>3. 等待健康</strong>
                    <span>{stageLabel(visibleStage, 'waiting')}</span>
                  </li>
                  <li
                    className={`rc-heal-step ${stageLabel(visibleStage, 'refreshing') === '完成' ? 'done' : visibleStage === 'refreshing' ? 'active' : ''}`}
                  >
                    <strong>4. 刷新 AI</strong>
                    <span>{stageLabel(visibleStage, 'refreshing')}</span>
                  </li>
                </ol>
                <div className="rc-heal-actions">
                  <button
                    className="rc-btn"
                    onClick={() =>
                      void api.refreshAi().then(() => {
                        void refresh();
                      })
                    }
                    type="button"
                  >
                    同步前端版本
                  </button>
                  <button
                    aria-label="生成诊断制品"
                    className="rc-btn soft"
                    onClick={() => void createDiagnostics()}
                    type="button"
                  >
                    {diagnosticsState.kind === 'creating' ? '诊断中…' : '重新诊断'}
                  </button>
                  <button
                    aria-label="安全重连"
                    className="rc-btn primary"
                    onClick={() => void reconnect()}
                    type="button"
                  >
                    一键重连
                  </button>
                </div>
              </section>
              {aiRecoveryFailed ? (
                <div className="rc-log" role="alert">
                  <span className="bad">
                    本地服务已恢复，但 AI 接口刷新失败；请在 AI 接口页重新检查。
                  </span>
                </div>
              ) : null}
              {diagnosticsState.kind === 'created' ? (
                <div className="rc-log" role="status">
                  诊断已生成：<span className="good">{diagnosticsState.diagnosticId}</span>
                </div>
              ) : diagnosticsState.kind === 'failed' ? (
                <div className="rc-log" role="alert">
                  <span className="bad">诊断生成失败；运行状态未改变。</span>
                </div>
              ) : null}
            </section>
          </main>
        </section>
      </div>
    </Dialog>
  );
}
