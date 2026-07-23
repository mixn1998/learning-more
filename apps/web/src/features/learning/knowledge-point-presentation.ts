export type KnowledgePointPresentation = Readonly<{
  title: string;
  summary: string;
}>;

const MAX_NAVIGATION_TITLE_LENGTH = 24;

function clean(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function firstMeaningfulClause(value: string): string {
  const clauses = value
    .split(/[：:,，。；;！!？?]/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  return clauses.find((clause) => clause.length >= 4) ?? clauses[0] ?? value;
}

export function toKnowledgePointPresentation(text: string): KnowledgePointPresentation {
  const summary = clean(text);
  const clause = firstMeaningfulClause(summary);
  const title =
    clause.length <= MAX_NAVIGATION_TITLE_LENGTH
      ? clause
      : `${Array.from(clause)
          .slice(0, MAX_NAVIGATION_TITLE_LENGTH - 1)
          .join('')}…`;
  return { title: title || '核心知识点', summary: summary || '核心知识点' };
}

export function toLessonKnowledgeSummary(points: readonly string[]): readonly string[] {
  return points.map((point) => toKnowledgePointPresentation(point).title);
}
