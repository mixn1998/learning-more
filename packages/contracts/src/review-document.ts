import { z } from 'zod';

const markdown = z.string().trim().min(1);
const identifier = z.string().trim().min(1).max(200);
const methodologyInsight = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !/[\r\n]/u.test(value));

export const ReviewTextBlockSchema = z.looseObject({
  title: markdown,
  markdown,
  evidenceRefs: z.array(identifier).optional(),
});

const additionalSections = z.array(ReviewTextBlockSchema).optional();

export const LessonFinalReviewDocumentSchema = z.looseObject({
  schemaVersion: z.literal(1),
  kind: z.literal('lesson-final'),
  title: markdown,
  knowledgeMap: ReviewTextBlockSchema,
  methodologyInsight: methodologyInsight.optional(),
  coreInsight: markdown,
  performance: z.array(ReviewTextBlockSchema).min(1),
  additionalSections,
});

export const LessonStageReviewDocumentSchema = z.looseObject({
  schemaVersion: z.literal(1),
  kind: z.literal('lesson-stage'),
  title: markdown,
  lead: markdown,
  establishedUnderstanding: z.array(ReviewTextBlockSchema),
  pendingValidation: z.array(ReviewTextBlockSchema),
  knowledgeMap: ReviewTextBlockSchema,
  performance: z.array(ReviewTextBlockSchema).min(1),
  continuationNotice: markdown,
  additionalSections,
});

export const CourseFinalReviewDocumentSchema = z.looseObject({
  schemaVersion: z.literal(1),
  kind: z.literal('course-final'),
  title: markdown,
  lead: markdown.optional(),
  knowledgeThreads: z.array(ReviewTextBlockSchema).min(1),
  strengths: z.array(ReviewTextBlockSchema).min(1),
  development: z.array(ReviewTextBlockSchema).min(1),
  boundaries: z.array(ReviewTextBlockSchema).min(1),
  extensions: z.array(ReviewTextBlockSchema),
  sourceCoverage: z
    .looseObject({
      finalReviewCount: z.number().int().nonnegative(),
      stageReviewCount: z.number().int().nonnegative(),
      missingLessonIds: z.array(identifier),
    })
    .optional(),
  additionalSections,
});

export const ReviewDocumentSchema = z.discriminatedUnion('kind', [
  LessonFinalReviewDocumentSchema,
  LessonStageReviewDocumentSchema,
  CourseFinalReviewDocumentSchema,
]);

export type ReviewTextBlock = Readonly<z.infer<typeof ReviewTextBlockSchema>>;
export type LessonFinalReviewDocument = Readonly<z.infer<typeof LessonFinalReviewDocumentSchema>>;
export type LessonStageReviewDocument = Readonly<z.infer<typeof LessonStageReviewDocumentSchema>>;
export type CourseFinalReviewDocument = Readonly<z.infer<typeof CourseFinalReviewDocumentSchema>>;
export type ReviewDocument = Readonly<z.infer<typeof ReviewDocumentSchema>>;

function blockMarkdown(block: ReviewTextBlock): string {
  return `## ${block.title}\n\n${block.markdown.trim()}`;
}

export function reviewDocumentToMarkdown(document: ReviewDocument): string {
  if (document.kind === 'lesson-final') {
    return [
      `# ${document.title}`,
      blockMarkdown(document.knowledgeMap),
      ...(document.methodologyInsight === undefined
        ? []
        : [`## 本课方法论启示\n\n${document.methodologyInsight.trim()}`]),
      `## 核心思想\n\n${document.coreInsight.trim()}`,
      '## 学习表现评价',
      ...document.performance.map(blockMarkdown),
      ...(document.additionalSections ?? []).map(blockMarkdown),
    ].join('\n\n');
  }
  if (document.kind === 'lesson-stage') {
    return [
      `# ${document.title}`,
      document.lead.trim(),
      ...document.establishedUnderstanding.map(blockMarkdown),
      ...document.pendingValidation.map(blockMarkdown),
      blockMarkdown(document.knowledgeMap),
      '## 学习表现',
      ...document.performance.map(blockMarkdown),
      document.continuationNotice.trim(),
      ...(document.additionalSections ?? []).map(blockMarkdown),
    ].join('\n\n');
  }
  return [
    `# ${document.title}`,
    document.lead?.trim(),
    '## 主题核心知识线索',
    ...document.knowledgeThreads.map(blockMarkdown),
    '## 总体学习表现',
    ...document.strengths.map(blockMarkdown),
    ...document.development.map(blockMarkdown),
    '## 可继续探索的知识边界',
    ...document.boundaries.map(blockMarkdown),
    '## 推荐扩展课程',
    ...document.extensions.map(blockMarkdown),
    ...(document.additionalSections ?? []).map(blockMarkdown),
  ]
    .filter((value): value is string => value !== undefined && value.trim() !== '')
    .join('\n\n');
}
