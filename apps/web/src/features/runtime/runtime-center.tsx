import { useState } from 'react';

import { runtimeCenterClient, type RuntimeCenterClient } from '../../client/runtime-client.js';
import { useCommandAttempts } from '../../state/use-command-attempt.js';
import { useRuntimeState } from '../../state/version-guard.js';

type Stage = 'idle' | 'verifying' | 'reconnecting' | 'waiting' | 'refreshing' | 'completed' | 'failed';

function stageLabel(current: Stage, stage: Exclude<Stage, 'idle' | 'completed' | 'failed'>): string {
  const order = ['verifying', 'reconnecting', 'waiting', 'refreshing'] as const;
  if (current === 'completed') return '完成';
  if (current === 'failed') return '需处理';
  const currentIndex = order.indexOf(current as (typeof order)[number]);
  const stageIndex = order.indexOf(stage);
  if (currentIndex > stageIndex) return '完成';
  return current === stage ? '进行中' : '待执行';
}

export function RuntimeCenter({ api = runtimeCenterClient }: { api?: RuntimeCenterClient }) {
  const { state, refresh } = useRuntimeState();
  const [stage, setStage] = useState<Stage>('idle');
  const [providerId, setProviderId] = useState('mock');
  const [model, setModel] = useState('');
  const [apiKeyHandle, setApiKeyHandle] = useState('');
  const [providerSwitchState, setProviderSwitchState] = useState<'idle' | 'saved' | 'failed'>(
    'idle',
  );
  const commands = useCommandAttempts();

  const reconnect = async () => {
    try {
      setStage('verifying');
      if (state.kind !== 'loaded') throw new Error('runtime_identity_unavailable');
      setStage('reconnecting');
      await api.reconnect();
      setStage('waiting');
      await api.waitUntilReady();
      setStage('refreshing');
      await api.refreshAi();
      setStage('completed');
      refresh();
    } catch {
      setStage('failed');
    }
  };

  const switchProvider = async () => {
    const commandKey = `provider-switch:${providerId}:${model}:${apiKeyHandle}`;
    try {
      await api.switchProvider(
        {
          providerId,
          publicConfig: model === '' ? {} : { model },
          secretHandles: apiKeyHandle === '' ? {} : { apiKey: apiKeyHandle },
        },
        commands.attemptFor(commandKey),
      );
      commands.complete(commandKey);
      setProviderSwitchState('saved');
      refresh();
    } catch {
      setProviderSwitchState('failed');
    }
  };

  return (
    <main className="runtime-center">
      <p className="eyebrow">本地运行控制</p>
      <h1>运行中心</h1>
      {state.kind === 'loaded' ? (
        <dl>
          <dt>实例</dt>
          <dd>{state.readiness.instanceId}</dd>
          <dt>构建</dt>
          <dd>{state.readiness.buildId}</dd>
          <dt>协议</dt>
          <dd>{state.readiness.protocolVersion}</dd>
          <dt>Store</dt>
          <dd>{state.readiness.storeStatus}</dd>
          <dt>投影</dt>
          <dd>{state.readiness.projectionStatus}</dd>
          <dt>Provider</dt>
          <dd>{state.readiness.providerStatus}</dd>
        </dl>
      ) : (
        <p>本地实例身份暂不可用。</p>
      )}
      <ol aria-label="安全重连阶段">
        <li>核验实例：{stageLabel(stage, 'verifying')}</li>
        <li>重连服务：{stageLabel(stage, 'reconnecting')}</li>
        <li>等待健康：{stageLabel(stage, 'waiting')}</li>
        <li>刷新 AI：{stageLabel(stage, 'refreshing')}</li>
      </ol>
      <button type="button" onClick={() => void reconnect()}>
        安全重连
      </button>
      <section className="provider-switch-panel">
        <h2>切换 AI Provider</h2>
        <label>
          Provider ID
          <input value={providerId} onChange={(event) => setProviderId(event.target.value)} />
        </label>
        <label>
          模型（公开配置）
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label>
          API Key handle
          <input
            value={apiKeyHandle}
            onChange={(event) => setApiKeyHandle(event.target.value)}
            placeholder="provider/api-key"
          />
        </label>
        <button type="button" onClick={() => void switchProvider()}>
          验证并切换
        </button>
        {providerSwitchState === 'saved' ? <p role="status">Provider 已切换</p> : null}
        {providerSwitchState === 'failed' ? <p role="alert">Provider 切换失败，原配置未改变</p> : null}
      </section>
    </main>
  );
}
