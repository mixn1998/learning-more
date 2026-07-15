export function toBroadDisciplineLabel(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  if (/(?:商业|创业|business|entrepreneur)/iu.test(normalized)) return '商业';
  if (/(?:数学|mathematics?|calculus)/iu.test(normalized)) return '数学';

  return normalized;
}
