const citationPattern = /<!--\s*sources:\s*([^>]+?)\s*-->/giu;
const uncertaintyPattern =
  /证据不足|暂无证据|无法判断|insufficient evidence|no evidence|not enough evidence/iu;
const telemetryPattern = /\b(?:providerId|taskId|inputSnapshotHash|generationTaskId|latencyMs)\b/u;
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

export const EMPTY_WEEKLY_REPORT_MARKDOWN =
  '# 本周学习回顾\n\n本周快照中没有可用于分析的学习记录，因此暂不对学习活动、进展、困难或下一步作出判断。';

export function validateWeeklyReportMarkdown(
  markdown: string,
  allowedSourceRefs: ReadonlySet<string>,
): Readonly<{ sourceRefs: readonly string[] }> {
  const normalized = markdown.trim();
  if (normalized === '') throw new Error('weekly_report_output_empty');
  if (telemetryPattern.test(normalized)) throw new Error('weekly_report_telemetry_forbidden');
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
  if (factSnapshotCount === 0 && !hanPattern.test(markdown)) return EMPTY_WEEKLY_REPORT_MARKDOWN;
  return markdown;
}
