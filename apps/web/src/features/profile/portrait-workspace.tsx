import { useMemo, useRef, useState } from 'react';

import { AiContent, Page } from '@learning-more/ui';

import {
  HistorySectionTabs,
  historySectionPanelAttributes,
} from '../history/history-section-tabs.js';
import './portrait-workspace.css';

export type PortraitEvidenceNode = Readonly<{
  title: string;
  summary: string;
  sourceGroup: 'behavior' | 'outcome' | 'reflection' | 'planning' | 'review' | 'boundary';
  observedAt?: string;
  boundary?: boolean;
}>;

export type PortraitWorkspaceInsight = Readonly<{
  claimId: string;
  markdown: string;
  evidence: readonly PortraitEvidenceNode[];
  synthesis: string;
}>;

type EvidenceWindow = 'all' | 'year' | '90d';
type PortraitSettings = Readonly<{
  window: EvidenceWindow;
  includeReviews: boolean;
  includeBehavior: boolean;
}>;

const sourceLabel = {
  behavior: '本次学习中的具体表现',
  outcome: '学习结果',
  reflection: '复盘反思',
  planning: '课程规划',
  review: '课节 Review',
  boundary: '适用边界',
} as const;

function closeDialog(dialog: HTMLDialogElement | null) {
  if (typeof dialog?.close === 'function') dialog.close();
  else dialog?.removeAttribute('open');
}

export function PortraitWorkspace(props: {
  readonly title: string;
  readonly summary: string;
  readonly updatedLabel: string;
  readonly insights: readonly PortraitWorkspaceInsight[];
  readonly refreshing?: boolean;
  readonly pendingMessage?: string;
  readonly errorMessage?: string;
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshLabel?: string | undefined;
  readonly onSectionChange: (section: 'statistics' | 'calendar' | 'portrait') => void;
  readonly embedded?: boolean | undefined;
}) {
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<PortraitSettings>({
    window: 'all',
    includeReviews: true,
    includeBehavior: true,
  });
  const [draft, setDraft] = useState(settings);
  const [settingsNotice, setSettingsNotice] = useState('');
  const visibleInsights = useMemo(() => {
    const now = Date.now();
    const cutoff =
      settings.window === '90d'
        ? now - 90 * 86_400_000
        : settings.window === 'year'
          ? now - 365 * 86_400_000
          : undefined;
    return props.insights.map((insight) => ({
      ...insight,
      evidence: insight.evidence.filter((node) => {
        if (node.sourceGroup === 'review' && !settings.includeReviews) return false;
        if (node.sourceGroup === 'behavior' && !settings.includeBehavior) return false;
        if (cutoff === undefined || node.observedAt === undefined || node.boundary) return true;
        return new Date(node.observedAt).getTime() >= cutoff;
      }),
    }));
  }, [props.insights, settings]);

  const openSettings = () => {
    setDraft(settings);
    setSettingsNotice('');
    if (typeof settingsDialog.current?.showModal === 'function') settingsDialog.current.showModal();
    else settingsDialog.current?.setAttribute('open', '');
  };

  const content = (
    <>
      <section className="lm-card portrait-hero">
        <div>
          <div className="lm-kicker">LEARNING PORTRAIT</div>
          <h1>学习画像</h1>
        </div>
        <div className="lm-actions portrait-hero-actions">
          <span className="lm-pill success">最近更新 · {props.updatedLabel}</span>
          <button className="lm-btn" onClick={openSettings} type="button">
            画像设置
          </button>
          {props.onRefresh === undefined ? null : (
            <button
              aria-busy={props.refreshing || undefined}
              className="lm-btn primary"
              disabled={props.refreshing}
              onClick={props.onRefresh}
              type="button"
            >
              {props.refreshing ? '正在刷新…' : (props.refreshLabel ?? '刷新画像')}
            </button>
          )}
        </div>
      </section>

      <HistorySectionTabs
        active="portrait"
        className="portrait-primary-nav"
        onChange={props.onSectionChange}
        tabClassName={(_section, active) => `history-tab${active ? ' active' : ''}`}
      />

      <section {...historySectionPanelAttributes('portrait')} className="lm-card portrait-board">
        <div className="portrait-wrap">
          <section className="portrait-summary">
            <AiContent markdown={`## ${props.title}\n\n${props.summary}`} />
          </section>
          {props.pendingMessage === undefined ? null : (
            <p className="portrait-operation-note" role="status">
              {props.pendingMessage}
            </p>
          )}
          {props.errorMessage === undefined ? null : (
            <p className="portrait-operation-note error" role="alert">
              {props.errorMessage}
            </p>
          )}
          {settingsNotice === '' ? null : (
            <p className="sr-only" role="status">
              {settingsNotice}
            </p>
          )}
          <section className="portrait-insight-list">
            <h2 className="portrait-insight-list-title">你在学习中反复出现的做法</h2>
            {visibleInsights.length === 0 ? (
              <div className="lm-empty">证据不足，暂不生成稳定洞察。</div>
            ) : null}
            {visibleInsights.map((insight, index) => {
              const evidence = insight.evidence.slice(0, 3);
              return (
                <article className="portrait-insight-card" key={insight.claimId}>
                  <aside className="portrait-insight-index">
                    <span>洞察</span>
                    <strong>{String(index + 1).padStart(2, '0')}</strong>
                  </aside>
                  <div className="portrait-insight-content">
                    <div className="portrait-insight-body">
                      <AiContent markdown={insight.markdown} />
                    </div>
                    <details className="portrait-evidence-chain">
                      <summary>这条观察从哪里来</summary>
                      <div className="portrait-evidence-flow">
                        {evidence.map((node, nodeIndex) => (
                          <div
                            className={`portrait-evidence-node${node.boundary ? ' boundary' : ''}`}
                            key={`${insight.claimId}:${nodeIndex}`}
                          >
                            <b>{node.title || sourceLabel[node.sourceGroup]}</b>
                            <span>{node.summary}</span>
                          </div>
                        ))}
                        {evidence.length === 0 ? (
                          <div className="portrait-evidence-node boundary">
                            <b>当前显示边界</b>
                            <span>画像设置已隐藏本条洞察的可见证据；冻结画像本身未改变。</span>
                          </div>
                        ) : null}
                        <div className="portrait-chain-synthesis">{insight.synthesis}</div>
                      </div>
                    </details>
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      </section>

      <dialog
        aria-describedby="portrait-settings-description"
        aria-labelledby="portrait-settings-title"
        className="portrait-settings"
        ref={settingsDialog}
      >
        <header className="settings-header">
          <div className="settings-heading">
            <span className="settings-kicker">证据筛选</span>
            <h2 id="portrait-settings-title">画像设置</h2>
            <p id="portrait-settings-description">调整当前画像展示所采用的学习证据。</p>
          </div>
          <button
            aria-label="关闭画像设置"
            className="settings-close"
            onClick={() => closeDialog(settingsDialog.current)}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="settings-body">
          <label className="setting-row">
            <span className="setting-copy">
              <strong>证据时间范围</strong>
              <small>控制画像参考学习记录的历史跨度</small>
            </span>
            <select
              aria-label="证据时间范围"
              className="lm-control setting-select"
              id="portrait-evidence-window"
              onChange={(event) =>
                setDraft((value) => ({ ...value, window: event.target.value as EvidenceWindow }))
              }
              value={draft.window}
            >
              <option value="all">全部学习记录</option>
              <option value="year">最近 12 个月</option>
              <option value="90d">最近 90 天</option>
            </select>
          </label>
          <fieldset className="setting-group">
            <legend>纳入证据</legend>
            <p>选择当前画像可以引用的证据类型。</p>
            <label className="setting-switch">
              <span className="setting-copy">
                <strong>课节与课程 Review</strong>
                <small>纳入课节复盘和课程总结中的稳定结论</small>
              </span>
              <input
                aria-label="课节与课程 Review"
                checked={draft.includeReviews}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, includeReviews: event.target.checked }))
                }
                type="checkbox"
              />
              <span aria-hidden="true" className="setting-switch-control" />
            </label>
            <label className="setting-switch">
              <span className="setting-copy">
                <strong>学习对话中的有效行为证据</strong>
                <small>纳入提问、修正和推理过程中形成的行为观察</small>
              </span>
              <input
                aria-label="学习对话中的有效行为证据"
                checked={draft.includeBehavior}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, includeBehavior: event.target.checked }))
                }
                type="checkbox"
              />
              <span aria-hidden="true" className="setting-switch-control" />
            </label>
          </fieldset>
        </div>
        <footer>
          <button
            className="lm-btn"
            onClick={() => closeDialog(settingsDialog.current)}
            type="button"
          >
            取消
          </button>
          <button
            className="lm-btn primary"
            onClick={() => {
              setSettings(draft);
              setSettingsNotice('画像显示设置已保存');
              closeDialog(settingsDialog.current);
            }}
            type="button"
          >
            保存设置
          </button>
        </footer>
      </dialog>
    </>
  );
  return props.embedded ? (
    <div className="portrait-workspace portrait-workspace--embedded">{content}</div>
  ) : (
    <Page className="portrait-workspace">{content}</Page>
  );
}
