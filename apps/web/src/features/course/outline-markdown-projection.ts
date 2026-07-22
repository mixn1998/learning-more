export type OutlineProjectionLessonInput = Readonly<{
  lessonId: string;
  title: string;
}>;

export type OutlineProjectionLesson = Readonly<{
  key: string;
  anchor: string;
  title: string;
  markdown: string;
  lessonId?: string | undefined;
}>;

export type OutlineProjectionModule = Readonly<{
  key: string;
  anchor: string;
  title: string;
  markdown: string;
  lessons: readonly OutlineProjectionLesson[];
}>;

export type OutlineProjectionCourseSection = Readonly<{
  key: string;
  anchor: string;
  title: string;
  markdown: string;
}>;

export type OutlineMarkdownProjection = Readonly<{
  title?: string | undefined;
  introductionText?: string | undefined;
  markdown: string;
  modules: readonly OutlineProjectionModule[];
  ungroupedLessons: readonly OutlineProjectionLesson[];
  courseSections: readonly OutlineProjectionCourseSection[];
}>;

export type ResolvedCourseIntroduction = Readonly<{
  title: string;
  introductionText: string;
}>;

type MarkdownNode = Readonly<{
  kind: 'heading' | 'list';
  level: number;
  lineIndex: number;
  title: string;
  parentHeadingIndex?: number | undefined;
}>;

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_~]/gu, '')
    .replace(/\s+#+\s*$/u, '')
    .trim();
}

export function normalizeOutlineTitle(value: string): string {
  return stripInlineMarkdown(value)
    .replace(
      /^(?:(?:第\s*[0-9一二三四五六七八九十百]+\s*[课节讲])|(?:课(?:程|节)?\s*[0-9一二三四五六七八九十百]+)|(?:\d+(?:\.\d+)*))[\s:：、.．)）\-—·]*/u,
      '',
    )
    .replace(/[\s:：、，,。.!！?？()（）[\]【】《》“”'"\-—·]/gu, '')
    .toLocaleLowerCase();
}

export function outlineModuleAnchor(title: string): string {
  return `module:${normalizeOutlineTitle(title)}`;
}

export function outlineLessonAnchor(moduleTitle: string | undefined, title: string): string {
  const parent = moduleTitle === undefined ? 'ungrouped' : normalizeOutlineTitle(moduleTitle);
  return `lesson:${parent}/${normalizeOutlineTitle(title)}`;
}

export function outlineCourseSectionAnchor(title: string): string {
  return `section:${normalizeOutlineTitle(title)}`;
}

function isCourseLevelSectionTitle(title: string): boolean {
  const normalized = normalizeOutlineTitle(title);
  return (
    /(?:课程|学习)(?:完成|结业|掌握|能力|学习)?(?:标准|目标|成果|要求|说明|介绍|摘要|评估)|适用对象|先修要求|参考资料|学习建议/u.test(
      normalized,
    ) ||
    /course(?:completion|learning)?(?:criteria|standards|goals|summary|overview)|learningoutcomes|assessmentcriteria|prerequisites|references/u.test(
      normalized,
    )
  );
}

function parseMarkdown(markdown: string): Readonly<{
  lines: readonly string[];
  nodes: readonly MarkdownNode[];
  headingEndByIndex: ReadonlyMap<number, number>;
}> {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const nodes: MarkdownNode[] = [];
  const headingStack: Array<{ level: number; nodeIndex: number }> = [];
  let fenced = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    if (/^\s*```/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      while ((headingStack.at(-1)?.level ?? 0) >= level) headingStack.pop();
      const parentHeadingIndex = headingStack.at(-1)?.nodeIndex;
      nodes.push({
        kind: 'heading',
        level,
        lineIndex,
        title: stripInlineMarkdown(heading[2] ?? ''),
        ...(parentHeadingIndex === undefined ? {} : { parentHeadingIndex }),
      });
      headingStack.push({ level, nodeIndex: nodes.length - 1 });
      continue;
    }

    const list = /^\s*(?:[-+*]|\d+[.)、])\s+(.+?)\s*$/u.exec(line);
    if (list === null) continue;
    const parent = headingStack.at(-1);
    nodes.push({
      kind: 'list',
      level: (parent?.level ?? 0) + 1,
      lineIndex,
      title: stripInlineMarkdown(list[1] ?? ''),
      ...(parent === undefined ? {} : { parentHeadingIndex: parent.nodeIndex }),
    });
  }

  const headingEndByIndex = new Map<number, number>();
  nodes.forEach((node, nodeIndex) => {
    if (node.kind !== 'heading') return;
    let end = lines.length;
    for (let nextIndex = nodeIndex + 1; nextIndex < nodes.length; nextIndex += 1) {
      const next = nodes[nextIndex];
      if (next?.kind === 'heading' && next.level <= node.level) {
        end = next.lineIndex;
        break;
      }
    }
    headingEndByIndex.set(nodeIndex, end);
  });
  return { lines, nodes, headingEndByIndex };
}

function nodeMarkdown(
  parsed: ReturnType<typeof parseMarkdown>,
  node: MarkdownNode,
  nodeIndex: number,
): string {
  if (node.kind === 'list') return parsed.lines[node.lineIndex]?.trim() ?? node.title;
  return parsed.lines
    .slice(node.lineIndex, parsed.headingEndByIndex.get(nodeIndex) ?? node.lineIndex + 1)
    .join('\n')
    .trim();
}

function paragraphBlocks(lines: readonly string[]): readonly string[] {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let fenced = false;

  const flush = () => {
    if (paragraph.length > 0) blocks.push(paragraph.join('\n'));
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^```/u.test(line)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line === '') {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function plainParagraph(block: string): string {
  return block
    .split('\n')
    .map((line) => stripInlineMarkdown(line))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function courseIntroductionText(
  parsed: ReturnType<typeof parseMarkdown>,
  courseHeadingIndex: number,
): string | undefined {
  const courseHeading = parsed.nodes[courseHeadingIndex];
  if (courseHeading?.kind !== 'heading' || courseHeading.level !== 1) return undefined;

  const nextSection = parsed.nodes
    .slice(courseHeadingIndex + 1)
    .find((node) => node.kind === 'heading' && node.level <= 2);
  const blocks = paragraphBlocks(
    parsed.lines.slice(courseHeading.lineIndex + 1, nextSection?.lineIndex ?? parsed.lines.length),
  );
  for (const block of blocks) {
    const plain = plainParagraph(block);
    const summary = /^课程摘要\s*[:：]\s*(.+)$/u.exec(plain)?.[1]?.trim();
    if (summary === undefined) continue;
    const characterCount = Array.from(summary).length;
    if (characterCount >= 50 && characterCount <= 100) return summary;
  }

  return undefined;
}

function findModuleHeadingIndex(
  nodes: readonly MarkdownNode[],
  lessonNode: MarkdownNode,
): number | undefined {
  const parentIndex = lessonNode.parentHeadingIndex;
  if (parentIndex === undefined) return undefined;
  const parent = nodes[parentIndex];
  if (parent === undefined || parent.level === 1) return undefined;
  return parentIndex;
}

function likelySameTitle(nodeTitle: string, lessonTitle: string): boolean {
  const node = normalizeOutlineTitle(nodeTitle);
  const lesson = normalizeOutlineTitle(lessonTitle);
  return node !== '' && node === lesson;
}

function projectWithFormalLessons(
  parsed: ReturnType<typeof parseMarkdown>,
  lessons: readonly OutlineProjectionLessonInput[],
): Pick<OutlineMarkdownProjection, 'modules' | 'ungroupedLessons'> {
  const usedNodeIndexes = new Set<number>();
  const grouped = new Map<number, OutlineProjectionLesson[]>();
  const ungroupedLessons: OutlineProjectionLesson[] = [];

  lessons.forEach((lesson) => {
    const nodeIndex = parsed.nodes.findIndex(
      (node, index) => !usedNodeIndexes.has(index) && likelySameTitle(node.title, lesson.title),
    );
    if (nodeIndex < 0) {
      ungroupedLessons.push({
        key: lesson.lessonId,
        anchor: outlineLessonAnchor(undefined, lesson.title),
        lessonId: lesson.lessonId,
        title: lesson.title,
        markdown: '',
      });
      return;
    }
    usedNodeIndexes.add(nodeIndex);
    const node = parsed.nodes[nodeIndex];
    if (node === undefined) return;
    const moduleIndex = findModuleHeadingIndex(parsed.nodes, node);
    const projected = {
      key: lesson.lessonId,
      anchor: outlineLessonAnchor(
        moduleIndex === undefined ? undefined : parsed.nodes[moduleIndex]?.title,
        lesson.title,
      ),
      lessonId: lesson.lessonId,
      title: lesson.title,
      markdown: nodeMarkdown(parsed, node, nodeIndex),
    } satisfies OutlineProjectionLesson;
    if (moduleIndex === undefined) {
      ungroupedLessons.push(projected);
      return;
    }
    const current = grouped.get(moduleIndex) ?? [];
    current.push(projected);
    grouped.set(moduleIndex, current);
  });

  const modules = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map<OutlineProjectionModule | undefined>(([nodeIndex, moduleLessons]) => {
      const node = parsed.nodes[nodeIndex];
      if (node === undefined) return undefined;
      return {
        key: `module-${node.lineIndex}-${normalizeOutlineTitle(node.title)}`,
        anchor: outlineModuleAnchor(node.title),
        title: node.title,
        markdown: nodeMarkdown(parsed, node, nodeIndex),
        lessons: moduleLessons,
      };
    })
    .filter((module): module is OutlineProjectionModule => module !== undefined);

  return { modules, ungroupedLessons };
}

function projectCandidate(
  parsed: ReturnType<typeof parseMarkdown>,
): Pick<OutlineMarkdownProjection, 'modules' | 'ungroupedLessons'> {
  const courseHeadingIndex = parsed.nodes.findIndex(
    (node) => node.kind === 'heading' && node.level === 1,
  );
  const modules: OutlineProjectionModule[] = [];
  const consumed = new Set<number>();
  const courseSectionHeadingIndexes = new Set<number>();

  parsed.nodes.forEach((node, nodeIndex) => {
    if (node.kind !== 'heading' || node.parentHeadingIndex !== courseHeadingIndex) return;
    const courseLevelSection = isCourseLevelSectionTitle(node.title);
    const childIndexes = parsed.nodes
      .map((child, childIndex) => ({ child, childIndex }))
      .filter(({ child }) => child.parentHeadingIndex === nodeIndex)
      .map(({ childIndex }) => childIndex);
    if (childIndexes.length === 0) {
      if (courseLevelSection) courseSectionHeadingIndexes.add(nodeIndex);
      return;
    }
    const headingChildIndexes = childIndexes.filter(
      (childIndex) => parsed.nodes[childIndex]?.kind === 'heading',
    );
    const listChildIndexes = childIndexes.filter(
      (childIndex) => parsed.nodes[childIndex]?.kind === 'list',
    );
    const shortListRatio =
      listChildIndexes.length === 0
        ? 0
        : listChildIndexes.filter((childIndex) => {
            const title = parsed.nodes[childIndex]?.title ?? '';
            return Array.from(title).length <= 24 && !/[。！？!?；;]$/u.test(title);
          }).length / listChildIndexes.length;
    const lessonChildIndexes =
      headingChildIndexes.length > 0
        ? headingChildIndexes
        : !courseLevelSection && shortListRatio >= 0.75
          ? listChildIndexes
          : [];
    if (lessonChildIndexes.length === 0) {
      if (courseLevelSection) courseSectionHeadingIndexes.add(nodeIndex);
      return;
    }
    lessonChildIndexes.forEach((index) => consumed.add(index));
    consumed.add(nodeIndex);
    modules.push({
      key: `module-${node.lineIndex}-${normalizeOutlineTitle(node.title)}`,
      anchor: outlineModuleAnchor(node.title),
      title: node.title,
      markdown: nodeMarkdown(parsed, node, nodeIndex),
      lessons: lessonChildIndexes.map((childIndex) => {
        const child = parsed.nodes[childIndex];
        return {
          key: `lesson-${child?.lineIndex ?? childIndex}-${normalizeOutlineTitle(child?.title ?? '')}`,
          anchor: outlineLessonAnchor(node.title, child?.title ?? ''),
          title: child?.title ?? '',
          markdown: child === undefined ? '' : nodeMarkdown(parsed, child, childIndex),
        };
      }),
    });
  });

  const ungroupedLessons = parsed.nodes
    .map((node, nodeIndex) => ({ node, nodeIndex }))
    .filter(({ node, nodeIndex }) => {
      if (consumed.has(nodeIndex) || courseSectionHeadingIndexes.has(nodeIndex) || node.level === 1)
        return false;
      if (node.kind === 'heading') return node.parentHeadingIndex === courseHeadingIndex;
      return node.parentHeadingIndex === undefined;
    })
    .map(({ node, nodeIndex }) => ({
      key: `lesson-${node.lineIndex}-${normalizeOutlineTitle(node.title)}`,
      anchor: outlineLessonAnchor(undefined, node.title),
      title: node.title,
      markdown: nodeMarkdown(parsed, node, nodeIndex),
    }));

  return { modules, ungroupedLessons };
}

export function projectOutlineMarkdown(
  markdown: string,
  lessons?: readonly OutlineProjectionLessonInput[],
): OutlineMarkdownProjection {
  const parsed = parseMarkdown(markdown);
  const courseHeadingIndex = parsed.nodes.findIndex(
    (node) => node.kind === 'heading' && node.level === 1,
  );
  const courseTitle = parsed.nodes[courseHeadingIndex]?.title;
  const introductionText =
    courseHeadingIndex < 0 ? undefined : courseIntroductionText(parsed, courseHeadingIndex);
  const projection =
    lessons === undefined ? projectCandidate(parsed) : projectWithFormalLessons(parsed, lessons);
  const moduleTitles = new Set(
    projection.modules.map((module) => normalizeOutlineTitle(module.title)),
  );
  const ungroupedLessonTitles = new Set(
    projection.ungroupedLessons.map((lesson) => normalizeOutlineTitle(lesson.title)),
  );
  const courseSections = parsed.nodes
    .map((node, nodeIndex) => ({ node, nodeIndex }))
    .filter(({ node }) => {
      if (node.kind !== 'heading' || node.parentHeadingIndex !== courseHeadingIndex) return false;
      const normalized = normalizeOutlineTitle(node.title);
      return !moduleTitles.has(normalized) && !ungroupedLessonTitles.has(normalized);
    })
    .map(({ node, nodeIndex }) => ({
      key: `section-${node.lineIndex}-${normalizeOutlineTitle(node.title)}`,
      anchor: outlineCourseSectionAnchor(node.title),
      title: node.title,
      markdown: nodeMarkdown(parsed, node, nodeIndex),
    }));
  return {
    ...(courseTitle === undefined ? {} : { title: courseTitle }),
    ...(introductionText === undefined ? {} : { introductionText }),
    markdown,
    ...projection,
    courseSections,
  };
}

export function resolveCourseIntroduction(
  projection: OutlineMarkdownProjection,
  fallbackTitle: string,
): ResolvedCourseIntroduction {
  const title = fallbackTitle.trim() || projection.title?.trim() || '课程';
  return {
    title,
    introductionText: projection.introductionText ?? `这是一门关于“${title}”的课程。`,
  };
}
