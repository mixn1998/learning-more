import { describe, expect, it, vi } from 'vitest';

import type { LearningFact } from '../interface.js';
import { createInMemoryFactRepository } from '../ports/fact-repository.js';
import { createInMemoryWeeklyReportRepository } from '../ports/weekly-report-repository.js';
import { createWeeklyReportScheduler } from '../implementation/weekly-report-scheduler.js';
import {
  createWeeklyReportService,
  legacyDeterministicWeeklyReportMarkdown,
} from '../implementation/weekly-report-service.js';
import { EMPTY_WEEKLY_REPORT_MARKDOWN } from '../implementation/weekly-report-output.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};

function completedFact(id: string, occurredAt: string): LearningFact {
  return {
    factId: id,
    factType: 'LessonCompletedFact',
    subjectRefs: { courseId: 'course_01', lessonId: `lesson_${id}` },
    occurredAt,
    recordedAt: occurredAt,
    sourceEventId: `event_${id}`,
    dataKeys: ['completion.actual_seconds'],
    payload: { actualSeconds: 600, disciplineTag: 'math', topicTags: ['probability'] },
    schemaVersion: 1,
  };
}

describe('WeeklyReportScheduler', () => {
  it('supplies the canonical completed window across an ISO year boundary', async () => {
    const commands: Array<{ localWeekKey: string; startLocalDate: string; endLocalDate: string }> =
      [];
    const scheduler = createWeeklyReportScheduler({
      timeZone: 'Asia/Shanghai',
      reconcile: async (command) => {
        commands.push(command);
        return undefined;
      },
    });
    await scheduler.tick(new Date('2026-07-12T16:00:00.000Z'));
    expect(commands).toEqual([
      { localWeekKey: '2026-W28', startLocalDate: '2026-07-06', endLocalDate: '2026-07-13' },
    ]);

    commands.length = 0;
    await scheduler.tick(new Date('2027-01-04T18:00:00.000Z'));
    expect(commands).toEqual([
      { localWeekKey: '2026-W53', startLocalDate: '2026-12-28', endLocalDate: '2027-01-04' },
    ]);
  });

  it('stays armed and creates the next snapshot at Monday midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T15:59:30.000Z'));
    try {
      const commands: Array<{
        localWeekKey: string;
        startLocalDate: string;
        endLocalDate: string;
      }> = [];
      const scheduler = createWeeklyReportScheduler({
        timeZone: 'Asia/Shanghai',
        reconcile: async (command) => {
          commands.push(command);
          return undefined;
        },
      });

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(commands).toEqual([
        { localWeekKey: '2026-W27', startLocalDate: '2026-06-29', endLocalDate: '2026-07-06' },
      ]);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(commands.at(-1)).toEqual({
        localWeekKey: '2026-W28',
        startLocalDate: '2026-07-06',
        endLocalDate: '2026-07-13',
      });
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries failed reconciliation at the durable due time without waiting a week', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    try {
      let calls = 0;
      const scheduler = createWeeklyReportScheduler({
        timeZone: 'Asia/Shanghai',
        now: () => new Date(),
        reconcile: async () => {
          calls += 1;
          return calls === 1 ? new Date('2026-07-20T00:00:05.000Z') : undefined;
        },
      });

      await scheduler.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls).toBe(2);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('WeeklyReportService', () => {
  it('finalizes an empty canonical week without submitting an AI task', async () => {
    const reports = createInMemoryWeeklyReportRepository();
    const submit = vi.fn();
    const finalizeArtifact = vi.fn().mockResolvedValue(undefined);
    const service = createWeeklyReportService({
      repository: reports,
      factRepository: createInMemoryFactRepository(),
      unitOfWork,
      generationRuntime: { submit },
      finalizeArtifact,
      timeZone: 'Asia/Shanghai',
      now: () => new Date('2026-07-20T00:00:00.000Z'),
    });

    const report = await service.generate({
      localWeekKey: '2026-W28',
      startLocalDate: '2026-07-06',
      endLocalDate: '2026-07-13',
      commandId: 'empty_week',
    });

    expect(report).toMatchObject({
      state: 'finalized',
      factSnapshot: [],
      sourceRefs: [],
      generationTaskId: expect.stringMatching(/^weekly_report_empty_2026-W28_/u),
    });
    expect(submit).not.toHaveBeenCalled();
    expect(finalizeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ content: EMPTY_WEEKLY_REPORT_MARKDOWN, immutable: true }),
      expect.any(Object),
    );
  });

  it('freezes compact completion summaries, rebuilds failed snapshots, and finalizes immutably', async () => {
    const facts = createInMemoryFactRepository();
    await facts.append(tx, completedFact('inside', '2026-07-08T12:00:00.000Z'));
    await facts.append(tx, completedFact('sunday', '2026-07-12T12:00:00.000Z'));
    await facts.append(tx, completedFact('outside', '2026-07-12T16:30:00.000Z'));
    const reports = createInMemoryWeeklyReportRepository();
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ taskId: 'task_week_1' })
      .mockResolvedValueOnce({ taskId: 'task_week_2' })
      .mockResolvedValueOnce({ taskId: 'task_week_3' });
    const finalizeArtifact = vi.fn().mockResolvedValue(undefined);
    const recordFinalized = vi.fn().mockResolvedValue(undefined);
    const prepareSnapshot = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        await facts.append(tx, completedFact('late', '2026-07-10T12:00:00.000Z'));
      });
    const service = createWeeklyReportService({
      repository: reports,
      factRepository: facts,
      prepareSnapshot,
      async resolveCompletedLesson({ lessonId }) {
        return {
          title: lessonId === 'lesson_inside' ? '概率基础' : '随机变量',
          disciplineTag: '数学',
          summary:
            lessonId === 'lesson_inside'
              ? '理解概率空间如何描述随机试验。'
              : '理解随机变量如何把结果映射为数值。',
        };
      },
      unitOfWork,
      generationRuntime: { submit },
      finalizeArtifact,
      recordFinalized,
      timeZone: 'Asia/Shanghai',
      now: () => new Date('2026-07-12T00:00:00.000Z'),
    });
    const generating = await service.generate({
      localWeekKey: '2026-W28',
      startLocalDate: '2026-07-05',
      endLocalDate: '2026-07-12',
      commandId: 'generate_01',
    });
    expect(generating).toMatchObject({
      state: 'generating',
      factSnapshot: [
        expect.objectContaining({
          factId: 'inside',
          disciplineTag: '数学',
          payload: {
            title: '概率基础',
            lessonSummary: '理解概率空间如何描述随机试验。',
          },
        }),
      ],
      generationTaskId: 'task_week_1',
      resourceVersion: 1,
      metricDefinitionVersion: 4,
      attemptCount: 1,
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskKey: `weekly-report:2026-W28:${generating.factSnapshotHash}`,
      }),
    );
    const firstPrompt = submit.mock.calls[0]?.[0]?.prompt as string;
    expect(firstPrompt).toContain('【周报范围】');
    expect(firstPrompt).toContain('【完成概况】');
    expect(firstPrompt).toContain('共完成 1 节课');
    expect(firstPrompt).toContain('数学：1 节');
    expect(firstPrompt).toContain('概率基础（数学）：理解概率空间如何描述随机试验。');
    expect(firstPrompt).toContain('必须使用简体中文');
    expect(firstPrompt).toContain('来源标记：fact:inside');
    expect(firstPrompt).toContain('不超过 300 个可见字符');
    expect(firstPrompt).not.toContain('10 分钟');
    expect(firstPrompt).not.toContain('ScheduleConfirmedFact');
    expect(firstPrompt).not.toContain('LessonPausedFact');
    expect(firstPrompt).not.toContain('factSnapshotHash');
    expect(firstPrompt).not.toContain('localWeekKey');
    expect(firstPrompt).not.toContain('factId');
    expect(firstPrompt).not.toContain('payload');
    expect(firstPrompt).not.toContain('course_01');
    expect(firstPrompt).not.toContain('lesson_inside');

    await service.fail('2026-W28', 'provider_timeout', 'draft_week_1');
    const failed = await reports.get('2026-W28');
    expect(failed).toMatchObject({
      state: 'failed',
      factSnapshotHash: generating.factSnapshotHash,
      attemptCount: 1,
      nextRetryAt: '2026-07-12T00:05:00.000Z',
    });
    const retrying = await service.retry('2026-W28', 'retry_01');
    expect(retrying).toMatchObject({
      state: 'generating',
      generationTaskId: 'task_week_2',
      factSnapshot: [
        expect.objectContaining({ factId: 'inside' }),
        expect.objectContaining({ factId: 'late' }),
      ],
      attemptCount: 2,
      metricDefinitionVersion: 4,
    });
    expect(retrying.factSnapshotHash).not.toBe(generating.factSnapshotHash);
    expect(prepareSnapshot).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]?.[0]).toMatchObject({
      inputSnapshotHash: retrying.factSnapshotHash,
    });
    expect(submit.mock.calls[1]?.[0]?.prompt).toContain('共完成 2 节课');

    await expect(
      service.finalize('2026-W28', 'task_week_2', '# 本周回顾\n\n学习有进展。'),
    ).rejects.toThrow('weekly_report_claim_missing_source');
    await expect(
      service.finalize(
        '2026-W28',
        'task_week_2',
        '# 本周回顾\n\n学习有进展。 <!-- sources:fact:invented -->',
      ),
    ).rejects.toThrow('weekly_report_source_unsupported:fact:invented');

    const semanticMarkdown = [
      '# 上周学习成果概括',
      '',
      '上周完成 2 节数学课程。 <!-- sources:fact:inside,fact:late -->',
      '',
      '- **概率与随机变量**：理解概率空间如何描述随机试验，并进一步认识随机变量如何把试验结果映射为可分析的数值。 <!-- sources:fact:inside,fact:late -->',
    ].join('\n');
    const finalized = await service.finalize('2026-W28', 'task_week_2', semanticMarkdown);
    expect(finalized).toMatchObject({
      state: 'finalized',
      artifactRef: expect.stringMatching(/^weekly_report_2026-W28_/u),
      sourceRefs: ['fact:inside', 'fact:late'],
    });
    expect(finalizeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: expect.stringMatching(/^weekly_report_2026-W28_/u),
        immutable: true,
      }),
      expect.any(Object),
    );
    expect(recordFinalized).toHaveBeenCalledWith(
      {
        type: 'WeeklyReportFinalized',
        localWeekKey: '2026-W28',
        artifactRef: expect.stringMatching(/^weekly_report_2026-W28_/u),
      },
      expect.any(Object),
    );
    await expect(service.retry('2026-W28', 'late_retry')).rejects.toMatchObject({
      code: 'weekly_report_immutable',
    });

    const repaired = await service.generate({
      localWeekKey: '2026-W28',
      startLocalDate: '2026-07-06',
      endLocalDate: '2026-07-13',
      commandId: 'repair_window_01',
    });
    expect(repaired).toMatchObject({
      state: 'generating',
      startLocalDate: '2026-07-06',
      endLocalDate: '2026-07-13',
      generationTaskId: 'task_week_3',
      metricDefinitionVersion: 4,
    });
    expect(repaired.factSnapshot.map((fact) => fact.factId)).toEqual(['inside', 'late', 'sunday']);
    expect(repaired.artifactRef).toBeUndefined();
  });

  it('reopens only a finalized artifact that exactly matches the retired mechanical fallback', async () => {
    const facts = createInMemoryFactRepository();
    await facts.append(tx, completedFact('legacy', '2026-07-08T12:00:00.000Z'));
    const reports = createInMemoryWeeklyReportRepository();
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ taskId: 'task_legacy_1' })
      .mockResolvedValueOnce({ taskId: 'task_legacy_2' });
    const service = createWeeklyReportService({
      repository: reports,
      factRepository: facts,
      unitOfWork,
      generationRuntime: { submit },
      finalizeArtifact: vi.fn().mockResolvedValue(undefined),
      timeZone: 'Asia/Shanghai',
      now: () => new Date('2026-07-20T00:00:00.000Z'),
    });
    const generating = await service.generate({
      localWeekKey: '2026-W28',
      startLocalDate: '2026-07-06',
      endLocalDate: '2026-07-13',
      commandId: 'seed_legacy',
    });
    const legacy = legacyDeterministicWeeklyReportMarkdown(generating);
    const finalized = await service.finalize('2026-W28', 'task_legacy_1', legacy);
    expect(service.isLegacyDeterministicOutput(finalized, legacy)).toBe(true);
    expect(service.isLegacyDeterministicOutput(finalized, `${legacy}\n`)).toBe(false);

    const regenerating = await service.regenerateLegacyFallback(
      '2026-W28',
      { startLocalDate: '2026-07-06', endLocalDate: '2026-07-13' },
      legacy,
    );
    expect(regenerating).toMatchObject({
      state: 'generating',
      generationTaskId: 'task_legacy_2',
      attemptCount: 1,
      metricDefinitionVersion: 4,
    });
    expect(regenerating.artifactRef).toBeUndefined();

    const regenerated = await service.finalize(
      '2026-W28',
      'task_legacy_2',
      '# 上周学习成果概括\n\n上周完成 1 节数学课程，并围绕随机变量建立了整体认识。 <!-- sources:fact:legacy -->',
    );
    expect(regenerated.artifactRef).not.toBe(finalized.artifactRef);
  });
});
