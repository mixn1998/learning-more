import {
  normalizeOutlineTitle,
  projectOutlineMarkdown,
  type OutlineMarkdownProjection,
  type OutlineProjectionCourseSection,
  type OutlineProjectionLesson,
  type OutlineProjectionLessonInput,
  type OutlineProjectionModule,
} from './outline-markdown-projection.js';

export type OutlineChangeStatus = 'unchanged' | 'modified' | 'added' | 'removed';
export type OutlineChangeKind = 'content' | 'renamed' | 'moved';
export type OutlineChangeAttribution = 'requested' | 'ai_sync';

type ChangeDetails = Readonly<{
  status: OutlineChangeStatus;
  changeKinds: readonly OutlineChangeKind[];
  attribution: OutlineChangeAttribution;
  previousTitle?: string | undefined;
}>;

export type OutlineLessonDiff = ChangeDetails &
  Readonly<{
    key: string;
    title: string;
    base?: OutlineProjectionLesson | undefined;
    candidate?: OutlineProjectionLesson | undefined;
  }>;

export type OutlineModuleDiff = ChangeDetails &
  Readonly<{
    key: string;
    title: string;
    lessons: readonly OutlineLessonDiff[];
    base?: OutlineProjectionModule | undefined;
    candidate?: OutlineProjectionModule | undefined;
  }>;

export type OutlineCourseSectionDiff = ChangeDetails &
  Readonly<{
    key: string;
    title: string;
    base?: OutlineProjectionCourseSection | undefined;
    candidate?: OutlineProjectionCourseSection | undefined;
  }>;

export type OutlineMarkdownDiff = Readonly<{
  base: OutlineMarkdownProjection;
  candidate: OutlineMarkdownProjection;
  modules: readonly OutlineModuleDiff[];
  courseSections: readonly OutlineCourseSectionDiff[];
}>;

export type OutlineDiffOptions = Readonly<{
  action?: 'regenerate' | 'patch' | undefined;
  targetNodeRefs?: readonly string[] | undefined;
}>;

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function markdownBody(value: string): string {
  return normalizeMarkdown(value)
    .replace(/^#{1,6}\s+.+?(?:\n|$)/u, '')
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

function grams(value: string): ReadonlySet<string> {
  const normalized = normalizeOutlineTitle(value);
  if (normalized.length < 2) return new Set(normalized === '' ? [] : [normalized]);
  return new Set(
    Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2)),
  );
}

function similarity(left: string, right: string): number {
  const a = grams(left);
  const b = grams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function closestContentMatch<T extends Readonly<{ title: string; markdown: string }>>(
  items: readonly T[],
  candidate: T,
  used: ReadonlySet<number>,
): number | undefined {
  const exact = items.findIndex(
    (item, index) =>
      !used.has(index) &&
      normalizeOutlineTitle(item.title) === normalizeOutlineTitle(candidate.title),
  );
  if (exact >= 0) return exact;
  const ranked = items
    .map((item, index) => ({
      index,
      score: used.has(index)
        ? 0
        : Math.max(
            similarity(item.title, candidate.title),
            similarity(markdownBody(item.markdown), markdownBody(candidate.markdown)),
          ),
    }))
    .filter(({ score }) => score >= 0.55)
    .sort((left, right) => right.score - left.score);
  if (ranked[0] === undefined || ranked[0].score === ranked[1]?.score) return undefined;
  return ranked[0].index;
}

function matchModule(
  baseModules: readonly OutlineProjectionModule[],
  candidate: OutlineProjectionModule,
  usedBase: ReadonlySet<number>,
): number | undefined {
  const exact = baseModules.findIndex(
    (module, index) =>
      !usedBase.has(index) &&
      normalizeOutlineTitle(module.title) === normalizeOutlineTitle(candidate.title),
  );
  if (exact >= 0) return exact;
  const candidateLessons = new Set(
    candidate.lessons.map((lesson) => normalizeOutlineTitle(lesson.title)),
  );
  const ranked = baseModules
    .map((module, index) => {
      const overlap = module.lessons.filter((lesson) =>
        candidateLessons.has(normalizeOutlineTitle(lesson.title)),
      ).length;
      const overlapRatio = overlap / Math.max(1, module.lessons.length, candidate.lessons.length);
      const titleScore = similarity(module.title, candidate.title);
      const bodyScore = similarity(markdownBody(module.markdown), markdownBody(candidate.markdown));
      return {
        index,
        score: usedBase.has(index)
          ? 0
          : overlap > 0
            ? Math.max(overlapRatio, titleScore, bodyScore)
            : titleScore >= 0.55 || bodyScore >= 0.8
              ? Math.max(titleScore, bodyScore)
              : 0,
      };
    })
    .filter(({ score }) => score >= 0.55)
    .sort((left, right) => right.score - left.score);
  if (ranked[0] === undefined || ranked[0].score === ranked[1]?.score) return undefined;
  return ranked[0].index;
}

function attributionFor(
  anchor: string,
  parentAnchor: string | undefined,
  options: OutlineDiffOptions,
  previousAnchors: readonly string[] = [],
): OutlineChangeAttribution {
  if (options.action !== 'patch') return 'requested';
  const targets = options.targetNodeRefs ?? [];
  if (targets.includes('outline:root')) return 'requested';
  return targets.includes(anchor) ||
    (parentAnchor !== undefined && targets.includes(parentAnchor)) ||
    previousAnchors.some((previousAnchor) => targets.includes(previousAnchor))
    ? 'requested'
    : 'ai_sync';
}

function details(
  base: Readonly<{ title: string; markdown: string }> | undefined,
  candidate: Readonly<{ title: string; markdown: string }> | undefined,
  moved: boolean,
  attribution: OutlineChangeAttribution,
): ChangeDetails {
  if (base === undefined) return { status: 'added', changeKinds: [], attribution };
  if (candidate === undefined) return { status: 'removed', changeKinds: [], attribution };
  const kinds: OutlineChangeKind[] = [];
  if (normalizeOutlineTitle(base.title) !== normalizeOutlineTitle(candidate.title))
    kinds.push('renamed');
  if (moved) kinds.push('moved');
  if (markdownBody(base.markdown) !== markdownBody(candidate.markdown)) kinds.push('content');
  return {
    status: kinds.length === 0 && sameContent(base, candidate) ? 'unchanged' : 'modified',
    changeKinds: kinds,
    attribution,
    ...(kinds.includes('renamed') ? { previousTitle: base.title } : {}),
  };
}

type LessonLocation = Readonly<{
  moduleIndex: number;
  lessonIndex: number;
  lesson: OutlineProjectionLesson;
}>;

function flattenLessons(modules: readonly OutlineProjectionModule[]): readonly LessonLocation[] {
  return modules.flatMap((module, moduleIndex) =>
    module.lessons.map((lesson, lessonIndex) => ({ moduleIndex, lessonIndex, lesson })),
  );
}

function asUngroupedModule(
  projection: OutlineMarkdownProjection,
): readonly OutlineProjectionModule[] {
  if (projection.ungroupedLessons.length === 0) return projection.modules;
  return [
    ...projection.modules,
    {
      key: 'ungrouped-lessons',
      anchor: 'module:ungrouped',
      title: '未分组课程',
      markdown: '',
      lessons: projection.ungroupedLessons,
    },
  ];
}

function diffCourseSections(
  baseSections: readonly OutlineProjectionCourseSection[],
  candidateSections: readonly OutlineProjectionCourseSection[],
  options: OutlineDiffOptions,
): readonly OutlineCourseSectionDiff[] {
  const used = new Set<number>();
  const result = candidateSections.map<OutlineCourseSectionDiff>((candidate, candidateIndex) => {
    const baseIndex = closestContentMatch(baseSections, candidate, used);
    if (baseIndex === undefined) {
      return {
        key: `candidate-${candidate.key}-${candidateIndex}`,
        title: candidate.title,
        ...details(
          undefined,
          candidate,
          false,
          attributionFor(candidate.anchor, undefined, options),
        ),
        candidate,
      };
    }
    used.add(baseIndex);
    const base = baseSections[baseIndex]!;
    return {
      key: `matched-${base.key}-${candidate.key}`,
      title: candidate.title,
      ...details(
        base,
        candidate,
        baseIndex !== candidateIndex,
        attributionFor(candidate.anchor, undefined, options, [base.anchor]),
      ),
      base,
      candidate,
    };
  });
  baseSections.forEach((base, baseIndex) => {
    if (used.has(baseIndex)) return;
    result.push({
      key: `base-${base.key}-${baseIndex}`,
      title: base.title,
      ...details(base, undefined, false, attributionFor(base.anchor, undefined, options)),
      base,
    });
  });
  return result;
}

export function diffOutlineMarkdown(
  baseMarkdown: string,
  candidateMarkdown: string,
  baseLessons?: readonly OutlineProjectionLessonInput[],
  options: OutlineDiffOptions = {},
): OutlineMarkdownDiff {
  const base = projectOutlineMarkdown(baseMarkdown, baseLessons);
  const candidate = projectOutlineMarkdown(candidateMarkdown);
  const baseModules = asUngroupedModule(base);
  const candidateModules = asUngroupedModule(candidate);
  const usedBaseModules = new Set<number>();
  const candidateModuleMatches = new Map<number, number>();
  candidateModules.forEach((candidateModule, candidateIndex) => {
    const baseIndex = matchModule(baseModules, candidateModule, usedBaseModules);
    if (baseIndex === undefined) return;
    usedBaseModules.add(baseIndex);
    candidateModuleMatches.set(candidateIndex, baseIndex);
  });

  const baseLessonsFlat = flattenLessons(baseModules);
  const candidateLessonsFlat = flattenLessons(candidateModules);
  const usedBaseLessons = new Set<number>();
  const candidateLessonMatches = new Map<string, LessonLocation>();
  candidateLessonsFlat.forEach((candidateLocation) => {
    const baseIndex = closestContentMatch(
      baseLessonsFlat.map((location) => location.lesson),
      candidateLocation.lesson,
      usedBaseLessons,
    );
    if (baseIndex === undefined) return;
    usedBaseLessons.add(baseIndex);
    candidateLessonMatches.set(
      `${candidateLocation.moduleIndex}:${candidateLocation.lessonIndex}`,
      baseLessonsFlat[baseIndex]!,
    );
  });

  const modules: OutlineModuleDiff[] = candidateModules.map((candidateModule, candidateIndex) => {
    const baseIndex = candidateModuleMatches.get(candidateIndex);
    const baseModule = baseIndex === undefined ? undefined : baseModules[baseIndex];
    const lessons = candidateModule.lessons.map<OutlineLessonDiff>(
      (candidateLesson, lessonIndex) => {
        const baseLocation = candidateLessonMatches.get(`${candidateIndex}:${lessonIndex}`);
        const moved =
          baseLocation !== undefined &&
          (baseLocation.moduleIndex !== baseIndex || baseLocation.lessonIndex !== lessonIndex);
        return {
          key:
            baseLocation === undefined
              ? `candidate-${candidateLesson.key}-${lessonIndex}`
              : `matched-${baseLocation.lesson.key}-${candidateLesson.key}`,
          title: candidateLesson.title,
          ...details(
            baseLocation?.lesson,
            candidateLesson,
            moved,
            attributionFor(candidateLesson.anchor, candidateModule.anchor, options, [
              ...(baseLocation === undefined ? [] : [baseLocation.lesson.anchor]),
              ...(baseLocation === undefined
                ? []
                : [baseModules[baseLocation.moduleIndex]?.anchor ?? '']),
            ]),
          ),
          ...(baseLocation === undefined ? {} : { base: baseLocation.lesson }),
          candidate: candidateLesson,
        };
      },
    );
    if (baseIndex !== undefined) {
      baseModules[baseIndex]?.lessons.forEach((baseLesson, lessonIndex) => {
        const flatIndex = baseLessonsFlat.findIndex(
          (location) => location.moduleIndex === baseIndex && location.lessonIndex === lessonIndex,
        );
        if (flatIndex >= 0 && usedBaseLessons.has(flatIndex)) return;
        lessons.push({
          key: `base-${baseLesson.key}-${lessonIndex}`,
          title: baseLesson.title,
          ...details(
            baseLesson,
            undefined,
            false,
            attributionFor(baseLesson.anchor, baseModule?.anchor, options),
          ),
          base: baseLesson,
        });
      });
    }
    const moduleDetails = details(
      baseModule,
      candidateModule,
      baseIndex !== undefined && baseIndex !== candidateIndex,
      attributionFor(
        candidateModule.anchor,
        undefined,
        options,
        baseModule === undefined ? [] : [baseModule.anchor],
      ),
    );
    return {
      key:
        baseModule === undefined
          ? `candidate-${candidateModule.key}-${candidateIndex}`
          : `matched-${baseModule.key}-${candidateModule.key}`,
      title: candidateModule.title,
      ...moduleDetails,
      status:
        moduleDetails.status === 'unchanged' &&
        lessons.some((lesson) => lesson.status !== 'unchanged')
          ? 'modified'
          : moduleDetails.status,
      changeKinds:
        moduleDetails.changeKinds.length === 0 &&
        lessons.some((lesson) => lesson.status !== 'unchanged')
          ? ['content']
          : moduleDetails.changeKinds,
      lessons,
      ...(baseModule === undefined ? {} : { base: baseModule }),
      candidate: candidateModule,
    };
  });

  baseModules.forEach((baseModule, baseIndex) => {
    if (usedBaseModules.has(baseIndex)) return;
    const lessons = baseModule.lessons
      .map((baseLesson, lessonIndex) => ({ baseLesson, lessonIndex }))
      .filter(({ lessonIndex }) => {
        const flatIndex = baseLessonsFlat.findIndex(
          (location) => location.moduleIndex === baseIndex && location.lessonIndex === lessonIndex,
        );
        return flatIndex < 0 || !usedBaseLessons.has(flatIndex);
      })
      .map<OutlineLessonDiff>(({ baseLesson, lessonIndex }) => ({
        key: `base-${baseLesson.key}-${lessonIndex}`,
        title: baseLesson.title,
        ...details(
          baseLesson,
          undefined,
          false,
          attributionFor(baseLesson.anchor, baseModule.anchor, options),
        ),
        base: baseLesson,
      }));
    modules.push({
      key: `base-${baseModule.key}-${baseIndex}`,
      title: baseModule.title,
      ...details(
        baseModule,
        undefined,
        false,
        attributionFor(baseModule.anchor, undefined, options),
      ),
      lessons,
      base: baseModule,
    });
  });

  return {
    base,
    candidate,
    modules,
    courseSections: diffCourseSections(base.courseSections, candidate.courseSections, options),
  };
}
