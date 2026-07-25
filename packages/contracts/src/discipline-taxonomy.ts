export type DisciplineProjectionInput = Readonly<{
  disciplineTag?: string | undefined;
  title?: string | undefined;
  topicTags?: readonly string[] | undefined;
}>;

const SIMPLE_DISCIPLINE_ALIASES: readonly Readonly<{
  pattern: RegExp;
  label: string;
}>[] = [
  { pattern: /^(?:政治学|political science)$/iu, label: '政治' },
  { pattern: /^(?:经济学|economics?)$/iu, label: '经济' },
  { pattern: /^(?:社会学|sociology)$/iu, label: '社会' },
  { pattern: /^(?:心理学|psychology)$/iu, label: '心理' },
  { pattern: /^(?:历史学|history)$/iu, label: '历史' },
  { pattern: /^(?:法学|法律学|law)$/iu, label: '法律' },
];

const SOCIAL_SCIENCE_SIGNALS: readonly Readonly<{
  label: string;
  pattern: RegExp;
}>[] = [
  {
    label: '经济',
    pattern: /(?:经济|宏观|微观|供给|需求|价格|金融|货币|财政|贸易|汇率|市场竞争|博弈论)/u,
  },
  {
    label: '政治',
    pattern: /(?:政治|政体|国家能力|宪政|革命|统治|精英联盟|制度形成|联邦制|中央与地方|国家重构)/u,
  },
  { label: '法律', pattern: /(?:法律|法学|司法|法治|刑法|民法|合同法|宪法)/u },
  { label: '心理', pattern: /(?:心理|认知偏差|人格|情绪|心理治疗|心理健康)/u },
  {
    label: '社会',
    pattern:
      /(?:社会学|社会结构|社会关系|社会分层|社会再生产|婚育|家庭决策|劳动制度|住房与城市|群体差异|组织执行)/u,
  },
  { label: '历史', pattern: /(?:历史学|历史解释|历史制度|长时段|史学)/u },
];

function classifySocialScienceEvidence(input: DisciplineProjectionInput): string | undefined {
  const title = input.title?.trim() ?? '';
  const topicTags = input.topicTags ?? [];
  const ranked = SOCIAL_SCIENCE_SIGNALS.map((signal, order) => ({
    label: signal.label,
    order,
    score:
      (signal.pattern.test(title) ? 4 : 0) +
      topicTags.reduce((score, topicTag) => score + (signal.pattern.test(topicTag) ? 1 : 0), 0),
  }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);

  return ranked[0]?.label;
}

/**
 * Projects stored course metadata into the current reader-facing discipline
 * taxonomy without rewriting immutable outline versions or learning facts.
 */
export function projectDisciplineLabel(input: DisciplineProjectionInput): string | undefined {
  const normalized = input.disciplineTag?.trim();
  if (!normalized) return undefined;

  for (const alias of SIMPLE_DISCIPLINE_ALIASES) {
    if (alias.pattern.test(normalized)) return alias.label;
  }
  if (/(?:商业|创业|business|entrepreneur)/iu.test(normalized)) return '商业';
  if (/(?:数学|mathematics?|calculus)/iu.test(normalized)) return '数学';

  if (/^(?:社会科学|social sciences?)$/iu.test(normalized)) {
    return classifySocialScienceEvidence(input) ?? normalized;
  }

  return normalized;
}
