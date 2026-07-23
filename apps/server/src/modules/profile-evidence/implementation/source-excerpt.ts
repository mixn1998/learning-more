export type SourceExcerpt = Readonly<{
  sourceRef: string;
  excerpt: string;
}>;

function sanitize(value: string, maxCharacters: number): string {
  const withoutControlCharacters = [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint === 9 || codePoint === 10 || codePoint === 13 || codePoint >= 32;
    })
    .join('');
  return withoutControlCharacters
    .replace(/<[^>]*>/gu, ' ')
    .replaceAll('\u007F', '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxCharacters);
}

export async function readTransientSourceExcerpts(
  input: Readonly<{
    sourceRefs: readonly string[];
    readSource(sourceRef: string): Promise<string | undefined>;
    maxSources?: number;
    maxCharactersPerSource?: number;
  }>,
): Promise<readonly SourceExcerpt[]> {
  const maxSources = input.maxSources ?? 3;
  const maxCharacters = input.maxCharactersPerSource ?? 1_000;
  if (maxSources < 0 || maxCharacters < 0) throw new RangeError('source_excerpt_limit_invalid');
  const excerpts: SourceExcerpt[] = [];
  for (const sourceRef of [...new Set(input.sourceRefs)].slice(0, maxSources)) {
    const source = await input.readSource(sourceRef);
    if (source === undefined) continue;
    excerpts.push(Object.freeze({ sourceRef, excerpt: sanitize(source, maxCharacters) }));
  }
  return Object.freeze(excerpts);
}
