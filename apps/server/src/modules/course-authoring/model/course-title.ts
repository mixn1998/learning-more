function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_~]/gu, '')
    .replace(/\s+#+\s*$/u, '')
    .trim();
}

export function extractOutlineMainTitle(markdown: string): string | undefined {
  let fenced = false;
  for (const rawLine of markdown
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')) {
    if (/^\s*```/u.test(rawLine)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^\s*#\s+(.+?)\s*$/u.exec(rawLine);
    if (heading === null) continue;
    const title = stripInlineMarkdown(heading[1] ?? '');
    return title === '' ? undefined : title;
  }
  return undefined;
}

export function resolveCourseTitle(outlineMarkdown: string, fallbackTitle: string): string {
  return extractOutlineMainTitle(outlineMarkdown) ?? fallbackTitle.trim();
}
