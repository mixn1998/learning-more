import type { LessonKnowledgeStructure } from '@learning-more/contracts';

export function resolveLessonKnowledgeStructure(input: {
  readonly coreKnowledgePoints: readonly string[];
  readonly knowledgeStructure?: LessonKnowledgeStructure;
  readonly objective?: string;
  readonly title?: string;
}): LessonKnowledgeStructure {
  if ((input.knowledgeStructure?.mainChain.length ?? 0) > 0) return input.knowledgeStructure!;
  const compatibleKnowledgePoints =
    input.coreKnowledgePoints.length > 0
      ? input.coreKnowledgePoints
      : [input.objective?.trim() || input.title?.trim() || '本课核心目标'];
  return {
    mainChain: compatibleKnowledgePoints.map((content, index) => ({
      id: `node_${index + 1}`,
      content,
      ...(index === compatibleKnowledgePoints.length - 1
        ? {}
        : { relationToNext: '为下一步理解提供基础' }),
    })),
    branches: [],
  };
}
