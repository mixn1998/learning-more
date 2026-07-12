import { createHash, randomUUID } from 'node:crypto';

import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { FactRepository } from '../ports/fact-repository.js';
import type {
  WeeklyFactSnapshotEntry,
  WeeklyReportRecord,
  WeeklyReportRepository,
} from '../ports/weekly-report-repository.js';
import { localDate } from './projections/shared.js';

class WeeklyReportError extends Error {
  constructor(readonly code: 'weekly_report_not_found' | 'weekly_report_immutable') {
    super(code);
    this.name = 'WeeklyReportError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createWeeklyReportService(options: {
  repository: WeeklyReportRepository;
  factRepository: FactRepository;
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
  timeZone: string;
  now(): Date;
}) {
  async function save(record: WeeklyReportRecord): Promise<WeeklyReportRecord> {
    await options.unitOfWork.execute({ transactionId: `tx_weekly_report_${randomUUID()}` }, (tx) =>
      options.repository.save(tx, record, record.resourceVersion),
    );
    return (await options.repository.get(record.localWeekKey))!;
  }

  async function submit(record: Pick<WeeklyReportRecord, 'localWeekKey' | 'factSnapshotHash'>) {
    return options.generationRuntime.submit({
      taskKey: `weekly-report:${record.localWeekKey}:${record.factSnapshotHash}`,
      inputSnapshotHash: record.factSnapshotHash,
      taskKind: 'weekly-report',
      taskGroup: 'background',
      ownerRef: record.localWeekKey,
      providerId: 'current',
      priority: 20,
      prompt: JSON.stringify({
        templateRef: 'weekly-report@v1',
        inputArtifactRef: `weekly-fact-snapshot:${record.factSnapshotHash}`,
      }),
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
      const factSnapshot: WeeklyFactSnapshotEntry[] = [];
      let projectionCursor: string | undefined;
      for await (const fact of options.factRepository.list()) {
        projectionCursor = fact.sourceEventId;
        if (fact.factType !== 'LessonCompletedFact') continue;
        const date = localDate(fact.occurredAt, options.timeZone);
        if (date < command.startLocalDate || date >= command.endLocalDate) continue;
        factSnapshot.push({
          factId: fact.factId,
          occurredAt: fact.occurredAt,
          ...(fact.subjectRefs.courseId === undefined
            ? {}
            : { courseId: fact.subjectRefs.courseId }),
          ...(fact.subjectRefs.lessonId === undefined
            ? {}
            : { lessonId: fact.subjectRefs.lessonId }),
          actualSeconds:
            typeof fact.payload.actualSeconds === 'number' ? fact.payload.actualSeconds : 0,
          ...(typeof fact.payload.disciplineTag === 'string'
            ? { disciplineTag: fact.payload.disciplineTag }
            : {}),
          topicTags: Array.isArray(fact.payload.topicTags)
            ? fact.payload.topicTags.filter((value): value is string => typeof value === 'string')
            : [],
        });
      }
      const factSnapshotHash = sha256(JSON.stringify(factSnapshot));
      const task = await submit({ localWeekKey: command.localWeekKey, factSnapshotHash });
      const timestamp = options.now().toISOString();
      return save({
        localWeekKey: command.localWeekKey,
        timezone: options.timeZone,
        startLocalDate: command.startLocalDate,
        endLocalDate: command.endLocalDate,
        state: 'generating',
        factSnapshot,
        factSnapshotHash,
        ...(projectionCursor === undefined ? {} : { projectionCursor }),
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
