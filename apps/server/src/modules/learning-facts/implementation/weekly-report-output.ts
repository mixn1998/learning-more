const citationPattern = /<!--\s*sources:\s*([^>]+?)\s*-->/giu;
const uncertaintyPattern =
  /证据不足|暂无证据|无法判断|insufficient evidence|no evidence|not enough evidence/iu;
const telemetryPattern = /\b(?:providerId|taskId|inputSnapshotHash|generationTaskId|latencyMs)\b/u;

export function validateWeeklyReportMarkdown(
  markdown: string,
  allowedSourceRefs: ReadonlySet<string>,
): Readonly<{ sourceRefs: readonly string[] }> {
  const normalized = markdown.trim();
  if (normalized === '') throw new Error('weekly_report_output_empty');
  if (telemetryPattern.test(normalized)) throw new Error('weekly_report_telemetry_forbidden');
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
