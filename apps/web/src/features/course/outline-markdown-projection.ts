export type OutlineProjectionLessonInput = Readonly<{
  lessonId: string;
  title: string;
}>;

export type OutlineProjectionLesson = Readonly<{
  key: string;
  title: string;
  markdown: string;
  summary?: string | undefined;
  lessonId?: string | undefined;
}>;

export type OutlineProjectionModule = Readonly<{
  key: string;
  title: string;
  markdown: string;
  lessons: readonly OutlineProjectionLesson[];
}>;

export type OutlineMarkdownProjection = Readonly<{
  title?: string | undefined;
  introductionText?: string | undefined;
  markdown: string;
  modules: readonly OutlineProjectionModule[];
  ungroupedLessons: readonly OutlineProjectionLesson[];
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

function firstSummarySentence(value: string): string | undefined {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized === '') return undefined;
  const sentenceEnd = normalized.search(/[。！？!?]/u);
  return sentenceEnd < 0 ? normalized : normalized.slice(0, sentenceEnd + 1);
}

export function extractOutlineLessonSummary(markdown: string): string | undefined {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  const proseParagraphs: string[] = [];
  let paragraph: string[] = [];
  let fenced = false;
  let sawLessonHeading = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) proseParagraphs.push(paragraph.join(' '));
    paragraph = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^```/u.test(trimmed)) {
      fenced = !fenced;
      flushParagraph();
      continue;
    }
    if (fenced) continue;

    if (/^#{1,6}\s+/u.test(trimmed)) {
      flushParagraph();
      if (sawLessonHeading) break;
      sawLessonHeading = true;
      continue;
    }
    if (trimmed === '') {
      flushParagraph();
      continue;
    }
    if (/^(?:>|\||[-+*]\s|\d+[.)、]\s|<{1,2}[A-Za-z!/]|-{3,}$)/u.test(trimmed)) {
      flushParagraph();
      continue;
    }

    const plain = stripInlineMarkdown(trimmed).replace(/\s+/gu, ' ').trim();
    const labelled = /^(?:一句话摘要|本节摘要|课节摘要|摘要)\s*[:：]\s*(.+)$/u.exec(plain);
    if (labelled?.[1] !== undefined) return firstSummarySentence(labelled[1]);
    if (
      /^(?:关键词|核心知识点|知识节点|前置知识|学习目标|目标|时长|预计时长)\s*[:：]/u.test(plain)
    ) {
      flushParagraph();
      continue;
    }
    if (plain !== '') paragraph.push(plain);
  }
  flushParagraph();
  return firstSummarySentence(proseParagraphs[0] ?? '');
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

function isStructuredIntroductionBlock(block: string): boolean {
  return block
    .split('\n')
    .some((line) =>
      /^(?:#{1,6}\s|>|\||[-+*]\s+|\d+[.)、]\s+|<{1,2}[A-Za-z!/]|-{3,}$)/u.test(line.trim()),
    );
}

function isEligibleIntroductionParagraph(block: string, plain: string): boolean {
  if (plain === '' || isStructuredIntroductionBlock(block)) return false;
  if (
    /^(?:每(?:一)?课(?:遵循|采用|按照)|学习(?:路径|路线|方法|节奏|周期)|教学(?:路径|路线|方法|安排)|思维路径|课程(?:组织|安排|结构说明)|哲学旁注|课程旁注|方法论旁注|预计(?:总)?(?:学习)?(?:时间|时长)|总(?:学习)?(?:时间|时长)|每周(?:安排|学习)|标准模式\b)/u.test(
      plain,
    )
  ) {
    return false;
  }
  if (/(?:预计总学习时间|预计学习时长|总学习时间约为|学习周期)/u.test(plain)) {
    return false;
  }
  if (/^(?:共|合计)?\s*\d+\s*(?:个)?(?:模块|课节|节课)(?:\b|$)/u.test(plain)) {
    return false;
  }
  const arrows = plain.match(/(?:→|⇒|->)/gu)?.length ?? 0;
  if (arrows > 0 && !/[。！？.!?]/u.test(plain)) return false;
  return true;
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
  let firstNarrative: string | undefined;
  let labelledNarrative: string | undefined;
  let awaitingLabelledParagraph = false;

  for (const block of blocks) {
    const plain = plainParagraph(block);
    const inlineLabel = /^(?:课程介绍|课程简介|课程概述|导语)\s*[:：]\s*(.+)$/u.exec(plain);
    if (inlineLabel?.[1] !== undefined) {
      const candidate = inlineLabel[1].trim();
      if (isEligibleIntroductionParagraph(candidate, candidate)) {
        labelledNarrative ??= candidate;
      }
      awaitingLabelledParagraph = false;
      continue;
    }
    if (/^(?:课程介绍|课程简介|课程概述|导语)\s*[:：]?$/u.test(plain)) {
      awaitingLabelledParagraph = true;
      continue;
    }
    if (!isEligibleIntroductionParagraph(block, plain)) continue;
    if (awaitingLabelledParagraph) {
      labelledNarrative ??= plain;
      awaitingLabelledParagraph = false;
      continue;
    }
    firstNarrative ??= plain;
  }

  return labelledNarrative ?? firstNarrative;
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
        lessonId: lesson.lessonId,
        title: lesson.title,
        markdown: '',
      });
      return;
    }
    usedNodeIndexes.add(nodeIndex);
    const node = parsed.nodes[nodeIndex];
    if (node === undefined) return;
    const projected = {
      key: lesson.lessonId,
      lessonId: lesson.lessonId,
      title: lesson.title,
      markdown: nodeMarkdown(parsed, node, nodeIndex),
    } satisfies OutlineProjectionLesson;
    const summary = extractOutlineLessonSummary(projected.markdown);
    const lessonProjection = {
      ...projected,
      ...(summary === undefined ? {} : { summary }),
    } satisfies OutlineProjectionLesson;
    const moduleIndex = findModuleHeadingIndex(parsed.nodes, node);
    if (moduleIndex === undefined) {
      ungroupedLessons.push(lessonProjection);
      return;
    }
    const current = grouped.get(moduleIndex) ?? [];
    current.push(lessonProjection);
    grouped.set(moduleIndex, current);
  });

  const modules = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map<OutlineProjectionModule | undefined>(([nodeIndex, moduleLessons]) => {
      const node = parsed.nodes[nodeIndex];
      if (node === undefined) return undefined;
      return {
        key: `module-${node.lineIndex}-${normalizeOutlineTitle(node.title)}`,
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

  parsed.nodes.forEach((node, nodeIndex) => {
    if (node.kind !== 'heading' || node.parentHeadingIndex !== courseHeadingIndex) return;
    const childIndexes = parsed.nodes
      .map((child, childIndex) => ({ child, childIndex }))
      .filter(({ child }) => child.parentHeadingIndex === nodeIndex)
      .map(({ childIndex }) => childIndex);
    if (childIndexes.length === 0) return;
    childIndexes.forEach((index) => consumed.add(index));
    consumed.add(nodeIndex);
    modules.push({
      key: `module-${node.lineIndex}-${normalizeOutlineTitle(node.title)}`,
      title: node.title,
      markdown: nodeMarkdown(parsed, node, nodeIndex),
      lessons: childIndexes.map((childIndex) => {
        const child = parsed.nodes[childIndex];
        const markdown = child === undefined ? '' : nodeMarkdown(parsed, child, childIndex);
        const summary = extractOutlineLessonSummary(markdown);
        return {
          key: `lesson-${child?.lineIndex ?? childIndex}-${normalizeOutlineTitle(child?.title ?? '')}`,
          title: child?.title ?? '',
          markdown,
          ...(summary === undefined ? {} : { summary }),
        };
      }),
    });
  });

  const ungroupedLessons = parsed.nodes
    .map((node, nodeIndex) => ({ node, nodeIndex }))
    .filter(({ node, nodeIndex }) => {
      if (consumed.has(nodeIndex) || node.level === 1) return false;
      if (node.kind === 'heading') return node.parentHeadingIndex === courseHeadingIndex;
      return node.parentHeadingIndex === undefined;
    })
    .map(({ node, nodeIndex }) => {
      const markdown = nodeMarkdown(parsed, node, nodeIndex);
      const summary = extractOutlineLessonSummary(markdown);
      return {
        key: `lesson-${node.lineIndex}-${normalizeOutlineTitle(node.title)}`,
        title: node.title,
        markdown,
        ...(summary === undefined ? {} : { summary }),
      };
    });

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
  return {
    ...(courseTitle === undefined ? {} : { title: courseTitle }),
    ...(introductionText === undefined ? {} : { introductionText }),
    markdown,
    ...projection,
  };
}

export function resolveCourseIntroduction(
  projection: OutlineMarkdownProjection,
  fallbackTitle: string,
): ResolvedCourseIntroduction {
  const title = projection.title?.trim() || fallbackTitle.trim() || '课程';
  return {
    title,
    introductionText: projection.introductionText ?? `这是一门关于“${title}”的课程。`,
  };
}
