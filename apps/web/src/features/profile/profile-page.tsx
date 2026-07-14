import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  GlobalLearningProfile,
  PortraitCurrent,
  PortraitEvidence,
  PortraitVersion,
} from '@learning-more/contracts';
import { Button, ContentState, Page, Stack } from '@learning-more/ui';

import { profileClient, type ProfileClient } from '../../client/profile-client.js';
import { useAppShellBrandSubtitle } from '../../state/app-shell-header.js';
import { useCommandAttempts } from '../../state/use-command-attempt.js';
import { GlobalProfilePanel } from './global-profile-panel.js';
import { PortraitView } from './portrait-view.js';
import { PortraitWorkspace } from './portrait-workspace.js';
import { buildPortraitInsights, portraitUpdatedLabel } from './portrait-workspace-model.js';

const insufficientPortraitTitle = '学习画像：证据尚不足';
const insufficientPortraitSummary =
  '当前冻结的证据尚不足以形成可独立验证的学习观察，因此暂不生成稳定结论。后续学习、复盘或补充对话积累到足够的可追溯证据后，画像会再更新；这不会改写全局用户档案中的长期事实。';

export function ProfilePage(props: { readonly client?: ProfileClient }) {
  const api = props.client ?? profileClient;
  const navigate = useNavigate();
  const commands = useCommandAttempts();
  useAppShellBrandSubtitle('学习画像');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [profile, setProfile] = useState<GlobalLearningProfile>();
  const [evidence, setEvidence] = useState<readonly PortraitEvidence[]>([]);
  const [portrait, setPortrait] = useState<PortraitCurrent>();
  const [pendingVersion, setPendingVersion] = useState<PortraitVersion>();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();

  useEffect(() => {
    let current = true;
    setLoadState('loading');
    void Promise.all([api.getProfile(), api.getEvidence(), api.getPortrait()]).then(
      ([profileView, evidenceView, portraitView]) => {
        if (!current) return;
        setProfile(profileView);
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

  if (loadState === 'loading') {
    return (
      <Page className="profile-page">
        <ContentState title="正在加载学习画像" description="正在同步全局档案与证据链。" />
      </Page>
    );
  }
  if (loadState === 'error' || profile === undefined) {
    return (
      <Page className="profile-page">
        <ContentState
          role="alert"
          title="学习画像暂不可用"
          description="档案或画像接口未能通过契约校验。"
          action={<Button onClick={() => setLoadAttempt((value) => value + 1)}>重新加载</Button>}
        />
      </Page>
    );
  }

  const refresh = async () => {
    const commandKey = 'portrait-refresh';
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      const version = await api.refresh(undefined, commands.attemptFor(commandKey));
      commands.complete(commandKey);
      if (version.state === 'completed' || version.state === 'failed') {
        setPortrait(version);
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
        onSectionChange={(section) =>
          navigate(section === 'calendar' ? '/history?tab=calendar' : '/history')
        }
        refreshing={refreshing}
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

  return (
    <Page className="profile-page">
      <Stack>
        <header className="profile-page-header">
          <p className="eyebrow">有边界的学习观察</p>
          <h1>学习画像</h1>
          <p>画像只使用当前证据窗口内的复合证据，不生成稳定人格或能力标签。</p>
        </header>
        <GlobalProfilePanel profile={profile} />
        <div>
          <Button variant="primary" busy={refreshing} onClick={() => void refresh()}>
            {refreshing ? '正在刷新画像' : '刷新学习画像'}
          </Button>
          {refreshError === undefined ? null : <p role="alert">{refreshError}</p>}
        </div>
        {pendingVersion === undefined ? null : (
          <ContentState
            title="画像生成中"
            description={`正在核验版本 ${pendingVersion.versionId}；当前成功版本保持可见。`}
          />
        )}
        <PortraitView {...(portrait === undefined ? {} : { portrait })} evidence={evidence} />
      </Stack>
    </Page>
  );
}
