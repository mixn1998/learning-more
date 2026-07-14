import type { PortraitClaim, PortraitEvidence } from '@learning-more/contracts';
import { AiContent, Button, Dialog, Stack } from '@learning-more/ui';

export function EvidenceDrawer(props: {
  readonly open: boolean;
  readonly claim?: PortraitClaim;
  readonly evidence: readonly PortraitEvidence[];
  readonly onClose: () => void;
}) {
  const selected =
    props.claim?.evidenceIds
      .map((id) => props.evidence.find((candidate) => candidate.evidenceId === id))
      .filter((candidate): candidate is PortraitEvidence => candidate !== undefined) ?? [];
  return (
    <Dialog
      open={props.open}
      title="复合行为证据链"
      onClose={props.onClose}
      footer={<Button onClick={props.onClose}>关闭证据链</Button>}
    >
      <Stack>
        {selected.length === 0 ? <p>当前证据已失效或不在可见窗口内。</p> : null}
        <ol className="portrait-evidence-list">
          {selected.map((candidate) => (
            <li key={candidate.evidenceId}>
              <AiContent markdown={candidate.summary} />
              <p>
                来源：{candidate.sourceGroup} · {candidate.observedAt}
              </p>
              <p>依据强度：{candidate.strength.rationale}</p>
              <p>方向：{candidate.polarity}</p>
            </li>
          ))}
        </ol>
        <section>
          <h3>适用边界</h3>
          <ul>
            {props.claim?.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      </Stack>
    </Dialog>
  );
}
