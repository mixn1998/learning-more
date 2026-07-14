import { useState } from 'react';

import type { PortraitCurrent, PortraitEvidence } from '@learning-more/contracts';
import { AiContent, Button, ContentState, Panel, SectionHeader, Stack } from '@learning-more/ui';

import { EvidenceDrawer } from './evidence-drawer.js';
import { ReasoningBehaviorPanel } from './reasoning-behavior-panel.js';

export function PortraitView(props: {
  readonly portrait?: PortraitCurrent;
  readonly evidence: readonly PortraitEvidence[];
}) {
  const [selectedClaimId, setSelectedClaimId] = useState<string>();
  const portrait = props.portrait;
  if (portrait === undefined) {
    return <ContentState title="证据不足，尚无成功画像版本" />;
  }
  if (!('versionId' in portrait)) {
    return portrait.state === 'updating' ? (
      <ContentState title="画像更新中" description="当前成功版本不会被中间状态覆盖。" />
    ) : (
      <ContentState
        role="alert"
        title="画像生成失败；上一成功版本保持不变"
        description={portrait.errorCode}
      />
    );
  }
  if (portrait.state === 'preparing' || portrait.state === 'generating') {
    return <ContentState title="画像生成中" description="正在核验复合证据与反向证据。" />;
  }
  if (portrait.state === 'failed') {
    return (
      <ContentState
        role="alert"
        title="画像生成失败；上一成功版本保持不变"
        description={portrait.errorCode}
      />
    );
  }

  const selected = portrait.claims.find((claim) => claim.claimId === selectedClaimId);
  const hasClaims = portrait.claims.length > 0;
  return (
    <Panel className="portrait-version-panel">
      <SectionHeader title="当前画像版本" description={`最近成功更新：${portrait.updatedAt}`} />
      {hasClaims ? (
        <AiContent markdown={`## ${portrait.title ?? '学习画像'}\n\n${portrait.summary ?? ''}`} />
      ) : (
        <ContentState
          title="学习画像：证据尚不足"
          description="当前尚未积累到足以形成稳定观察的独立证据。后续学习、复盘或补充对话会继续沉淀可追溯证据；本状态不会写入或改写全局用户档案。"
        />
      )}
      {hasClaims ? (
        <ol className="portrait-claim-list">
          {portrait.claims.map((claim, index) => (
            <li key={claim.claimId}>
              <Stack>
                <AiContent markdown={claim.markdown} />
                <Button type="button" onClick={() => setSelectedClaimId(claim.claimId)}>
                  查看证据链 {index + 1}
                </Button>
              </Stack>
            </li>
          ))}
        </ol>
      ) : undefined}
      <ReasoningBehaviorPanel
        {...(portrait.reasoningBehaviorAnalysis === undefined
          ? {}
          : { analysis: portrait.reasoningBehaviorAnalysis })}
      />
      <EvidenceDrawer
        open={selected !== undefined}
        {...(selected === undefined ? {} : { claim: selected })}
        evidence={props.evidence}
        onClose={() => setSelectedClaimId(undefined)}
      />
    </Panel>
  );
}
