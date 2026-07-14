import { createHash, randomUUID } from 'node:crypto';

import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { FactRepository } from '../ports/fact-repository.js';
import type { LearningFact } from '../interface.js';
import type {
  WeeklyFactSnapshotEntry,
  WeeklyReportRecord,
  WeeklyReportRepository,
} from '../ports/weekly-report-repository.js';
import {
  assembleWeeklyEvidence,
  type AdditionalWeeklyEvidence,
} from './weekly-evidence-assembler.js';
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

const FACT_SUMMARIES: Readonly<Record<string, string>> = {
  LessonStartedFact: '开始了一节课',
  LessonPausedFact: '暂停了一节正在学习的课程',
  LessonAbandonedFact: '放弃了一节课',
  LessonRestoredFact: '恢复了一节此前放弃的课程',
  LessonCompletedFact: '完成了一节课',
  CourseCreatedFact: '创建了一门课程',
  CourseClosedFact: '关闭了一门课程',
  ReviewFinalizedFact: '完成了一次课时 Review',
  CourseReviewFinalizedFact: '完成了一次课程总 Review',
  ScheduleConfirmedFact: '确认了一项学习计划',
  InteractionPromptedFact: '教学中出现了一次互动邀请',
  InteractionRespondedFact: '回应了一次教学互动',
  InteractionSkippedFact: '跳过了一次教学互动',
};

function evidenceKind(kind: WeeklyFactSnapshotEntry['kind']): string {
  if (kind === 'learning-session') return '课程学习记录';
  if (kind === 'teaching-ledger') return '互动教学观察';
  if (kind === 'review') return 'Review 记录';
  if (kind === 'plan-change') return '学习计划变化';
  if (kind === 'reasoning-evidence') return '思维行为观察';
  return '学习事实';
}

function durationText(actualSeconds: number): string | undefined {
  if (actualSeconds <= 0) return undefined;
  const minutes = Math.round((actualSeconds / 60) * 10) / 10;
  return `${minutes} 分钟`;
}

function renderWeeklyEvidence(
  record: Pick<
    WeeklyReportRecord,
    'startLocalDate' | 'endLocalDate' | 'timezone' | 'factSnapshot' | 'snapshotExclusions'
  >,
): string {
  const evidence = record.factSnapshot.map((entry, index) => {
    const sourceRef = entry.sourceRef ?? `fact:${entry.factId}`;
    const summary = FACT_SUMMARIES[entry.summary ?? ''] ?? entry.summary ?? '记录了一次学习活动';
    const duration = durationText(entry.actualSeconds);
    const tags = entry.topicTags.length === 0 ? undefined : entry.topicTags.join('、');
    return [
      `### 学习证据 ${index + 1}`,
      `来源标记：${sourceRef}`,
      `发生时间：${entry.occurredAt}`,
      `证据类型：${evidenceKind(entry.kind)}`,
      `观察摘要：${summary}`,
      duration === undefined ? undefined : `实际学习时长：${duration}`,
      entry.disciplineTag === undefined ? undefined : `学科范围：${entry.disciplineTag}`,
      tags === undefined ? undefined : `主题范围：${tags}`,
    ]
      .filter((value): value is string => value !== undefined)
      .join('\n');
  });
  const exclusionCount = record.snapshotExclusions?.length ?? 0;
  return [
    `【周报范围】\n${record.startLocalDate} 至 ${record.endLocalDate}，按 ${record.timezone} 统计。`,
    exclusionCount === 0 ? undefined : `有 ${exclusionCount} 条记录因不在本周范围内而未纳入分析。`,
    `【可用学习证据】\n${evidence.length === 0 ? '本周没有足够的可用学习证据。' : evidence.join('\n\n')}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join('\n\n');
}

export function createWeeklyReportService(options: {
  repository: WeeklyReportRepository;
  factRepository: FactRepository;
  assembleAdditionalEvidence?(window: {
    startLocalDate: string;
    endLocalDate: string;
    timezone: string;
  }): Promise<readonly AdditionalWeeklyEvidence[]>;
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
        '生成简洁、有用、自然组织的 Markdown 周学习回顾。每个具体判断都必须来自下面冻结的学习证据；证据不足时应明确说明。',
        '每个包含具体判断的段落或列表块后，追加不可见溯源注释：<!-- sources:来源标记,来源标记 -->。只能使用背景中明确给出的来源标记。',
        '',
        evidenceBackground,
      ].join('\n'),
    });
  }

  return {
    async generate(command: {
      localWeekKey: string;
      startLocalDate: string;
      endLocalDate: string;
      commandId: string;
    }) {
      const existing = await options.repository.get(command.localWeekKey);
      if (existing !== undefined) return existing;
      void command.commandId;
      const facts: LearningFact[] = [];
      for await (const fact of options.factRepository.list()) {
        facts.push(fact);
      }
      const additionalEvidence = await options.assembleAdditionalEvidence?.({
        startLocalDate: command.startLocalDate,
        endLocalDate: command.endLocalDate,
        timezone: options.timeZone,
      });
      const assembled = assembleWeeklyEvidence({
        facts,
        ...(additionalEvidence === undefined ? {} : { additionalEvidence }),
        startLocalDate: command.startLocalDate,
        endLocalDate: command.endLocalDate,
        timeZone: options.timeZone,
      });
      const factSnapshot = assembled.snapshot;
      const factSnapshotHash = sha256(JSON.stringify(factSnapshot));
      const task = await submit({
        localWeekKey: command.localWeekKey,
        startLocalDate: command.startLocalDate,
        endLocalDate: command.endLocalDate,
        timezone: options.timeZone,
        factSnapshot,
        factSnapshotHash,
        snapshotExclusions: assembled.exclusions,
      });
      const timestamp = options.now().toISOString();
      return save({
        localWeekKey: command.localWeekKey,
        timezone: options.timeZone,
        startLocalDate: command.startLocalDate,
        endLocalDate: command.endLocalDate,
        state: 'generating',
        factSnapshot,
        factSnapshotHash,
        ...(assembled.projectionCursor === undefined
          ? {}
          : { projectionCursor: assembled.projectionCursor }),
        snapshotExclusions: assembled.exclusions,
        metricDefinitionVersion: 1,
        generationTaskId: task.taskId,
        createdAt: timestamp,
        updatedAt: timestamp,
        resourceVersion: 0,
      });
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
      const task = await submit(current);
      const { errorCode: _error, draftArtifactRef: _draft, ...withoutFailure } = current;
      void _error;
      void _draft;
      return save({
        ...withoutFailure,
        state: 'generating',
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
      const artifactRef = `weekly_report_${localWeekKey}`;
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
