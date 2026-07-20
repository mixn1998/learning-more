const citationPattern = /<!--\s*sources:\s*([^>]+?)\s*-->/giu;
const uncertaintyPattern =
  /证据不足|暂无证据|无法判断|insufficient evidence|no evidence|not enough evidence/iu;
const telemetryPattern = /\b(?:providerId|taskId|inputSnapshotHash|generationTaskId|latencyMs)\b/u;
const forbiddenNextStepsPattern = /下周(?:建议|计划)|下一步(?:建议|行动)/u;
const forbiddenNextStepsHeadingPattern =
  /^\s{0,3}(#{1,6})\s*(?:下周建议|下周计划|下一步建议|下一步行动)\s*$/iu;
const hanPattern = /\p{Script=Han}/u;
const markdownDecorationPattern = /[#>*_`~()-]/gu;

export const MAX_WEEKLY_REPORT_VISIBLE_CHARACTERS = 300;

function visibleCharacterCount(markdown: string): number {
  return Array.from(
    markdown
      .replace(citationPattern, '')
      .replace(markdownDecorationPattern, '')
      .replaceAll('[', '')
      .replaceAll(']', '')
      .replace(/\s/gu, ''),
  ).length;
}

export const EMPTY_WEEKLY_REPORT_MARKDOWN = '# 上周学习成果概括\n\n上周没有已完成课节。';

function stripForbiddenNextStepsSections(markdown: string): string {
  const lines = markdown.split(/\r?\n/u);
  const kept: string[] = [];
  let hiddenHeadingLevel: number | undefined;
  for (const line of lines) {
    const forbidden = line.match(forbiddenNextStepsHeadingPattern);
    if (forbidden !== null) {
      hiddenHeadingLevel = forbidden[1]!.length;
      continue;
    }
    if (hiddenHeadingLevel !== undefined) {
      const nextHeading = line.match(/^\s{0,3}(#{1,6})\s+/u);
      if (nextHeading === null || nextHeading[1]!.length > hiddenHeadingLevel) continue;
      hiddenHeadingLevel = undefined;
    }
    kept.push(line);
  }
  return kept.join('\n').trim();
}

export function validateWeeklyReportMarkdown(
  markdown: string,
  allowedSourceRefs: ReadonlySet<string>,
): Readonly<{ sourceRefs: readonly string[] }> {
  const normalized = markdown.trim();
  if (normalized === '') throw new Error('weekly_report_output_empty');
  if (allowedSourceRefs.size === 0 && normalized === EMPTY_WEEKLY_REPORT_MARKDOWN) {
    return { sourceRefs: [] };
  }
  if (telemetryPattern.test(normalized)) throw new Error('weekly_report_telemetry_forbidden');
  if (forbiddenNextStepsPattern.test(normalized)) {
    throw new Error('weekly_report_next_steps_forbidden');
  }
  if (!hanPattern.test(normalized)) throw new Error('weekly_report_language_must_be_zh_cn');
  if (visibleCharacterCount(normalized) > MAX_WEEKLY_REPORT_VISIBLE_CHARACTERS) {
    throw new Error('weekly_report_visible_text_too_long');
  }
  const referenced = new Set<string>();
  for (const match of normalized.matchAll(citationPattern)) {
    for (const ref of (match[1] ?? '').split(',').map((value) => value.trim())) {
      if (ref === '') continue;
      if (!allowedSourceRefs.has(ref)) throw new Error(`weekly_report_source_unsupported:${ref}`);
      referenced.add(ref);
    }
  }

  const blocks = normalized.split(/\r?\n\s*\r?\n/u);
  for (const block of blocks) {
    const visible = block.replace(citationPattern, '').trim();
    if (visible === '' || visible.split(/\r?\n/u).every((line) => /^\s*#{1,6}\s/u.test(line))) {
      continue;
    }
    if (uncertaintyPattern.test(visible)) continue;
    citationPattern.lastIndex = 0;
    if (!citationPattern.test(block)) throw new Error('weekly_report_claim_missing_source');
  }
  return { sourceRefs: [...referenced].sort() };
}

export function weeklyReportMarkdownForRead(markdown: string, factSnapshotCount: number): string {
  if (factSnapshotCount === 0) return EMPTY_WEEKLY_REPORT_MARKDOWN;
  return stripForbiddenNextStepsSections(markdown);
}
