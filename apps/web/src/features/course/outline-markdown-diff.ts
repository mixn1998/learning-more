import {
  normalizeOutlineTitle,
  projectOutlineMarkdown,
  type OutlineMarkdownProjection,
  type OutlineProjectionLesson,
  type OutlineProjectionLessonInput,
  type OutlineProjectionModule,
} from './outline-markdown-projection.js';

export type OutlineChangeStatus = 'unchanged' | 'modified' | 'added' | 'removed';

export type OutlineLessonDiff = Readonly<{
  key: string;
  title: string;
  status: OutlineChangeStatus;
  base?: OutlineProjectionLesson | undefined;
  candidate?: OutlineProjectionLesson | undefined;
}>;

export type OutlineModuleDiff = Readonly<{
  key: string;
  title: string;
  status: OutlineChangeStatus;
  lessons: readonly OutlineLessonDiff[];
  base?: OutlineProjectionModule | undefined;
  candidate?: OutlineProjectionModule | undefined;
}>;

export type OutlineMarkdownDiff = Readonly<{
  base: OutlineMarkdownProjection;
  candidate: OutlineMarkdownProjection;
  modules: readonly OutlineModuleDiff[];
}>;

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function sameContent(
  base: Readonly<{ title: string; markdown: string }>,
  candidate: Readonly<{ title: string; markdown: string }>,
): boolean {
  return (
    normalizeOutlineTitle(base.title) === normalizeOutlineTitle(candidate.title) &&
    normalizeMarkdown(base.markdown) === normalizeMarkdown(candidate.markdown)
  );
}

function matchByTitle<T extends Readonly<{ title: string }>>(
  items: readonly T[],
  title: string,
  used: ReadonlySet<number>,
): number | undefined {
  const normalized = normalizeOutlineTitle(title);
  const index = items.findIndex(
    (item, itemIndex) => !used.has(itemIndex) && normalizeOutlineTitle(item.title) === normalized,
  );
  return index < 0 ? undefined : index;
}

function diffLessons(
  baseLessons: readonly OutlineProjectionLesson[],
  candidateLessons: readonly OutlineProjectionLesson[],
): readonly OutlineLessonDiff[] {
  const usedBase = new Set<number>();
  const result: OutlineLessonDiff[] = candidateLessons.map((candidate, candidateIndex) => {
    const baseIndex = matchByTitle(baseLessons, candidate.title, usedBase);
    if (baseIndex === undefined) {
      return {
        key: `candidate-${candidate.key}-${candidateIndex}`,
        title: candidate.title,
        status: 'added',
        candidate,
      };
    }
    usedBase.add(baseIndex);
    const base = baseLessons[baseIndex];
    if (base === undefined) throw new Error('outline_diff_match_missing');
    return {
      key: `matched-${base.key}-${candidate.key}`,
      title: candidate.title,
      status: sameContent(base, candidate) ? 'unchanged' : 'modified',
      base,
      candidate,
    };
  });

  baseLessons.forEach((base, baseIndex) => {
    if (usedBase.has(baseIndex)) return;
    result.push({
      key: `base-${base.key}-${baseIndex}`,
      title: base.title,
      status: 'removed',
      base,
    });
  });
  return result;
}

function exactLessonOverlap(
  base: OutlineProjectionModule,
  candidate: OutlineProjectionModule,
): number {
  const baseTitles = new Set(base.lessons.map((lesson) => normalizeOutlineTitle(lesson.title)));
  return candidate.lessons.filter((lesson) => baseTitles.has(normalizeOutlineTitle(lesson.title)))
    .length;
}

function matchModule(
  baseModules: readonly OutlineProjectionModule[],
  candidate: OutlineProjectionModule,
  usedBase: ReadonlySet<number>,
): number | undefined {
  const titleMatch = matchByTitle(baseModules, candidate.title, usedBase);
  if (titleMatch !== undefined) return titleMatch;

  const overlaps = baseModules
    .map((base, index) => ({
      index,
      overlap: usedBase.has(index) ? 0 : exactLessonOverlap(base, candidate),
    }))
    .filter(({ overlap }) => overlap > 0)
    .sort((left, right) => right.overlap - left.overlap);
  const best = overlaps[0];
  const second = overlaps[1];
  if (best === undefined || best.overlap === second?.overlap) return undefined;
  return best.index;
}

function asUngroupedModule(
  projection: OutlineMarkdownProjection,
): readonly OutlineProjectionModule[] {
  if (projection.ungroupedLessons.length === 0) return projection.modules;
  return [
    ...projection.modules,
    {
      key: 'ungrouped-lessons',
      title: '未分组课程',
      markdown: '',
      lessons: projection.ungroupedLessons,
    },
  ];
}

export function diffOutlineMarkdown(
  baseMarkdown: string,
  candidateMarkdown: string,
  baseLessons?: readonly OutlineProjectionLessonInput[],
): OutlineMarkdownDiff {
  const base = projectOutlineMarkdown(baseMarkdown, baseLessons);
  const candidate = projectOutlineMarkdown(candidateMarkdown);
  const baseModules = asUngroupedModule(base);
  const candidateModules = asUngroupedModule(candidate);
  const usedBase = new Set<number>();
  const modules: OutlineModuleDiff[] = candidateModules.map((candidateModule, candidateIndex) => {
    const baseIndex = matchModule(baseModules, candidateModule, usedBase);
    if (baseIndex === undefined) {
      return {
        key: `candidate-${candidateModule.key}-${candidateIndex}`,
        title: candidateModule.title,
        status: 'added',
        lessons: candidateModule.lessons.map((lesson, lessonIndex) => ({
          key: `candidate-${lesson.key}-${lessonIndex}`,
          title: lesson.title,
          status: 'added',
          candidate: lesson,
        })),
        candidate: candidateModule,
      };
    }
    usedBase.add(baseIndex);
    const baseModule = baseModules[baseIndex];
    if (baseModule === undefined) throw new Error('outline_diff_module_match_missing');
    const lessons = diffLessons(baseModule.lessons, candidateModule.lessons);
    const unchanged =
      sameContent(baseModule, candidateModule) &&
      lessons.every((lesson) => lesson.status === 'unchanged');
    return {
      key: `matched-${baseModule.key}-${candidateModule.key}`,
      title: candidateModule.title,
      status: unchanged ? 'unchanged' : 'modified',
      lessons,
      base: baseModule,
      candidate: candidateModule,
    };
  });

  baseModules.forEach((baseModule, baseIndex) => {
    if (usedBase.has(baseIndex)) return;
    modules.push({
      key: `base-${baseModule.key}-${baseIndex}`,
      title: baseModule.title,
      status: 'removed',
      lessons: baseModule.lessons.map((lesson, lessonIndex) => ({
        key: `base-${lesson.key}-${lessonIndex}`,
        title: lesson.title,
        status: 'removed',
        base: lesson,
      })),
      base: baseModule,
    });
  });
  return { base, candidate, modules };
}
