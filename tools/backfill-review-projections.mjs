import { createHash } from 'node:crypto';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd(), '.learning-more-data');
const apply = process.argv.includes('--apply');

function canonicalValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function encodeJson(value) {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

function checksumJson(value) {
  return `sha256:${createHash('sha256').update(encodeJson(value), 'utf8').digest('hex')}`;
}

async function filesUnder(directory, fileName) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(target, fileName)));
    else if (entry.isFile() && (fileName === undefined || entry.name === fileName))
      result.push(target);
  }
  return result;
}

function parseMarkdown(markdown) {
  const title = markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? '课时 Review';
  const intro = markdown
    .replace(/^#\s+.+$/mu, '')
    .split(/^##\s+/mu)[0]
    ?.trim();
  const sections = new Map();
  for (const match of markdown.matchAll(/^##\s+(.+)\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/gmu)) {
    const heading = match[1]?.trim();
    const body = match[2]?.trim();
    if (heading && body) sections.set(heading, body);
  }
  return { title, intro: intro ?? '', sections };
}

function firstSection(sections, patterns) {
  for (const [heading, body] of sections) {
    if (patterns.some((pattern) => pattern.test(heading))) return { heading, body };
  }
  return undefined;
}

function evidenceRefs(sourceMessageIds, limit = 6) {
  return sourceMessageIds.slice(0, limit).map((id) => `message:${id}`);
}

function methodologyInsightFromCoreInsight(coreInsight) {
  const paragraphs = String(coreInsight ?? '')
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  const preferred = paragraphs.find((paragraph) =>
    /^(?:核心方法|解决方法|可以先|检查这条链时)/u.test(paragraph),
  );
  const candidate = preferred ?? paragraphs[0];
  if (!candidate) return undefined;
  const normalized = candidate.replace(/^(?:核心方法|解决方法)是[：:]?\s*/u, '').trim();
  const withoutList = normalized.split(/\s+[-*+]\s+/u)[0]?.trim() ?? normalized;
  const sentence = withoutList.match(/^.{1,240}?[。！？；]/u)?.[0] ?? withoutList;
  const result = sentence.replace(/[：:]$/u, '。').trim();
  if (result.length === 0) return undefined;
  return result.length <= 240 ? result : `${result.slice(0, 239).trimEnd()}…`;
}

function migrateMethodologyInsight(document) {
  if (document?.kind !== 'lesson-final') return document;
  const legacy = document.portableTakeaway?.trim();
  const current = document.methodologyInsight?.trim();
  const methodologyInsight =
    current || legacy || methodologyInsightFromCoreInsight(document.coreInsight);
  if (methodologyInsight === undefined || methodologyInsight === '') return document;
  const withoutLegacy = { ...document };
  delete withoutLegacy.portableTakeaway;
  return { ...withoutLegacy, methodologyInsight };
}

function projectFinal(markdown, sourceMessageIds) {
  const parsed = parseMarkdown(markdown);
  const core = firstSection(parsed.sections, [/核心/u, /本质/u, /关键判断/u]);
  const demonstrated = firstSection(parsed.sections, [/形成的判断/u, /目标的证据/u, /学习表现/u]);
  const next = firstSection(parsed.sections, [/尚未解决/u, /继续检验/u, /下一步/u]);
  const conceptHeadings = [...parsed.sections.keys()].filter(
    (heading) => !/形成的判断|目标的证据|尚未解决|课程邻接/u.test(heading),
  );
  const tree = conceptHeadings
    .slice(0, 7)
    .map((heading, index, values) => `${index === values.length - 1 ? '└─' : '├─'} ${heading}`)
    .join('\n');
  return {
    schemaVersion: 1,
    kind: 'lesson-final',
    title: parsed.title.replace(/^本课最终 Review[：:]?/u, '本课总结：'),
    knowledgeMap: {
      title: '本课知识线索',
      markdown: tree || core?.body || parsed.intro,
    },
    coreInsight: [parsed.intro, core?.body].filter(Boolean).join('\n\n'),
    performance: [
      {
        title: '你做得很好的地方',
        markdown: demonstrated?.body ?? '现有 Review 记录了本课中已经形成的可验证理解。',
        evidenceRefs: evidenceRefs(sourceMessageIds),
      },
      {
        title: '接下来的判断',
        markdown: next?.body ?? '继续在新的问题情境中检验已经形成的判断。',
      },
    ],
  };
}

function projectStage(markdown, sourceMessageIds) {
  const parsed = parseMarkdown(markdown);
  const established = firstSection(parsed.sections, [/已建立/u, /形成的判断/u, /学习表现/u]);
  const pending = firstSection(parsed.sections, [/尚未/u, /待验证/u, /继续/u]);
  return {
    schemaVersion: 1,
    kind: 'lesson-stage',
    title: parsed.title.replace(/^本课|课时/u, '阶段'),
    lead: parsed.intro || '本课在形成可用学习证据后提前结束。',
    establishedUnderstanding: [
      {
        title: established?.heading ?? '已建立的理解',
        markdown: established?.body ?? '现有阶段 Review 已记录当前形成的理解。',
        evidenceRefs: evidenceRefs(sourceMessageIds),
      },
    ],
    pendingValidation: [
      {
        title: pending?.heading ?? '尚待验证的内容',
        markdown: pending?.body ?? '恢复学习后仍需通过新的互动证据继续验证。',
      },
    ],
    knowledgeMap: {
      title: '当前知识线索',
      markdown: [...parsed.sections.keys()]
        .slice(0, 6)
        .map((item) => `├─ ${item}`)
        .join('\n'),
    },
    performance: [
      {
        title: '本次已经推进的部分',
        markdown: established?.body ?? parsed.intro,
      },
      {
        title: '恢复学习后可以继续推进的部分',
        markdown: pending?.body ?? '从尚待验证处继续，不把阶段证据冒充最终掌握。',
      },
    ],
    continuationNotice:
      '恢复学习不会新建会话；原始对话解除冻结后继续，最终 Review 将在本课闭环后覆盖阶段 Review。',
  };
}

async function writeAggregate(file, document, mutateData) {
  const updatedAt = new Date().toISOString();
  const data = mutateData(structuredClone(document.data), updatedAt);
  data.resourceVersion += 1;
  const next = {
    ...document,
    contentSha256: checksumJson(data),
    data,
    resourceVersion: data.resourceVersion,
    updatedAt,
  };
  if (!apply) return;
  const temporary = `${file}.projection-${process.pid}.tmp`;
  await writeFile(temporary, encodeJson(next), 'utf8');
  await rename(temporary, file);
}

const artifactFiles = await filesUnder(path.join(root, 'entities', 'artifacts'), 'content.md');
const artifactById = new Map(
  artifactFiles.map((file) => [path.basename(path.dirname(file)), file]),
);
const lessonProgressFiles = (
  await filesUnder(path.join(root, 'entities', 'lesson-progress'))
).filter((file) => file.endsWith('.json'));
const lessonProgress = await Promise.all(
  lessonProgressFiles.map(async (file) => ({
    file,
    value: JSON.parse(await readFile(file, 'utf8')),
  })),
);
let finalCount = 0;
let stageCount = 0;
let checksumRepairCount = 0;
let methodologyInsightCount = 0;

async function repairProjectionChecksum(file, aggregate) {
  const containsProjection =
    aggregate.data?.review?.document !== undefined ||
    aggregate.data?.finalReview?.document !== undefined ||
    aggregate.data?.document !== undefined;
  if (!containsProjection || aggregate.contentSha256 === checksumJson(aggregate.data)) return;
  checksumRepairCount += 1;
  if (!apply) return;
  const next = { ...aggregate, contentSha256: checksumJson(aggregate.data) };
  const temporary = `${file}.checksum-${process.pid}.tmp`;
  await writeFile(temporary, encodeJson(next), 'utf8');
  await rename(temporary, file);
}

for (const file of await filesUnder(path.join(root, 'entities', 'lesson-closures'))) {
  const aggregate = JSON.parse(await readFile(file, 'utf8'));
  const review = aggregate.data?.review;
  if (!review || review.document) continue;
  const artifactFile = artifactById.get(review.artifactRef);
  if (!artifactFile) continue;
  const projection = projectFinal(
    await readFile(artifactFile, 'utf8'),
    aggregate.data.sourceMessageIds ?? [],
  );
  await writeAggregate(file, aggregate, (data, updatedAt) => ({
    ...data,
    review: { ...data.review, document: projection },
    updatedAt,
  }));
  const progress = lessonProgress.find(
    (item) => item.value.data?.lessonId === aggregate.data.lessonId,
  );
  if (progress?.value.data?.finalReview && !progress.value.data.finalReview.document) {
    await writeAggregate(progress.file, progress.value, (data) => ({
      ...data,
      finalReview: { ...data.finalReview, document: projection },
    }));
  }
  finalCount += 1;
}

for (const file of await filesUnder(path.join(root, 'entities', 'reviews'))) {
  const aggregate = JSON.parse(await readFile(file, 'utf8'));
  const review = aggregate.data;
  if (review?.status !== 'committed' || review.document || !review.artifactRef) continue;
  const artifactFile = artifactById.get(review.artifactRef);
  if (!artifactFile) continue;
  const projection = projectStage(await readFile(artifactFile, 'utf8'), []);
  await writeAggregate(file, aggregate, (data, updatedAt) => ({
    ...data,
    document: projection,
    updatedAt,
  }));
  stageCount += 1;
}

for (const file of lessonProgressFiles) {
  const aggregate = JSON.parse(await readFile(file, 'utf8'));
  const document = aggregate.data?.finalReview?.document;
  const migrated = migrateMethodologyInsight(document);
  if (migrated === document) continue;
  await writeAggregate(file, aggregate, (data) => ({
    ...data,
    finalReview: { ...data.finalReview, document: migrated },
  }));
  methodologyInsightCount += 1;
}

for (const file of await filesUnder(path.join(root, 'entities', 'lesson-closures'))) {
  const aggregate = JSON.parse(await readFile(file, 'utf8'));
  const document = aggregate.data?.review?.document;
  const migrated = migrateMethodologyInsight(document);
  if (migrated === document) continue;
  await writeAggregate(file, aggregate, (data) => ({
    ...data,
    review: { ...data.review, document: migrated },
  }));
  methodologyInsightCount += 1;
}

const projectionAggregateFiles = [
  ...lessonProgressFiles,
  ...(await filesUnder(path.join(root, 'entities', 'lesson-closures'))),
  ...(await filesUnder(path.join(root, 'entities', 'reviews'))),
];
for (const file of new Set(projectionAggregateFiles)) {
  await repairProjectionChecksum(file, JSON.parse(await readFile(file, 'utf8')));
}

process.stdout.write(
  `${apply ? 'APPLIED' : 'DRY_RUN'} final=${finalCount} stage=${stageCount} methodology_insight=${methodologyInsightCount} checksum_repairs=${checksumRepairCount} immutable_markdown=preserved\n`,
);
