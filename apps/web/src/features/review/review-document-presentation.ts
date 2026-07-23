import type { ReviewTextBlock } from '@learning-more/contracts';

type ReviewPresentationInput = Readonly<{
  knowledgeMap: ReviewTextBlock;
  methodologyInsight?: string | undefined;
  coreInsight: string;
  performance: readonly ReviewTextBlock[];
  additionalSections?: readonly ReviewTextBlock[] | undefined;
  legacyMarkdown?: string | undefined;
}>;

const NEXT_JUDGMENT_TITLE = /接下来|下一步|尚待|待验证|仍需|继续|未解决|局限|不足/u;
const STRENGTH_TITLE = /你做得.*好|做得好的地方/u;
const ADJACENT_EXPLORATION_TITLE = /课程邻接探索|邻接探索/u;
const METHODOLOGY_INSIGHT_TITLE =
  /^(?:本课)?(?:方法论启示|(?:可以|可)带走的一句话)(?:（[^）]*）)?$/u;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}

function trimPrefix(value: string): string {
  return value
    .replace(/^[-*+]\s+/u, '')
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^本课(?:建立的)?(?:知识)?主链(?:条)?是[：:]\s*/u, '')
    .trim();
}

function conciseSentence(value: string, limit = 220): string {
  const normalized = trimPrefix(value).replaceAll(/\s+/gu, ' ');
  if (normalized.length <= limit) return normalized;
  const sentence = normalized.slice(0, limit + 1).match(/^.{1,220}?[。！？；]/u)?.[0];
  return sentence ?? `${normalized.slice(0, limit).trimEnd()}…`;
}

function normalizedSectionTitle(value: string): string {
  return value.replaceAll(/[\s:：]/gu, '').trim();
}

function isMethodologyInsightTitle(value: string): boolean {
  return METHODOLOGY_INSIGHT_TITLE.test(normalizedSectionTitle(value));
}

function methodologyInsightText(markdown: string): string | undefined {
  const units = markdownUnits(markdown);
  const value = conciseSentence(units.join(' '), 240);
  return value === '' ? undefined : value;
}

function methodologyInsightFromCoreInsight(coreInsight: string): string | undefined {
  const paragraphs = coreInsight
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const preferred = paragraphs.find((paragraph) =>
    /^(?:核心方法|解决方法|可以先|检查这条链时)/u.test(paragraph),
  );
  const candidate = preferred ?? paragraphs[0];
  if (candidate === undefined) return undefined;
  const normalized = candidate.replace(/^(?:核心方法|解决方法)是[：:]?\s*/u, '').trim();
  const withoutList = normalized.split(/\s+[-*+]\s+/u)[0]?.trim() ?? normalized;
  return methodologyInsightText(withoutList);
}

function methodologyInsightFromLegacyMarkdown(markdown: string | undefined): string | undefined {
  if (markdown === undefined) return undefined;
  const lines = markdown.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index]?.match(/^#{1,6}\s*(.*?)\s*$/u)?.[1];
    if (heading === undefined || !isMethodologyInsightTitle(heading)) continue;
    const content: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^#{1,6}\s+/u.test(lines[next] ?? '')) break;
      content.push(lines[next] ?? '');
    }
    const value = methodologyInsightText(content.join('\n'));
    if (value !== undefined) return value;
  }
  return undefined;
}

function projectMethodologyInsight(input: ReviewPresentationInput): string | undefined {
  const explicit = input.methodologyInsight?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;

  const legacyBlock = input.additionalSections?.find((block) =>
    isMethodologyInsightTitle(block.title),
  );
  const fromBlock =
    legacyBlock === undefined ? undefined : methodologyInsightText(legacyBlock.markdown);
  return (
    fromBlock ??
    methodologyInsightFromLegacyMarkdown(input.legacyMarkdown) ??
    methodologyInsightFromCoreInsight(input.coreInsight)
  );
}

function markdownUnits(markdown: string): string[] {
  const lines = markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const listItems = lines.filter((line) => /^[-*+]\s+/u.test(line));
  if (listItems.length > 0) return listItems.map(trimPrefix);
  return markdown
    .split(/\r?\n\s*\r?\n/u)
    .map((value) => conciseSentence(value))
    .filter((value) => value !== '');
}

function treeKnowledgeNodes(markdown: string): string[] {
  return unique(
    [...markdown.replaceAll(/\r?\n/gu, ' ').matchAll(/(?:^|\s)[├└]─\s*(.*?)(?=\s+[├└]─|$)/gu)]
      .map((match) => trimPrefix(match[1] ?? ''))
      .filter((node) => node !== ''),
  ).slice(0, 9);
}

function projectKnowledgeMap(block: ReviewTextBlock): ReviewTextBlock {
  const relationLines = block.markdown
    .split(/\r?\n/u)
    .map((line) => trimPrefix(line).replace(/[。；：:,.!?！？]+$/u, ''))
    .filter((line) => (line.match(/(?:→|⇒|->)/gu) ?? []).length >= 2)
    .sort((left, right) => {
      const relationDifference =
        (right.match(/(?:→|⇒|->)/gu) ?? []).length - (left.match(/(?:→|⇒|->)/gu) ?? []).length;
      return relationDifference === 0 ? left.length - right.length : relationDifference;
    });
  const boldTerms = unique(
    [...block.markdown.matchAll(/\*\*([^*\r\n]{1,40})\*\*/gu)].map((match) =>
      (match[1] ?? '').trim(),
    ),
  ).slice(0, 8);
  const treeNodes = treeKnowledgeNodes(block.markdown);
  const markdown =
    relationLines[0] ??
    (treeNodes.length >= 2
      ? treeNodes.join(' → ')
      : boldTerms.length >= 2
        ? boldTerms.join(' → ')
        : conciseSentence(markdownUnits(block.markdown)[0] ?? block.markdown, 320));
  return { ...block, markdown };
}

function knowledgeMapNodes(markdown: string): readonly string[] {
  return markdown
    .split(/\s*(?:→|⇒|->)\s*/u)
    .map((node) => node.replaceAll(/[*_`#]/gu, '').trim())
    .filter((node) => node !== '')
    .slice(0, 9);
}

function projectCoreInsight(markdown: string): string {
  if (markdown.trim().length <= 1_200) return markdown.trim();
  const blocks = markdown
    .split(/\r?\n\s*\r?\n/u)
    .map((block) => block.trim())
    .filter((block) => block !== '');
  const opening = blocks.filter((block) => !/^[-*+]\s+/u.test(block)).slice(0, 2);
  const list = blocks.find((block) => /^[-*+]\s+/u.test(block));
  const listProjection =
    list === undefined
      ? undefined
      : list
          .split(/\r?\n/u)
          .filter((line) => /^[-*+]\s+/u.test(line.trim()))
          .slice(0, 4)
          .join('\n');
  const conclusion = blocks.find(
    (block, index) => index >= 2 && /^(?:因此|所以|核心结论|由此)/u.test(block),
  );
  return unique([
    ...opening,
    listProjection ?? '',
    conclusion === undefined ? '' : conciseSentence(conclusion, 320),
  ]).join('\n\n');
}

function compactBlocks(
  blocks: readonly ReviewTextBlock[],
  title: string,
  limit: number,
): ReviewTextBlock {
  const evidenceRefs = unique(blocks.flatMap((block) => [...(block.evidenceRefs ?? [])]));
  const markdown = blocks
    .flatMap((block) => markdownUnits(block.markdown).slice(0, blocks.length === 1 ? limit : 1))
    .map((unit) => conciseSentence(unit))
    .filter((unit) => unit !== '')
    .slice(0, limit)
    .map((unit) => `- ${unit}`)
    .join('\n');
  return {
    title,
    markdown: markdown || '- 当前 Review 未形成可展示的归纳条目。',
    ...(evidenceRefs.length === 0 ? {} : { evidenceRefs }),
  };
}

function projectPerformance(
  performance: readonly ReviewTextBlock[],
): readonly [ReviewTextBlock, ReviewTextBlock] {
  const explicitStrength = performance.find((block) => STRENGTH_TITLE.test(block.title));
  const explicitNext = performance.find((block) => NEXT_JUDGMENT_TITLE.test(block.title));
  if (performance.length === 2 && explicitStrength !== undefined && explicitNext !== undefined) {
    return [
      compactBlocks([explicitStrength], '你做得好的地方', 4),
      compactBlocks([explicitNext], '接下来的判断', 5),
    ];
  }

  let next = performance.filter((block) => NEXT_JUDGMENT_TITLE.test(block.title));
  let strengths = performance.filter((block) => !next.includes(block));
  if (next.length === 0 && performance.length > 1) {
    next = performance.slice(-1);
    strengths = performance.slice(0, -1);
  }
  if (strengths.length === 0 && performance[0] !== undefined) strengths = [performance[0]];
  return [compactBlocks(strengths, '你做得好的地方', 4), compactBlocks(next, '接下来的判断', 5)];
}

export function projectLessonReviewDocument(input: ReviewPresentationInput) {
  const knowledgeMap = projectKnowledgeMap(input.knowledgeMap);
  const methodologyInsight = projectMethodologyInsight(input);
  return {
    knowledgeMap,
    knowledgeMapNodes: knowledgeMapNodes(knowledgeMap.markdown),
    ...(methodologyInsight === undefined ? {} : { methodologyInsight }),
    coreInsight: projectCoreInsight(input.coreInsight),
    performance: projectPerformance(input.performance),
    adjacentExploration: (input.additionalSections ?? []).filter((block) =>
      ADJACENT_EXPLORATION_TITLE.test(block.title),
    ),
  };
}

export function projectLegacyReviewMarkdown(markdown: string): string {
  return markdown.replace(
    /^(#{1,6})\s*(?:本课)?(?:可以|可)带走的一句话(?:（[^）]*）)?\s*$/gmu,
    '$1 本课方法论启示',
  );
}
