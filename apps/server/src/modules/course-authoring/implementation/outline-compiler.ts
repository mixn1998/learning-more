import { CandidateModelResponseSchema } from './schemas/candidate-outline.js';

export interface CandidateInputManifest {
  readonly draftArtifactRef: string;
  readonly sourceRefs: readonly string[];
  readonly requiredSourceRefs?: readonly string[];
}

export type CandidateCompilationResult =
  | Readonly<{
      valid: true;
      candidate: {
        outlineMarkdown: string;
        courseGoals: readonly string[];
        disciplineTag: string;
        topicTags: readonly string[];
        modules: readonly {
          id: string;
          title: string;
          lessonIds: readonly string[];
        }[];
        lessons: readonly {
          id: string;
          title: string;
          objective: string;
          coreKnowledgePoints: readonly string[];
          prerequisiteLessonIds: readonly string[];
          estimatedMinutes: number;
          sourceRefs: readonly string[];
        }[];
      };
    }>
  | Readonly<{
      valid: false;
      draftArtifactRef: string;
      issues: readonly { path: string; message: string }[];
    }>;

export function compileCandidate(
  markdown: string,
  manifest: CandidateInputManifest,
): CandidateCompilationResult {
  const match = /^```learning-more-outline\s*\r?\n([\s\S]*?)\r?\n```\s*\r?\n([\s\S]+)$/u.exec(
    markdown,
  );
  if (match === null) {
    return {
      valid: false,
      draftArtifactRef: manifest.draftArtifactRef,
      issues: [{ path: 'metadata', message: '缺少受限的大纲 metadata block' }],
    };
  }
  try {
    const parsedJson = JSON.parse(match[1] ?? '') as unknown;
    const response = CandidateModelResponseSchema.safeParse(parsedJson);
    if (!response.success) {
      return {
        valid: false,
        draftArtifactRef: manifest.draftArtifactRef,
        issues: response.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    const parsed = response.data.outline;
    const issues: { path: string; message: string }[] = [];
    const lessonIds = new Set<string>();
    for (const [index, lesson] of parsed.lessons.entries()) {
      if (lessonIds.has(lesson.id)) {
        issues.push({ path: `lessons.${index}.id`, message: 'lesson ID 必须唯一' });
      }
      lessonIds.add(lesson.id);
      for (const sourceRef of lesson.sourceRefs) {
        if (!manifest.sourceRefs.includes(sourceRef)) {
          issues.push({
            path: `lessons.${index}.sourceRefs`,
            message: `未知 sourceRef: ${sourceRef}`,
          });
        }
      }
    }
    const moduleIds = new Set<string>();
    const lessonAssignments = new Map<string, number>();
    for (const [index, module] of parsed.modules.entries()) {
      if (moduleIds.has(module.id)) {
        issues.push({ path: `modules.${index}.id`, message: 'module ID 必须唯一' });
      }
      moduleIds.add(module.id);
      const localLessonIds = new Set<string>();
      for (const lessonId of module.lessonIds) {
        if (localLessonIds.has(lessonId)) {
          issues.push({
            path: `modules.${index}.lessonIds`,
            message: `模块内重复引用课节: ${lessonId}`,
          });
        }
        localLessonIds.add(lessonId);
        if (!lessonIds.has(lessonId)) {
          issues.push({
            path: `modules.${index}.lessonIds`,
            message: `未知课节: ${lessonId}`,
          });
        }
        lessonAssignments.set(lessonId, (lessonAssignments.get(lessonId) ?? 0) + 1);
      }
    }
    for (const lessonId of lessonIds) {
      const assignments = lessonAssignments.get(lessonId) ?? 0;
      if (assignments !== 1) {
        issues.push({
          path: 'modules.lessonIds',
          message:
            assignments === 0
              ? `课节未归入任何模块: ${lessonId}`
              : `课节只能归入一个模块: ${lessonId}`,
        });
      }
    }
    const coveredSourceRefs = new Set(parsed.lessons.flatMap((lesson) => lesson.sourceRefs));
    for (const requiredSourceRef of manifest.requiredSourceRefs ?? []) {
      if (!coveredSourceRefs.has(requiredSourceRef)) {
        issues.push({
          path: 'lessons.sourceRefs',
          message: `重要材料范围未覆盖: ${requiredSourceRef}`,
        });
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const byId = new Map(parsed.lessons.map((lesson) => [lesson.id, lesson]));
    function visit(lessonId: string): void {
      if (visiting.has(lessonId)) {
        issues.push({ path: 'lessons.prerequisiteLessonIds', message: '先修关系存在循环' });
        return;
      }
      if (visited.has(lessonId)) return;
      visiting.add(lessonId);
      for (const prerequisiteId of byId.get(lessonId)?.prerequisiteLessonIds ?? []) {
        if (!byId.has(prerequisiteId)) {
          issues.push({
            path: 'lessons.prerequisiteLessonIds',
            message: `未知先修课节: ${prerequisiteId}`,
          });
        } else {
          visit(prerequisiteId);
        }
      }
      visiting.delete(lessonId);
      visited.add(lessonId);
    }
    for (const lessonId of lessonIds) visit(lessonId);
    const outlineMarkdown = (match[2] ?? '').trim();
    if (/<\/?[a-z][^>]*>/iu.test(outlineMarkdown)) {
      issues.push({ path: 'outlineMarkdown', message: 'Markdown 不允许包含 HTML' });
    }
    if (issues.length > 0) {
      return { valid: false, draftArtifactRef: manifest.draftArtifactRef, issues };
    }
    return {
      valid: true,
      candidate: {
        ...parsed,
        outlineMarkdown,
      },
    };
  } catch (error) {
    return {
      valid: false,
      draftArtifactRef: manifest.draftArtifactRef,
      issues: [{ path: 'metadata', message: error instanceof Error ? error.message : 'JSON 无效' }],
    };
  }
}
