import type { PortraitClaimView, PortraitEvidenceView } from '../../client/profile-client.js';

export function EvidenceDrawer(props: {
  readonly claim: PortraitClaimView;
  readonly evidence: readonly PortraitEvidenceView[];
  readonly onClose: () => void;
}) {
  const selected = props.claim.evidenceIds
    .map((id) => props.evidence.find((candidate) => candidate.evidenceId === id))
    .filter((candidate): candidate is PortraitEvidenceView => candidate !== undefined);
  return (
    <aside role="dialog" aria-modal="true" aria-label="复合行为证据链" className="dialog">
      <h3>复合行为证据链</h3>
      <ol>
        {selected.map((candidate) => (
          <li key={candidate.evidenceId}>
            <p>{candidate.summary}</p>
            <p>
              来源：{candidate.sourceGroup} · {candidate.observedAt}
            </p>
            <p>依据强度：{candidate.strength.rationale}</p>
            <p>方向：{candidate.polarity}</p>
          </li>
        ))}
      </ol>
      <h4>适用边界</h4>
      <ul>
        {props.claim.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
      <button type="button" onClick={props.onClose}>
        关闭证据链
      </button>
    </aside>
  );
}
