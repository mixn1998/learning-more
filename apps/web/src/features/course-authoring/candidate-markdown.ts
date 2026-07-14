import { CandidateModelResponseSchema } from '@learning-more/contracts';

import type { OutlineWorkspaceModule } from './outline-workspace-view.js';

export type ParsedCandidateMarkdown = Readonly<{
  title: string;
  summary: string;
  discipline?: string | undefined;
  tags: readonly string[];
  modules: readonly OutlineWorkspaceModule[];
}>;

const structuredCandidatePattern =
  /^```learning-more-outline\s*\r?\n([\s\S]*?)\r?\n```\s*\r?\n([\s\S]+)$/u;

function markdownTitle(markdown: string): string | undefined {
  return /^#{1,6}\s+(.+?)\s*$/mu.exec(markdown)?.[1]?.trim();
}

function plainMarkdownItems(markdown: string): readonly string[] {
  return [...markdown.matchAll(/^\s*(?:[-*+] |\d+[.)]\s+)(.+?)\s*$/gmu)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => value !== undefined && value !== '');
}

function firstPlainParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(
      (line) =>
        line !== '' &&
        !line.startsWith('#') &&
        !/^\s*(?:[-*+] |\d+[.)]\s+)/u.test(line) &&
        !line.startsWith('```'),
    );
}

export function parseCandidateMarkdown(markdown: string): ParsedCandidateMarkdown | undefined {
  if (markdown.trim() === '') return undefined;

  const structured = structuredCandidatePattern.exec(markdown);
  if (structured !== null) {
    try {
      const response = CandidateModelResponseSchema.safeParse(
        JSON.parse(structured[1] ?? '') as unknown,
      );
      if (response.success) {
        const metadata = response.data.outline;
        const body = (structured[2] ?? '').trim();
        const lessons = new Map(metadata.lessons.map((lesson) => [lesson.id, lesson]));
        return {
          title: markdownTitle(body) ?? metadata.courseGoals[0]!,
          summary: metadata.courseGoals.join('；'),
          discipline: metadata.disciplineTag,
          tags: metadata.topicTags,
          modules: metadata.modules.map((module) => ({
            title: module.title,
            lessons: module.lessonIds.flatMap((lessonId) => {
              const lesson = lessons.get(lessonId);
              return lesson === undefined
                ? []
                : [
                    {
                      title: lesson.objective,
                      points: lesson.coreKnowledgePoints,
                      ...(lesson.sourceRefs.every((sourceRef) => sourceRef === 'source_topic')
                        ? {}
                        : { source: lesson.sourceRefs.join('、') }),
                    },
                  ];
            }),
          })),
        };
      }
    } catch {
      // Partial SSE payloads are expected while generation is still in progress.
    }
  }

  const title = markdownTitle(markdown) ?? '候选课程大纲';
  const items = plainMarkdownItems(markdown);
  return {
    title,
    summary: firstPlainParagraph(markdown) ?? '候选内容已生成，等待确认。',
    tags: [],
    modules: [
      {
        title: '候选课程结构',
        lessons: (items.length === 0 ? [title] : items).map((item) => ({
          title: item,
          points: [],
        })),
      },
    ],
  };
}
