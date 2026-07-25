function hasControlValue(raw, keyPattern, valuePattern) {
  return new RegExp(`"${keyPattern}"\\s*:\\s*"${valuePattern}"`, 'u').test(String(raw ?? ''));
}

function isComprehensiveApplication(candidate) {
  return hasControlValue(candidate.task?.raw, 'lessonPhase', 'comprehensive_application');
}

function settlesComprehensiveApplication(candidate) {
  return (
    hasControlValue(
      candidate.task?.raw,
      'comprehensive(?:Application|Check)',
      '(?:completed|skipped)',
    ) ||
    (hasControlValue(candidate.task?.raw, 'lessonPhase', 'discussion') &&
      hasControlValue(
        candidate.task?.raw,
        'comprehensive(?:Application|Check)',
        '(?:completed|skipped)',
      ))
  );
}

export function selectComprehensiveApplicationAssistantReplies(candidates) {
  const startIndex = candidates.findIndex(isComprehensiveApplication);
  if (startIndex >= 0) {
    const relativeEndIndex = candidates
      .slice(startIndex)
      .findIndex(settlesComprehensiveApplication);
    const endIndex = relativeEndIndex < 0 ? candidates.length - 1 : startIndex + relativeEndIndex;
    return candidates
      .slice(startIndex, endIndex + 1)
      .map((candidate) => candidate.task?.reply?.trim())
      .filter((reply) => typeof reply === 'string' && reply.length > 0);
  }

  const terminal = candidates.findLast(settlesComprehensiveApplication);
  const fallback = terminal?.task?.reply?.trim();
  return typeof fallback === 'string' && fallback.length > 0 ? [fallback] : [];
}

export function renderComprehensiveApplicationSegment(replies) {
  return replies
    .map((reply, index) => `【综合应用片段 ${index + 1}】\n${reply.trim()}`)
    .join('\n\n');
}
