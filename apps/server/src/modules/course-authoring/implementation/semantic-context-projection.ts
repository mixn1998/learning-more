const DECISION_SIGNAL =
  /目标|希望|需要|应当|应该|必须|不要|不能|保留|删除|调整|修改|合并|重构|改成|不是|而是|边界|约束|确认|决定|分歧|例外|未解决|重点|优先/u;

type SemanticUnit = Readonly<{
  index: number;
  text: string;
  decisionBearing: boolean;
}>;

function semanticUnits(text: string): readonly SemanticUnit[] {
  const matches = text.match(/[^。！？!?；;，,：:\r\n]+[。！？!?；;，,：:]?/gu) ?? [];
  const seen = new Set<string>();
  const units: SemanticUnit[] = [];
  for (const [index, value] of matches.entries()) {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    const semanticKey = normalized.toLocaleLowerCase();
    if (normalized.length === 0 || seen.has(semanticKey)) continue;
    seen.add(semanticKey);
    units.push({
      index,
      text: normalized,
      decisionBearing: DECISION_SIGNAL.test(normalized),
    });
  }
  return units;
}

function renderedLength(units: readonly SemanticUnit[]): number {
  return units.reduce((total, unit) => total + unit.text.length + 1, 0);
}

/**
 * Projects long prose into complete semantic units. It never cuts through a
 * sentence or clause: decision-bearing and recent units win the available
 * budget, while repeated elaboration disappears.
 */
export function projectSemanticText(text: string, maxCharacters: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxCharacters) return trimmed;

  const units = semanticUnits(text);
  const selected = new Map<number, SemanticUnit>();
  const priority = [...units].sort(
    (left, right) =>
      Number(right.decisionBearing) - Number(left.decisionBearing) || right.index - left.index,
  );
  for (const unit of priority) {
    const next = [...selected.values(), unit].sort((left, right) => left.index - right.index);
    if (renderedLength(next) <= maxCharacters) selected.set(unit.index, unit);
  }
  return [...selected.values()]
    .sort((left, right) => left.index - right.index)
    .map((unit) => unit.text)
    .join(' ');
}

export function selectSemanticItems(
  items: readonly string[],
  maxCharacters: number,
): Readonly<{ selected: readonly string[]; omitted: number }> {
  const selected: string[] = [];
  let used = 0;
  for (const item of items) {
    const normalized = item.replace(/\s+/gu, ' ').trim();
    if (normalized.length === 0) continue;
    const separatorLength = selected.length === 0 ? 0 : 1;
    if (used + separatorLength + normalized.length > maxCharacters) continue;
    selected.push(normalized);
    used += separatorLength + normalized.length;
  }
  return { selected, omitted: items.length - selected.length };
}
