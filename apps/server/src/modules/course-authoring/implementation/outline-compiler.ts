import { CandidateOutlineMetadataSchema } from './schemas/candidate-outline.js';

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
    const parsed = CandidateOutlineMetadataSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return {
        valid: false,
        draftArtifactRef: manifest.draftArtifactRef,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    const issues: { path: string; message: string }[] = [];
    const lessonIds = new Set<string>();
    for (const [index, lesson] of parsed.data.lessons.entries()) {
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
    const coveredSourceRefs = new Set(parsed.data.lessons.flatMap((lesson) => lesson.sourceRefs));
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
    const byId = new Map(parsed.data.lessons.map((lesson) => [lesson.id, lesson]));
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
        ...parsed.data,
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
