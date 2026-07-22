import { createHash } from 'node:crypto';

export type PersonalizationDigestSourceItem = Readonly<{
  sourceId: string;
  kind: 'stable_dimension' | 'durable_preference';
  summary: string;
  teachingImpact: string;
  priority: number;
  supportingSessionCount: number;
  sourceRefs: readonly string[];
}>;

export type PersonalizationDigestSource = Readonly<{
  profileVersion: number;
  sourceSnapshotHash: string;
  items: readonly PersonalizationDigestSourceItem[];
}>;

function normalize(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .replace(/[；;。,.，]+$/u, '')
    .trim();
}

export function createPersonalizationDigestSource(input: {
  profileVersion: number;
  items: readonly PersonalizationDigestSourceItem[];
}): PersonalizationDigestSource {
  const items = input.items
    .map((item) => ({ ...item, summary: normalize(item.summary) }))
    .filter((item) => item.summary.length > 0)
    .filter(
      (item, index, all) =>
        all.findIndex(
          (candidate) => candidate.kind === item.kind && candidate.summary === item.summary,
        ) === index,
    )
    .sort((left, right) =>
      `${left.kind}:${left.sourceId}`.localeCompare(`${right.kind}:${right.sourceId}`),
    );
  return {
    profileVersion: input.profileVersion,
    sourceSnapshotHash: createHash('sha256').update(JSON.stringify(items), 'utf8').digest('hex'),
    items,
  };
}

export function renderPersonalizationDigest(
  source: PersonalizationDigestSource,
): Readonly<{ summary: string; selectedModeIds: readonly string[] }> {
  const ranked = [...source.items].sort(
    (left, right) =>
      right.priority - left.priority ||
      right.supportingSessionCount - left.supportingSessionCount ||
      left.sourceId.localeCompare(right.sourceId),
  );

  function compose(selected: readonly PersonalizationDigestSourceItem[]): string {
    if (selected.length === 0) return '';
    const observed = selected.filter((item) => item.kind === 'stable_dimension');
    const declared = selected.filter((item) => item.kind === 'durable_preference');
    const featureSentence = [
      observed.length === 0
        ? undefined
        : `用户在不同学习会话中稳定表现为${observed.map((item) => item.summary).join('，并')}`,
      declared.length === 0
        ? undefined
        : `用户明确偏好${declared.map((item) => item.summary).join('，并')}`,
    ]
      .filter((value): value is string => value !== undefined)
      .join('；');
    return `${featureSentence}。教学宜${selected.map((item) => item.teachingImpact).join('；')}。`;
  }

  const selected: PersonalizationDigestSourceItem[] = [];
  for (const item of ranked) {
    if (selected.length < 2) {
      selected.push(item);
      continue;
    }
    if (selected.length >= 4) break;
    if ([...compose([...selected, item])].length > 150) continue;
    selected.push(item);
  }
  if (selected.length === 0) return { summary: '', selectedModeIds: [] };
  return {
    summary: compose(selected),
    selectedModeIds: selected.map((item) => item.sourceId),
  };
}
