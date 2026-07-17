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
  return `### 你在学习中的一个做法\n\n${value}`;
}

function friendlyEvidenceSummary(evidence: PortraitEvidence): string {
  if (evidence.polarity !== 'supporting') {
    return '这次学习记录提醒我们：上面的观察并不是在每次学习中都会出现。';
  }
  if (evidence.sourceGroup === 'behavior') {
    return '在这次学习中，你也出现了与上面描述相符的做法。';
  }
  if (evidence.sourceGroup === 'outcome') {
    return '这次学习结果与上面的观察相互印证。';
  }
  if (evidence.sourceGroup === 'reflection') {
    return '这次复盘补充了上面观察成立的具体情境。';
  }
  if (evidence.sourceGroup === 'planning') {
    return '这次学习安排与上面的观察相互印证。';
  }
  return '这次课节 Review 保留了与上面观察一致的记录。';
}

function nodeForEvidence(evidence: PortraitEvidence): PortraitEvidenceNode {
  return {
    title: sourceTitle[evidence.sourceGroup],
    summary: friendlyEvidenceSummary(evidence),
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
          : `这个做法在 ${independentGroups} 次不同的学习记录中都出现过。系统也检查了不一致的情况；当前结论只适用于已经记录下来的学习情境。`,
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
