import { useState } from 'react';

import type { PortraitEvidenceView, PortraitVersionView } from '../../client/profile-client.js';
import { EvidenceDrawer } from './evidence-drawer.js';

export function PortraitView(props: {
  readonly portrait?: PortraitVersionView;
  readonly evidence: readonly PortraitEvidenceView[];
}) {
  const [selectedClaimId, setSelectedClaimId] = useState<string>();
  const portrait = props.portrait;
  if (portrait === undefined) {
    return <p>证据不足，尚无成功画像版本</p>;
  }
  if (portrait.state === 'preparing' || portrait.state === 'generating') {
    return <p role="status">画像生成中</p>;
  }
  if (portrait.state === 'failed') {
    return <p role="alert">画像生成失败；上一成功版本保持不变</p>;
  }
  const selected = portrait.claims.find((claim) => claim.claimId === selectedClaimId);
  return (
    <section className="authoring-panel">
      <h2>{portrait.title}</h2>
      <p>{portrait.summary}</p>
      <p>最近成功更新：{portrait.updatedAt}</p>
      {portrait.claims.length === 0 ? (
        <p>证据不足，暂不生成稳定洞察</p>
      ) : (
        <ol>
          {portrait.claims.map((claim, index) => (
            <li key={claim.claimId}>
              <p>{claim.markdown}</p>
              <button type="button" onClick={() => setSelectedClaimId(claim.claimId)}>
                查看证据链 {index + 1}
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected === undefined ? null : (
        <EvidenceDrawer
          claim={selected}
          evidence={props.evidence}
          onClose={() => setSelectedClaimId(undefined)}
        />
      )}
    </section>
  );
}
