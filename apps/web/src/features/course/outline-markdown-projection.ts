export type OutlineProjectionLessonInput = Readonly<{
  lessonId: string;
  title: string;
}>;

export type OutlineProjectionLesson = Readonly<{
  key: string;
  title: string;
  markdown: string;
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
  markdown: string;
  modules: readonly OutlineProjectionModule[];
  ungroupedLessons: readonly OutlineProjectionLesson[];
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
    const moduleIndex = findModuleHeadingIndex(parsed.nodes, node);
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
        return {
          key: `lesson-${child?.lineIndex ?? childIndex}-${normalizeOutlineTitle(child?.title ?? '')}`,
          title: child?.title ?? '',
          markdown: child === undefined ? '' : nodeMarkdown(parsed, child, childIndex),
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
    .map(({ node, nodeIndex }) => ({
      key: `lesson-${node.lineIndex}-${normalizeOutlineTitle(node.title)}`,
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
  const courseTitle = parsed.nodes.find(
    (node) => node.kind === 'heading' && node.level === 1,
  )?.title;
  const projection =
    lessons === undefined ? projectCandidate(parsed) : projectWithFormalLessons(parsed, lessons);
  return {
    ...(courseTitle === undefined ? {} : { title: courseTitle }),
    markdown,
    ...projection,
  };
}
