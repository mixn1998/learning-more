import type { PortraitEvidence, PortraitVersion } from '@learning-more/contracts';

import type { PortraitEvidenceNode, PortraitWorkspaceInsight } from './portrait-workspace.js';

const sourceTitle = {
  behavior: '学习行为',
  outcome: '学习结果',
  reflection: '复盘反思',
  planning: '课程规划',
  review: '课节 Review',
} as const;

function displayMarkdown(markdown: string): string {
  const value = markdown.trim();
  if (/^#{1,6}\s+/u.test(value)) return value;
  return `### 复合证据观察\n\n${value}`;
}

function nodeForEvidence(evidence: PortraitEvidence): PortraitEvidenceNode {
  return {
    title: sourceTitle[evidence.sourceGroup],
    summary: evidence.summary,
    sourceGroup: evidence.sourceGroup,
    observedAt: evidence.observedAt,
    ...(evidence.polarity === 'supporting' ? {} : { boundary: true }),
  };
}

export function buildPortraitInsights(input: {
  readonly portrait: PortraitVersion;
  readonly evidence: readonly PortraitEvidence[];
}): readonly PortraitWorkspaceInsight[] {
  const evidenceById = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  return input.portrait.claims.map((claim) => {
    const selected = claim.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is PortraitEvidence => item !== undefined && item.status === 'active');
    const supporting = selected.filter((item) => item.polarity === 'supporting').slice(0, 2);
    const counter = selected.find((item) => item.polarity !== 'supporting');
    const visibleEvidence: PortraitEvidenceNode[] = supporting.map(nodeForEvidence);
    if (counter !== undefined) visibleEvidence.push(nodeForEvidence(counter));
    else if (claim.limitations[0] !== undefined) {
      visibleEvidence.push({
        title: '适用边界',
        summary: claim.limitations[0],
        sourceGroup: 'boundary',
        boundary: true,
      });
    }
    const independentGroups = new Set(selected.map((item) => item.sourceGroupId)).size;
    return {
      claimId: claim.claimId,
      markdown: displayMarkdown(claim.markdown),
      evidence: visibleEvidence,
      synthesis:
        selected.length === 0
          ? '当前证据条目已失效或不在可见窗口内；该冻结洞察保留，但不扩展解释。'
          : `该洞察由 ${selected.length} 条有效证据、${independentGroups} 个独立来源组共同支撑，并已检查反向证据；显示内容不超出冻结画像边界。`,
    };
  });
}

export function portraitUpdatedLabel(value: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(value));
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${month}月${day}日`;
}
