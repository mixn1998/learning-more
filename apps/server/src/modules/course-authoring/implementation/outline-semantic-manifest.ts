export type OutlineSemanticNode = Readonly<{
  ref: string;
  kind: 'course' | 'module' | 'lesson' | 'course-section';
  title: string;
  excerpt: string;
  parentRef?: string | undefined;
}>;

function plainTitle(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_~]/gu, '')
    .replace(/\s+#+\s*$/u, '')
    .trim();
}

function normalizeTitle(value: string): string {
  return plainTitle(value)
    .replace(
      /^(?:(?:第\s*[0-9一二三四五六七八九十百]+\s*[课节讲])|(?:课(?:程|节)?\s*[0-9一二三四五六七八九十百]+)|(?:\d+(?:\.\d+)*))[\s:：、.．)）\-—·]*/u,
      '',
    )
    .replace(/[\s:：、，,。.!！?？()（）[\]【】《》“”'"\-—·]/gu, '')
    .toLocaleLowerCase();
}

function moduleRef(title: string): string {
  return `module:${normalizeTitle(title)}`;
}

function lessonRef(moduleTitle: string, title: string): string {
  return `lesson:${normalizeTitle(moduleTitle)}/${normalizeTitle(title)}`;
}

function sectionRef(title: string): string {
  return `section:${normalizeTitle(title)}`;
}

function isCourseLevelSectionTitle(title: string): boolean {
  const normalized = normalizeTitle(title);
  return (
    /(?:课程|学习)(?:完成|结业|掌握|能力|学习)?(?:标准|目标|成果|要求|说明|介绍|摘要|评估)|适用对象|先修要求|参考资料|学习建议/u.test(
      normalized,
    ) ||
    /course(?:completion|learning)?(?:criteria|standards|goals|summary|overview)|learningoutcomes|assessmentcriteria|prerequisites|references/u.test(
      normalized,
    )
  );
}

export function buildOutlineSemanticManifest(markdown: string): readonly OutlineSemanticNode[] {
  const lines = markdown.replace(/\r\n?/gu, '\n').split('\n');
  let fenced = false;
  const headings = lines.flatMap((line, lineIndex) => {
    if (/^\s*```/u.test(line)) {
      fenced = !fenced;
      return [];
    }
    if (fenced) return [];
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    return match === null
      ? []
      : [{ lineIndex, level: match[1]!.length, title: plainTitle(match[2] ?? '') }];
  });
  const course = headings.find((heading) => heading.level === 1);
  const result: OutlineSemanticNode[] = [
    {
      ref: 'outline:root',
      kind: 'course',
      title: course?.title ?? '课程大纲',
      excerpt: markdown.slice(0, 1_200),
    },
  ];
  if (course === undefined) return result;

  const directSections = headings.filter(
    (heading) => heading.level === 2 && heading.lineIndex > course.lineIndex,
  );
  directSections.forEach((section, sectionIndex) => {
    const end = directSections[sectionIndex + 1]?.lineIndex ?? lines.length;
    const children = headings.filter(
      (heading) =>
        heading.lineIndex > section.lineIndex && heading.lineIndex < end && heading.level === 3,
    );
    const listItems = lines.slice(section.lineIndex + 1, end).flatMap((line) => {
      const match = /^\s*(?:[-+*]|\d+[.)、])\s+(.+?)\s*$/u.exec(line);
      return match === null ? [] : [plainTitle(match[1] ?? '')];
    });
    const courseLevelSection = isCourseLevelSectionTitle(section.title);
    const shortListRatio =
      listItems.length === 0
        ? 0
        : listItems.filter(
            (title) => Array.from(title).length <= 24 && !/[。！？!?；;]$/u.test(title),
          ).length / listItems.length;
    const isModule = children.length > 0 || (!courseLevelSection && shortListRatio >= 0.75);
    const kind = isModule ? 'module' : courseLevelSection ? 'course-section' : 'lesson';
    const parentRef =
      kind === 'module'
        ? moduleRef(section.title)
        : kind === 'course-section'
          ? sectionRef(section.title)
          : lessonRef('ungrouped', section.title);
    result.push({
      ref: parentRef,
      kind,
      title: section.title,
      excerpt: lines.slice(section.lineIndex, end).join('\n').slice(0, 2_400),
      parentRef: 'outline:root',
    });
    if (!isModule) return;
    const lessonTitles = children.length > 0 ? children.map((child) => child.title) : listItems;
    lessonTitles.forEach((title) => {
      result.push({
        ref: lessonRef(section.title, title),
        kind: 'lesson',
        title,
        excerpt: title,
        parentRef,
      });
    });
  });
  return result;
}
