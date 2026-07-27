import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  renderComprehensiveApplicationSegment,
  selectClassroomSummaryAssistant,
  selectComprehensiveApplicationAssistantReplies,
} from './review-semantic-source-selection.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { jsonrepair } = requireFromServer('jsonrepair');

const projectRoot = process.cwd();
const dataRoot = path.resolve(projectRoot, '.learning-more-data');
const runtimeRoot = path.resolve(projectRoot, '.learning-more-runtime');
const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
const refresh = process.argv.includes('--refresh');
const allowProviderEgress = process.argv.includes('--allow-provider-egress');
const batchSizeArgument = process.argv.find((argument) => argument.startsWith('--batch-size='));
const batchSize = Math.max(1, Number(batchSizeArgument?.split('=')[1] ?? 4));
const exportInputsArgument = process.argv.find((argument) =>
  argument.startsWith('--export-inputs='),
);
const exportInputsFile =
  exportInputsArgument === undefined
    ? undefined
    : path.resolve(projectRoot, exportInputsArgument.slice('--export-inputs='.length));
const cacheFileArgument = process.argv.find((argument) => argument.startsWith('--cache-file='));
const cacheFile =
  cacheFileArgument === undefined
    ? path.join(runtimeRoot, 'review-semantic-distillation-v1.json')
    : path.resolve(projectRoot, cacheFileArgument.slice('--cache-file='.length));
const lessonIdArgument = process.argv.find((argument) => argument.startsWith('--lesson-id='));
const lessonId =
  lessonIdArgument === undefined ? undefined : lessonIdArgument.slice('--lesson-id='.length).trim();

if (apply && verify) throw new Error('review_semantic_mode_conflict');
if (lessonId === '') throw new Error('review_semantic_lesson_id_empty');

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

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
  return `sha256:${sha256(encodeJson(value))}`;
}

async function filesUnder(directory, fileName) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(target, fileName)));
    else if (entry.isFile() && (fileName === undefined || entry.name === fileName)) {
      result.push(target);
    }
  }
  return result;
}

function extractReply(raw) {
  const match = String(raw ?? '').match(
    /<learning-more-reply>([\s\S]*?)(?:<\/learning-more-reply>|$)/u,
  );
  return (match?.[1] ?? String(raw ?? '')).trim();
}

function renderBlock(block) {
  return `## ${block.title}\n\n${block.markdown.trim()}`;
}

function renderReview(document) {
  const methodologyHeading = '\u672c\u8bfe\u65b9\u6cd5\u8bba\u542f\u793a';
  const coreHeading = '\u6838\u5fc3\u601d\u60f3';
  const performanceHeading = '\u5b66\u4e60\u8868\u73b0\u8bc4\u4ef7';
  return [
    `# ${document.title}`,
    renderBlock(document.knowledgeMap),
    ...(document.methodologyInsight === undefined
      ? []
      : [`## ${methodologyHeading}\n\n${document.methodologyInsight.trim()}`]),
    `## ${coreHeading}\n\n${document.coreInsight.trim()}`,
    `## ${performanceHeading}`,
    ...document.performance.map(renderBlock),
    ...(document.additionalSections ?? []).map(renderBlock),
  ].join('\n\n');
}

function normalizedMethodology(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized === '' ? undefined : normalized;
}

function validateSemanticResult(result, expectedIds) {
  if (result === null || typeof result !== 'object' || !Array.isArray(result.items)) {
    throw new Error('review_semantic_output_invalid');
  }
  const found = new Map();
  for (const item of result.items) {
    if (
      item === null ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      typeof item.coreInsight !== 'string' ||
      item.coreInsight.trim() === ''
    ) {
      throw new Error('review_semantic_item_invalid');
    }
    const methodologyInsight = normalizedMethodology(item.methodologyInsight);
    if (methodologyInsight !== undefined && methodologyInsight.length > 240) {
      throw new Error(`review_semantic_methodology_too_long:${item.id}`);
    }
    const coreInsight = item.coreInsight.trim();
    if (
      /(?:本课(?:学习|流程)?(?:已经|已)?完成|你已经掌握|你的评价很准确|今后的.*课|接下来.*学习)/u.test(
        coreInsight,
      )
    ) {
      throw new Error(`review_semantic_core_contains_meta:${item.id}`);
    }
    if (
      methodologyInsight !== undefined &&
      /^(?:把本课.*合起来看|本课真正值得保留的是|你(?:已经|在本课|的评价))/u.test(
        methodologyInsight,
      )
    ) {
      throw new Error(`review_semantic_methodology_contains_meta:${item.id}`);
    }
    found.set(item.id, {
      coreInsight,
      ...(methodologyInsight === undefined ? {} : { methodologyInsight }),
    });
  }
  if (
    found.size !== expectedIds.size ||
    [...expectedIds].some((id) => !found.has(id)) ||
    [...found].some(([id]) => !expectedIds.has(id))
  ) {
    throw new Error('review_semantic_identity_mismatch');
  }
  return found;
}

function parseJsonObject(raw) {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('review_semantic_json_missing');
  const candidate = normalizeMarkdownMathEscapes(raw.slice(first, last + 1));
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(jsonrepair(candidate));
  }
}

function isAsciiLetter(value) {
  return value !== undefined && /^[A-Za-z]$/u.test(value);
}

function normalizeMarkdownMathEscapes(source) {
  let normalized = '';
  let inString = false;
  let mathDelimiter;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (!inString) {
      normalized += character;
      if (character === '"') inString = true;
      continue;
    }
    if (character === '"') {
      normalized += character;
      inString = false;
      mathDelimiter = undefined;
      continue;
    }
    if (character === '$') {
      const delimiter = source[index + 1] === '$' ? '$$' : '$';
      normalized += delimiter;
      if (delimiter === '$$') index += 1;
      mathDelimiter = mathDelimiter === delimiter ? undefined : (mathDelimiter ?? delimiter);
      continue;
    }
    if (character !== '\\') {
      normalized += character;
      continue;
    }

    const next = source[index + 1];
    if (next === undefined) {
      normalized += '\\\\';
      continue;
    }
    if (next === '\\' || next === '"' || next === '/') {
      normalized += `\\${next}`;
      index += 1;
      continue;
    }
    if (next === '[' || next === '(') {
      normalized += `\\\\${next}`;
      mathDelimiter = next === '[' ? '\\[' : '\\(';
      index += 1;
      continue;
    }
    if (next === ']' || next === ')') {
      normalized += `\\\\${next}`;
      const closingDelimiter = next === ']' ? '\\[' : '\\(';
      if (mathDelimiter === closingDelimiter) mathDelimiter = undefined;
      index += 1;
      continue;
    }

    const isJsonControlEscape = /^[bfnrt]$/u.test(next);
    const isUnicodeEscape =
      next === 'u' && /^[0-9a-fA-F]{4}$/u.test(source.slice(index + 2, index + 6));
    const isLikelyTexControlWord =
      mathDelimiter !== undefined && isJsonControlEscape && isAsciiLetter(source[index + 2]);
    if ((!isJsonControlEscape && !isUnicodeEscape) || isLikelyTexControlWord) {
      normalized += `\\\\${next}`;
      index += 1;
      continue;
    }

    normalized += `\\${next}`;
    index += 1;
  }
  return normalized;
}

async function runCodex(prompt, model, reasoningEffort) {
  const executable = process.env.LEARNING_MORE_CODEX_CLI_EXECUTABLE ?? 'codex.exe';
  const arguments_ = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--model',
    model,
    '-c',
    `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    '-',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd: projectRoot,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`review_semantic_codex_failed:${code}:${stderr.slice(-500)}`));
    });
    child.stdin.end(prompt, 'utf8');
  });
}

async function runCodexWithRetry(prompt, model, reasoningEffort, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runCodex(prompt, model, reasoningEffort);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      process.stderr.write(
        `${JSON.stringify({ event: 'semantic-batch-retry', attempt, reason: String(error) })}\n`,
      );
      await new Promise((resolve) => {
        setTimeout(resolve, attempt * 1_000);
      });
    }
  }
  throw lastError;
}

function semanticPrompt(items) {
  return [
    '你是 Learning MORE 的课时 Review 语义收束模块。',
    '只返回一个 JSON 对象：{"items":[{"id":"原样返回","coreInsight":"...","methodologyInsight":"...可省略"}]}。不要代码围栏或说明。',
    'coreInsight：仅以每个项目的 finalClassroomSummary 为来源，理解该总结并识别其中承担知识表达的有效语义，动态保留完成理解所必需的总结结构；结构可以随课程内容表现为概念关系、因果链、判断框架、操作步骤、条件对比、推理过程、适用边界或其他必要形式。允许保留必要段落、列表与层次，不得套用固定框架。有效知识内容允许原样保留，不要求改写。',
    'coreInsight 必须保留承载语义的 Markdown 格式，包括原总结中有助于理解的加粗、分段、编号层级、列表、引用块、代码或公式；不要把清晰的关系链、分项解释和结论段改写成连续的大段正文。只移除不承载知识结构的装饰性格式，不新增 finalClassroomSummary 没有的事实、案例、解释或结构。',
    'methodologyInsight：从综合应用所连接的知识关系中提炼一句可迁移的方法、判断原则或技巧，最多 240 字且不得换行。不要复述知识点清单，不要写“把本课合起来看”“本课真正值得保留的是”等引导语。',
    'coreInsight 只在 finalClassroomSummary 内部进行语义识别：完成宣布、用户评价、掌握判断、互动复盘、鼓励、未来学习建议、课程流程说明和不承载知识含义的过渡语不属于核心思想；对承担知识表达的部分，保留其原有措辞、顺序和结构，只合并真正同义的重复表述，不得把互相支撑的不同层次误判为重复。',
    'coreInsight 应在不损失必要总结结构、关键关系、推理链和边界条件的前提下使用清晰紧凑的表达；不得为了简短而删除完成理解所需要的信息，也不得强制压缩成一句话。methodologyInsight 仍负责一句高度凝练、可迁移的方法或技巧，不承担完整总结职责。',
    '综合应用输入包含从任务提出到纠偏或收束的完整片段。优先保留其中最具体、最能迁移的关系或技巧；后出现的流程过渡只提供语境，不因位置更晚而自动覆盖更具体的收束。',
    '用户没有直接回答或明确跳过综合应用时，仍可依据综合应用任务、AI 的纠偏或关系收束、最终课堂总结提炼方法论，但不得声称用户已经掌握、通过或形成能力。来源不足时省略 methodologyInsight。',
    '每个 id 必须逐字原样返回，不得遗漏、改写或新增。',
    JSON.stringify({ items }),
  ].join('\n\n');
}

async function readProviderSelection() {
  const parsed = JSON.parse(
    await readFile(path.join(runtimeRoot, 'provider-config.json'), 'utf8').catch(() => '{}'),
  );
  return {
    model: parsed.publicConfig?.model ?? 'gpt-5.6-sol',
    reasoningEffort: 'medium',
  };
}

async function writeAggregate(file, aggregate, mutateData) {
  const updatedAt = new Date().toISOString();
  const data = mutateData(structuredClone(aggregate.data), updatedAt);
  data.resourceVersion = (data.resourceVersion ?? 0) + 1;
  const next = {
    ...aggregate,
    contentSha256: checksumJson(data),
    data,
    resourceVersion: data.resourceVersion,
    updatedAt,
  };
  const temporary = `${file}.review-semantic-${process.pid}.tmp`;
  await writeFile(temporary, encodeJson(next), 'utf8');
  await rename(temporary, file);
}

async function writeArtifact(artifactId, content) {
  const digest = sha256(artifactId);
  const directory = path.join(dataRoot, 'entities', 'artifacts', digest.slice(0, 2), artifactId);
  await mkdir(directory, { recursive: true });
  const contentSha256 = sha256(content);
  const metadata = {
    schemaVersion: 1,
    artifactId,
    kind: 'lesson-final-review',
    contentFile: 'content.md',
    contentSha256,
    immutable: true,
    completionStatus: 'complete',
    createdAt: new Date().toISOString(),
  };
  const temporaryContent = path.join(directory, `content.${process.pid}.tmp`);
  const temporaryMetadata = path.join(directory, `artifact.${process.pid}.tmp`);
  await writeFile(temporaryContent, content, 'utf8');
  await writeFile(temporaryMetadata, `${JSON.stringify(metadata)}\n`, 'utf8');
  await rename(temporaryContent, path.join(directory, 'content.md'));
  await rename(temporaryMetadata, path.join(directory, 'artifact.json'));
}

const taskById = new Map();
for (const file of await filesUnder(path.join(dataRoot, 'entities', 'tasks'))) {
  if (!file.endsWith('.json')) continue;
  const aggregate = JSON.parse(await readFile(file, 'utf8'));
  const task = aggregate.data;
  if (task?.id && typeof task.draftMarkdown === 'string') {
    taskById.set(task.id, {
      reply: extractReply(task.draftMarkdown),
      raw: task.draftMarkdown,
    });
  }
}

const messageById = new Map();
for (const file of await filesUnder(path.join(dataRoot, 'work', 'session-messages'))) {
  if (!file.endsWith('.ndjson')) continue;
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/u)) {
    if (line.trim() === '') continue;
    const record = JSON.parse(line);
    if (record.message?.id) messageById.set(record.message.id, record.message);
  }
}

const lessonProgressByLessonId = new Map();
for (const file of await filesUnder(path.join(dataRoot, 'entities', 'lesson-progress'))) {
  if (!file.endsWith('.json')) continue;
  const aggregate = JSON.parse(await readFile(file, 'utf8'));
  if (aggregate.data?.lessonId) {
    lessonProgressByLessonId.set(aggregate.data.lessonId, { file, aggregate });
  }
}

const records = [];
const unresolved = [];
for (const file of await filesUnder(path.join(dataRoot, 'entities', 'lesson-closures'))) {
  if (!file.endsWith('.json')) continue;
  const aggregate = JSON.parse(await readFile(file, 'utf8'));
  const closure = aggregate.data;
  if (lessonId !== undefined && closure?.lessonId !== lessonId) continue;
  const review = closure?.review;
  if (review?.document?.kind !== 'lesson-final') continue;
  const assistantMessages = (closure.sourceMessageIds ?? [])
    .map((messageId) => messageById.get(messageId))
    .filter(
      (message) =>
        message?.role === 'assistant' &&
        message.completionStatus === 'complete' &&
        message.generationTaskId,
    )
    .map((message) => ({ message, task: taskById.get(message.generationTaskId) }))
    .filter((candidate) => candidate.task?.reply);
  const finalAssistant = selectClassroomSummaryAssistant(assistantMessages);
  if (finalAssistant === undefined) {
    unresolved.push({ transactionId: closure.transactionId, reason: 'final_summary_missing' });
    continue;
  }
  const comprehensiveSynthesis = renderComprehensiveApplicationSegment(
    selectComprehensiveApplicationAssistantReplies(assistantMessages.slice(0, -1)),
  );
  records.push({
    id: closure.transactionId,
    file,
    aggregate,
    closure,
    review,
    progress: lessonProgressByLessonId.get(closure.lessonId),
    semanticInput: {
      id: closure.transactionId,
      lessonTitle: review.document.title,
      finalClassroomSummary: finalAssistant.task.reply,
      comprehensiveSynthesis,
    },
  });
}

if (!apply && !verify) {
  if (exportInputsFile !== undefined) {
    await mkdir(path.dirname(exportInputsFile), { recursive: true });
    await writeFile(
      exportInputsFile,
      `${JSON.stringify(
        records.map((record) => record.semanticInput),
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      mode: 'dry-run',
      eligible: records.length,
      unresolved,
      cacheFile,
      ...(exportInputsFile === undefined ? {} : { exportInputsFile }),
    })}\n`,
  );
  if (unresolved.length > 0) process.exitCode = 2;
} else {
  let cache = {};
  if (!refresh) {
    cache = JSON.parse(await readFile(cacheFile, 'utf8').catch(() => '{}'));
  }
  if (apply) {
    const missing = records.filter((record) => cache[record.id] === undefined);
    if (missing.length > 0 && !allowProviderEgress) {
      throw new Error(
        'review_semantic_provider_egress_not_confirmed:rerun_with_--allow-provider-egress',
      );
    }
    const selection = missing.length > 0 ? await readProviderSelection() : undefined;
    for (let index = 0; index < missing.length; index += batchSize) {
      const batch = missing.slice(index, index + batchSize);
      const expectedIds = new Set(batch.map((record) => record.id));
      const output = await runCodexWithRetry(
        semanticPrompt(batch.map((record) => record.semanticInput)),
        selection.model,
        selection.reasoningEffort,
      );
      const resolved = validateSemanticResult(parseJsonObject(output), expectedIds);
      for (const [id, result] of resolved) cache[id] = result;
      await mkdir(runtimeRoot, { recursive: true });
      await writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
      process.stdout.write(
        `${JSON.stringify({ event: 'semantic-batch-completed', completed: Math.min(index + batch.length, missing.length), total: missing.length })}\n`,
      );
    }
  }

  const mismatches = [];
  let projected = 0;
  let matched = 0;
  for (const record of records) {
    const semantic = cache[record.id];
    if (semantic === undefined) {
      unresolved.push({ transactionId: record.id, reason: 'semantic_result_missing' });
      continue;
    }
    const validated = validateSemanticResult(
      { items: [{ id: record.id, ...semantic }] },
      new Set([record.id]),
    ).get(record.id);
    const document = {
      ...record.review.document,
      coreInsight: validated.coreInsight,
      ...(validated.methodologyInsight === undefined
        ? { methodologyInsight: undefined }
        : { methodologyInsight: validated.methodologyInsight }),
    };
    const markdown = renderReview(document);
    const contentSha256 = sha256(markdown);
    const artifactRef = `lesson_review_${record.closure.finalReviewId}_${contentSha256.slice(0, 16)}`;
    const reviewMatches =
      record.review.document.coreInsight === document.coreInsight &&
      record.review.document.methodologyInsight === document.methodologyInsight &&
      record.review.markdown === markdown &&
      record.review.contentSha256 === contentSha256 &&
      record.review.artifactRef === artifactRef;
    const progressMatches =
      record.progress?.aggregate.data?.finalReview === undefined ||
      (record.progress.aggregate.data.finalReview.document?.coreInsight === document.coreInsight &&
        record.progress.aggregate.data.finalReview.document?.methodologyInsight ===
          document.methodologyInsight &&
        record.progress.aggregate.data.finalReview.contentSha256 === contentSha256 &&
        record.progress.aggregate.data.finalReview.artifactRef === artifactRef);
    if (verify) {
      if (reviewMatches && progressMatches) matched += 1;
      else mismatches.push({ transactionId: record.id, reviewMatches, progressMatches });
      continue;
    }
    await writeArtifact(artifactRef, markdown);
    await writeAggregate(record.file, record.aggregate, (data, updatedAt) => ({
      ...data,
      review: {
        ...data.review,
        artifactRef,
        contentSha256,
        document,
        markdown,
      },
      updatedAt,
    }));
    if (record.progress?.aggregate.data?.finalReview !== undefined) {
      await writeAggregate(record.progress.file, record.progress.aggregate, (data) => ({
        ...data,
        finalReview: {
          ...data.finalReview,
          artifactRef,
          contentSha256,
          document,
        },
      }));
    }
    projected += 1;
  }

  process.stdout.write(
    `${JSON.stringify({
      mode: apply ? 'applied' : 'verified',
      eligible: records.length,
      projected,
      matched,
      unresolved,
      mismatches,
    })}\n`,
  );
  if (unresolved.length > 0 || mismatches.length > 0) process.exitCode = 2;
}
