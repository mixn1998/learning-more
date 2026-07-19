import { createHash, randomUUID } from 'node:crypto';

import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { FactRepository } from '../ports/fact-repository.js';
import type { LearningFact } from '../interface.js';
import type {
  WeeklyFactSnapshotEntry,
  WeeklyReportRecord,
  WeeklyReportRepository,
} from '../ports/weekly-report-repository.js';
import { assembleWeeklyEvidence } from './weekly-evidence-assembler.js';
import { validateWeeklyReportMarkdown } from './weekly-report-output.js';

class WeeklyReportError extends Error {
  constructor(readonly code: 'weekly_report_not_found' | 'weekly_report_immutable') {
    super(code);
    this.name = 'WeeklyReportError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

type CompletedLessonDetails = Readonly<{
  title: string;
  disciplineTag: string;
  summary: string;
}>;

function lessonDetails(entry: WeeklyFactSnapshotEntry): CompletedLessonDetails {
  const title =
    typeof entry.payload?.title === 'string' && entry.payload.title.trim() !== ''
      ? entry.payload.title.trim()
      : (entry.lessonId ?? '未命名课节');
  const summary =
    typeof entry.payload?.lessonSummary === 'string' && entry.payload.lessonSummary.trim() !== ''
      ? entry.payload.lessonSummary.trim()
      : '完成了本课的主要学习内容。';
  return {
    title,
    disciplineTag: entry.disciplineTag?.trim() || '未分类领域',
    summary,
  };
}

function renderWeeklyEvidence(
  record: Pick<
    WeeklyReportRecord,
    'startLocalDate' | 'endLocalDate' | 'timezone' | 'factSnapshot' | 'snapshotExclusions'
  >,
): string {
  const disciplineCounts = new Map<string, number>();
  for (const entry of record.factSnapshot) {
    const discipline = lessonDetails(entry).disciplineTag;
    disciplineCounts.set(discipline, (disciplineCounts.get(discipline) ?? 0) + 1);
  }
  const lessons = record.factSnapshot.map((entry) => {
    const sourceRef = entry.sourceRef ?? `fact:${entry.factId}`;
    const details = lessonDetails(entry);
    return [
      `- ${details.title}（${details.disciplineTag}）：${details.summary}`,
      `来源标记：${sourceRef}`,
    ].join('\n');
  });
  const distribution = [...disciplineCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([discipline, count]) => `${discipline}：${count} 节`)
    .join('；');
  return [
    `【周报范围】\n${record.startLocalDate} 至 ${record.endLocalDate}（结束日期不计入），按 ${record.timezone} 统计。`,
    `【完成概况】\n共完成 ${record.factSnapshot.length} 节课。\n领域分布：${distribution || '本周没有完成课节。'}`,
    `【已完成课节】\n${lessons.length === 0 ? '本周没有完成课节。' : lessons.join('\n')}`,
  ].join('\n\n');
}

function truncateText(value: string, maximumCharacters: number): string {
  const characters = Array.from(value.trim());
  return characters.length <= maximumCharacters
    ? characters.join('')
    : `${characters.slice(0, Math.max(1, maximumCharacters - 1)).join('')}…`;
}

export function deterministicWeeklyReportMarkdown(
  record: Pick<WeeklyReportRecord, 'factSnapshot'>,
): string {
  if (record.factSnapshot.length === 0) {
    return '# 上周学习成果概括\n\n上周没有已完成课节。';
  }
  const disciplineCounts = new Map<string, number>();
  for (const entry of record.factSnapshot) {
    const discipline = lessonDetails(entry).disciplineTag;
    disciplineCounts.set(discipline, (disciplineCounts.get(discipline) ?? 0) + 1);
  }
  const distribution = [...disciplineCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([discipline, count]) => `${discipline}${count}节`)
    .join('、');
  const overview = `上周完成 ${record.factSnapshot.length} 节课，领域分布：${distribution}。`;
  const sourceRefs = record.factSnapshot.map((entry) => entry.sourceRef ?? `fact:${entry.factId}`);
  const availableForLessons = Math.max(80, 270 - Array.from(overview).length);
  const perLesson = Math.max(
    18,
    Math.floor(availableForLessons / Math.min(record.factSnapshot.length, 5)) - 8,
  );
  const lines: string[] = [];
  let included = 0;
  for (const entry of record.factSnapshot) {
    const details = lessonDetails(entry);
    const line = `- **${details.title}**：${truncateText(details.summary, perLesson)}`;
    const candidate = `${overview}\n${[...lines, line].join('\n')}`;
    if (Array.from(candidate).length > 285) break;
    lines.push(line);
    included += 1;
  }
  if (included < record.factSnapshot.length) {
    lines.push(`- 另有 ${record.factSnapshot.length - included} 节课已完成。`);
  }
  const citation = `<!-- sources:${sourceRefs.join(',')} -->`;
  return `# 上周学习成果概括\n\n${overview}${citation}\n\n${lines.join('\n')}\n${citation}`;
}

export function createWeeklyReportService(options: {
  repository: WeeklyReportRepository;
  factRepository: FactRepository;
  prepareSnapshot?(): Promise<void>;
  resolveCompletedLesson?(input: {
    courseId?: string;
    lessonId?: string;
  }): Promise<CompletedLessonDetails | undefined>;
  unitOfWork: UnitOfWork;
  generationRuntime: {
    submit(request: {
      taskKey: string;
      inputSnapshotHash: string;
      taskKind: string;
      taskGroup: 'background';
      ownerRef: string;
      providerId: string;
      priority: number;
      prompt: string;
    }): Promise<{ taskId: string }>;
  };
  finalizeArtifact(
    input: { artifactId: string; kind: string; content: string; immutable: true },
    tx: TransactionContext,
  ): Promise<void>;
  recordFinalized?(
    event: Readonly<{ type: 'WeeklyReportFinalized'; localWeekKey: string; artifactRef: string }>,
    tx: TransactionContext,
  ): Promise<void>;
  providerId?: string;
  timeZone: string;
  now(): Date;
}) {
  async function save(record: WeeklyReportRecord): Promise<WeeklyReportRecord> {
    await options.unitOfWork.execute({ transactionId: `tx_weekly_report_${randomUUID()}` }, (tx) =>
      options.repository.save(tx, record, record.resourceVersion),
    );
    return (await options.repository.get(record.localWeekKey))!;
  }

  async function replaceInvalidWindow(record: WeeklyReportRecord): Promise<WeeklyReportRecord> {
    await options.unitOfWork.execute(
      { transactionId: `tx_repair_weekly_report_${randomUUID()}` },
      (tx) => options.repository.replaceInvalidWindow(tx, record, record.resourceVersion),
    );
    return (await options.repository.get(record.localWeekKey))!;
  }

  async function submit(
    record: Pick<
      WeeklyReportRecord,
      | 'localWeekKey'
      | 'factSnapshotHash'
      | 'factSnapshot'
      | 'startLocalDate'
      | 'endLocalDate'
      | 'timezone'
      | 'snapshotExclusions'
    >,
  ) {
    const evidenceBackground = renderWeeklyEvidence(record);
    return options.generationRuntime.submit({
      taskKey: `weekly-report:${record.localWeekKey}:${record.factSnapshotHash}`,
      inputSnapshotHash: record.factSnapshotHash,
      taskKind: 'weekly-report',
      taskGroup: 'background',
      ownerRef: record.localWeekKey,
      providerId: options.providerId ?? 'current',
      priority: 20,
      prompt: [
        '【输出语言】所有面向学习者的标题、正文和建议必须使用简体中文；必要的专有名词可以保留原文，但不得输出整段英文。',
        '根据下面的确定性周汇总生成简洁、自然的 Markdown 学习成果概括。可见正文不超过 300 个可见字符。',
        '先归并相近课节，提炼为 1 至 3 个学习成果主题，说明学习者本周理解了什么、建立了什么联系；不要逐节机械复述标题和摘要，不要连续使用省略号。',
        '只输出一个“上周学习成果概括”标题和成果正文，不要输出“AI 总结”“下周建议”或下一步行动。',
        '只可概括完成课节数、领域分布、课节标题及一句话摘要；不得增加排期、时长、暂停、互动、教学观察、推理行为、画像或其他数据。',
        '每个包含具体判断的段落或列表块后，追加不可见溯源注释：<!-- sources:来源标记,来源标记 -->。只能使用背景中明确给出的来源标记。',
        '',
        evidenceBackground,
      ].join('\n'),
    });
  }

  async function buildSnapshot(window: { startLocalDate: string; endLocalDate: string }): Promise<
    Readonly<{
      factSnapshot: readonly WeeklyFactSnapshotEntry[];
      factSnapshotHash: string;
      snapshotExclusions: readonly string[];
      projectionCursor?: string;
    }>
  > {
    await options.prepareSnapshot?.();
    const facts: LearningFact[] = [];
    for await (const fact of options.factRepository.list()) facts.push(fact);
    const assembled = assembleWeeklyEvidence({
      facts,
      startLocalDate: window.startLocalDate,
      endLocalDate: window.endLocalDate,
      timeZone: options.timeZone,
    });
    const factSnapshot = await Promise.all(
      assembled.snapshot.map(async (entry): Promise<WeeklyFactSnapshotEntry> => {
        const details =
          (await options.resolveCompletedLesson?.({
            ...(entry.courseId === undefined ? {} : { courseId: entry.courseId }),
            ...(entry.lessonId === undefined ? {} : { lessonId: entry.lessonId }),
          })) ?? lessonDetails(entry);
        return {
          ...entry,
          actualSeconds: 0,
          disciplineTag: details.disciplineTag,
          topicTags: [],
          payload: {
            title: details.title,
            lessonSummary: details.summary,
          },
        };
      }),
    );
    return {
      factSnapshot,
      factSnapshotHash: sha256(JSON.stringify(factSnapshot)),
      snapshotExclusions: assembled.exclusions,
      ...(assembled.projectionCursor === undefined
        ? {}
        : { projectionCursor: assembled.projectionCursor }),
    };
  }

  return {
    async generate(command: {
      localWeekKey: string;
      startLocalDate: string;
      endLocalDate: string;
      commandId: string;
    }) {
      const existing = await options.repository.get(command.localWeekKey);
      if (
        existing !== undefined &&
        existing.startLocalDate === command.startLocalDate &&
        existing.endLocalDate === command.endLocalDate
      ) {
        return existing;
      }
      void command.commandId;
      const snapshot = await buildSnapshot({
        startLocalDate: command.startLocalDate,
        endLocalDate: command.endLocalDate,
      });
      const task = await submit({
        localWeekKey: command.localWeekKey,
        startLocalDate: command.startLocalDate,
        endLocalDate: command.endLocalDate,
        timezone: options.timeZone,
        factSnapshot: snapshot.factSnapshot,
        factSnapshotHash: snapshot.factSnapshotHash,
        snapshotExclusions: snapshot.snapshotExclusions,
      });
      const timestamp = options.now().toISOString();
      const next: WeeklyReportRecord = {
        localWeekKey: command.localWeekKey,
        timezone: options.timeZone,
        startLocalDate: command.startLocalDate,
        endLocalDate: command.endLocalDate,
        state: 'generating',
        factSnapshot: snapshot.factSnapshot,
        factSnapshotHash: snapshot.factSnapshotHash,
        ...(snapshot.projectionCursor === undefined
          ? {}
          : { projectionCursor: snapshot.projectionCursor }),
        snapshotExclusions: snapshot.snapshotExclusions,
        metricDefinitionVersion: 3,
        generationTaskId: task.taskId,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        resourceVersion: existing?.resourceVersion ?? 0,
      };
      return existing === undefined ? save(next) : replaceInvalidWindow(next);
    },

    async fail(localWeekKey: string, errorCode: string, draftArtifactRef: string) {
      const current = await options.repository.get(localWeekKey);
      if (current === undefined) throw new WeeklyReportError('weekly_report_not_found');
      return save({
        ...current,
        state: 'failed',
        errorCode,
        draftArtifactRef,
        updatedAt: options.now().toISOString(),
      });
    },

    async retry(localWeekKey: string, commandId: string) {
      void commandId;
      const current = await options.repository.get(localWeekKey);
      if (current === undefined) throw new WeeklyReportError('weekly_report_not_found');
      if (current.state === 'finalized') throw new WeeklyReportError('weekly_report_immutable');
      const snapshot = await buildSnapshot({
        startLocalDate: current.startLocalDate,
        endLocalDate: current.endLocalDate,
      });
      const task = await submit({
        ...current,
        factSnapshot: snapshot.factSnapshot,
        factSnapshotHash: snapshot.factSnapshotHash,
        snapshotExclusions: snapshot.snapshotExclusions,
      });
      const {
        errorCode: _error,
        draftArtifactRef: _draft,
        projectionCursor: _oldProjectionCursor,
        sourceRefs: _oldSourceRefs,
        ...withoutFailure
      } = current;
      void _error;
      void _draft;
      void _oldProjectionCursor;
      void _oldSourceRefs;
      return save({
        ...withoutFailure,
        state: 'generating',
        factSnapshot: snapshot.factSnapshot,
        factSnapshotHash: snapshot.factSnapshotHash,
        snapshotExclusions: snapshot.snapshotExclusions,
        ...(snapshot.projectionCursor === undefined
          ? {}
          : { projectionCursor: snapshot.projectionCursor }),
        metricDefinitionVersion: 2,
        generationTaskId: task.taskId,
        updatedAt: options.now().toISOString(),
      });
    },

    async finalize(localWeekKey: string, taskId: string, markdown: string) {
      const current = await options.repository.get(localWeekKey);
      if (current === undefined) throw new WeeklyReportError('weekly_report_not_found');
      if (current.state === 'finalized') throw new WeeklyReportError('weekly_report_immutable');
      if (current.generationTaskId !== taskId) throw new Error('WEEKLY_REPORT_TASK_STALE');
      const validation = validateWeeklyReportMarkdown(
        markdown,
        new Set(current.factSnapshot.map((entry) => entry.sourceRef ?? `fact:${entry.factId}`)),
      );
      const artifactRef = `weekly_report_${localWeekKey}_${current.factSnapshotHash.slice(0, 12)}`;
      const contentSha256 = sha256(markdown);
      const { errorCode: _error, draftArtifactRef: _draft, ...withoutFailure } = current;
      void _error;
      void _draft;
      await options.unitOfWork.execute(
        { transactionId: `tx_finalize_weekly_${localWeekKey}` },
        async (tx) => {
          await options.finalizeArtifact(
            { artifactId: artifactRef, kind: 'weekly-report', content: markdown, immutable: true },
            tx,
          );
          await options.repository.save(
            tx,
            {
              ...withoutFailure,
              state: 'finalized',
              artifactRef,
              contentSha256,
              sourceRefs: validation.sourceRefs,
              updatedAt: options.now().toISOString(),
            },
            current.resourceVersion,
          );
          await options.recordFinalized?.(
            { type: 'WeeklyReportFinalized', localWeekKey, artifactRef },
            tx,
          );
        },
      );
      return (await options.repository.get(localWeekKey))!;
    },
  };
}
