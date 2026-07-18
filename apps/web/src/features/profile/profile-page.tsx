import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { PortraitCurrent, PortraitEvidence, PortraitVersion } from '@learning-more/contracts';

import { profileClient, type ProfileClient } from '../../client/profile-client.js';
import { useAppShellBrandSubtitle } from '../../state/app-shell-header.js';
import { useCommandAttempts } from '../../state/use-command-attempt.js';
import { PortraitWorkspace } from './portrait-workspace.js';
import { buildPortraitInsights, portraitUpdatedLabel } from './portrait-workspace-model.js';

const insufficientPortraitTitle = '学习画像：证据尚不足';
const insufficientPortraitSummary =
  '当前冻结的证据尚不足以形成可独立验证的学习观察，因此暂不生成稳定结论。后续学习、复盘或补充对话积累到足够的可追溯证据后，画像会继续更新。';

type PortraitSnapshot = Readonly<{
  evidence: readonly PortraitEvidence[];
  portrait: PortraitCurrent | undefined;
}>;

const portraitSnapshotCache = new WeakMap<ProfileClient, PortraitSnapshot>();

function portraitVersionId(portrait: PortraitCurrent | undefined): string | undefined {
  return portrait !== undefined && 'versionId' in portrait ? portrait.versionId : undefined;
}

export function ProfilePage(props: {
  readonly client?: ProfileClient;
  readonly embedded?: boolean;
  readonly onSectionChange?: (section: 'statistics' | 'calendar' | 'portrait') => void;
}) {
  const api = props.client ?? profileClient;
  const navigate = useNavigate();
  const commands = useCommandAttempts();
  useAppShellBrandSubtitle('学习画像');
  const initialSnapshot = portraitSnapshotCache.get(api);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [evidence, setEvidence] = useState<readonly PortraitEvidence[]>(
    initialSnapshot?.evidence ?? [],
  );
  const [portrait, setPortrait] = useState<PortraitCurrent | undefined>(initialSnapshot?.portrait);
  const [pendingVersion, setPendingVersion] = useState<PortraitVersion>();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    initialSnapshot === undefined ? 'loading' : 'ready',
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();

  useEffect(() => {
    let current = true;
    const cached = portraitSnapshotCache.get(api);
    if (cached === undefined) {
      setLoadState('loading');
      void Promise.all([api.getEvidence(), api.getPortrait()]).then(
        ([evidenceView, portraitView]) => {
          if (!current) return;
          portraitSnapshotCache.set(api, { evidence: evidenceView, portrait: portraitView });
          setEvidence(evidenceView);
          setPortrait(portraitView);
          if (
            portraitView !== undefined &&
            'versionId' in portraitView &&
            (portraitView.state === 'preparing' || portraitView.state === 'generating')
          ) {
            setPendingVersion(portraitView);
          }
          setLoadState('ready');
        },
        () => {
          if (current) setLoadState('error');
        },
      );
    } else {
      setLoadState('ready');
      void api.getPortrait().then(
        async (portraitView) => {
          if (!current) return;
          if (
            portraitView !== undefined &&
            'versionId' in portraitView &&
            (portraitView.state === 'preparing' || portraitView.state === 'generating')
          ) {
            setPendingVersion(portraitView);
            return;
          }
          if (portraitVersionId(portraitView) === portraitVersionId(cached.portrait)) return;
          const evidenceView = await api.getEvidence();
          if (!current) return;
          portraitSnapshotCache.set(api, { evidence: evidenceView, portrait: portraitView });
          setEvidence(evidenceView);
          setPortrait(portraitView);
        },
        () => undefined,
      );
    }
    return () => {
      current = false;
    };
  }, [api, loadAttempt]);

  useEffect(() => {
    if (pendingVersion === undefined) return undefined;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const version = await api.getPortraitVersion(pendingVersion.versionId);
        if (!current) return;
        if (version === undefined) {
          setRefreshError('画像版本暂不可读取；当前成功版本保持不变。');
          setPendingVersion(undefined);
          return;
        }
        if (version.state === 'completed') {
          const evidenceView = await api.getEvidence();
          if (!current) return;
          portraitSnapshotCache.set(api, { evidence: evidenceView, portrait: version });
          setEvidence(evidenceView);
          setPortrait(version);
          setPendingVersion(undefined);
          return;
        }
        if (version.state === 'failed') {
          setPortrait((existing) =>
            existing !== undefined &&
            'versionId' in existing &&
            existing.versionId === version.versionId
              ? version
              : existing,
          );
          setRefreshError(`画像生成失败；当前成功版本保持不变。${version.errorCode ?? ''}`);
          setPendingVersion(undefined);
          return;
        }
        setPendingVersion(version);
        timer = setTimeout(() => void poll(), 800);
      } catch {
        if (!current) return;
        setRefreshError('画像状态读取失败；可稍后继续刷新。');
        timer = setTimeout(() => void poll(), 1_600);
      }
    };
    timer = setTimeout(() => void poll(), 400);
    return () => {
      current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [api, pendingVersion?.versionId]);

  const refresh = async () => {
    const commandKey = 'portrait-refresh';
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      const version = await api.refresh(undefined, commands.attemptFor(commandKey));
      commands.complete(commandKey);
      if (version.state === 'completed') {
        const evidenceView = await api.getEvidence();
        portraitSnapshotCache.set(api, { evidence: evidenceView, portrait: version });
        setEvidence(evidenceView);
        setPortrait(version);
      } else if (version.state === 'failed') {
        setPortrait((current) =>
          current !== undefined && 'versionId' in current && current.state === 'completed'
            ? current
            : version,
        );
        setRefreshError('画像生成失败，请稍后重试；当前成功版本保持不变。');
      } else {
        setPendingVersion(version);
        setPortrait((current) =>
          current !== undefined && 'versionId' in current && current.state === 'completed'
            ? current
            : version,
        );
      }
    } catch {
      setRefreshError('画像刷新失败；当前成功版本和证据链均未改变。');
    } finally {
      setRefreshing(false);
    }
  };

  const changeSection = (section: 'statistics' | 'calendar' | 'portrait') => {
    if (props.onSectionChange !== undefined) {
      props.onSectionChange(section);
      return;
    }
    navigate(
      section === 'calendar'
        ? '/history?tab=calendar'
        : section === 'portrait'
          ? '/history?tab=portrait'
          : '/history',
    );
  };

  if (loadState === 'loading') {
    return (
      <PortraitWorkspace
        embedded={props.embedded}
        insights={[]}
        onSectionChange={changeSection}
        pendingMessage="正在读取已生成的画像静态快照。"
        summary="正在读取最近一次成功生成的画像，请稍候。"
        title="正在加载学习画像"
        updatedLabel="读取中"
      />
    );
  }
  if (loadState === 'error') {
    return (
      <PortraitWorkspace
        embedded={props.embedded}
        errorMessage="学习画像暂不可用，请稍后重试。"
        insights={[]}
        onRefresh={() => setLoadAttempt((value) => value + 1)}
        onSectionChange={changeSection}
        refreshLabel="重新读取"
        summary="画像或证据接口暂时无法读取，当前页面没有改写任何学习事实。"
        title="学习画像暂不可用"
        updatedLabel="读取失败"
      />
    );
  }

  if ('versionId' in (portrait ?? {}) && portrait?.state === 'completed') {
    const completedPortrait = portrait as PortraitVersion;
    const hasInsights = completedPortrait.claims.length > 0;
    return (
      <PortraitWorkspace
        {...(refreshError === undefined ? {} : { errorMessage: refreshError })}
        {...(pendingVersion === undefined
          ? {}
          : {
              pendingMessage: `画像版本 ${pendingVersion.versionId} 正在核验证据；当前成功版本保持可见。`,
            })}
        insights={buildPortraitInsights({ portrait: completedPortrait, evidence })}
        onRefresh={() => void refresh()}
        onSectionChange={changeSection}
        refreshing={refreshing}
        embedded={props.embedded}
        summary={
          hasInsights
            ? (completedPortrait.summary ?? '当前成功版本未生成摘要。')
            : insufficientPortraitSummary
        }
        title={
          hasInsights ? (completedPortrait.title ?? '有边界的学习观察') : insufficientPortraitTitle
        }
        updatedLabel={portraitUpdatedLabel(
          completedPortrait.completedAt ?? completedPortrait.updatedAt,
        )}
      />
    );
  }

  const isPending =
    portrait !== undefined &&
    'versionId' in portrait &&
    (portrait.state === 'preparing' || portrait.state === 'generating');
  const isFailed = portrait?.state === 'failed';

  return (
    <PortraitWorkspace
      embedded={props.embedded}
      {...(isFailed || refreshError !== undefined
        ? { errorMessage: refreshError ?? '画像生成失败，请稍后重试。' }
        : {})}
      insights={[]}
      onRefresh={() => void refresh()}
      onSectionChange={changeSection}
      {...(isPending || pendingVersion !== undefined
        ? { pendingMessage: '正在核验复合证据与反向证据。' }
        : {})}
      refreshing={refreshing}
      summary={
        isFailed
          ? '本次画像生成未成功。你可以稍后重试；已冻结的证据不会被改写。'
          : isPending
            ? '正在根据当前证据窗口生成有边界的学习观察，完成后会自动更新此页面。'
            : insufficientPortraitSummary
      }
      title={
        isFailed ? '学习画像暂未生成' : isPending ? '学习画像正在生成' : insufficientPortraitTitle
      }
      updatedLabel={isPending ? '生成中' : isFailed ? '生成失败' : '尚未生成'}
    />
  );
}
