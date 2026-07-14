import { describe, expect, it, vi } from 'vitest';

import type { LearningFact } from '../interface.js';
import { createInMemoryFactRepository } from '../ports/fact-repository.js';
import { createInMemoryWeeklyReportRepository } from '../ports/weekly-report-repository.js';
import { createWeeklyReportScheduler } from '../implementation/weekly-report-scheduler.js';
import { createWeeklyReportService } from '../implementation/weekly-report-service.js';

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
  it('fires once at Sunday 00:00 and compensates after downtime across an ISO year boundary', async () => {
    const existing = new Set<string>();
    const commands: Array<{ localWeekKey: string; startLocalDate: string; endLocalDate: string }> =
      [];
    const scheduler = createWeeklyReportScheduler({
      timeZone: 'Asia/Shanghai',
      hasReport: async (weekKey) => existing.has(weekKey),
      enqueue: async (command) => {
        commands.push(command);
        existing.add(command.localWeekKey);
      },
    });
    await scheduler.tick(new Date('2026-07-11T16:00:00.000Z'));
    await scheduler.tick(new Date('2026-07-11T16:00:10.000Z'));
    expect(commands).toEqual([
      { localWeekKey: '2026-W28', startLocalDate: '2026-07-05', endLocalDate: '2026-07-12' },
    ]);

    existing.clear();
    commands.length = 0;
    await scheduler.tick(new Date('2027-01-03T18:00:00.000Z'));
    expect(commands).toEqual([
      { localWeekKey: '2026-W53', startLocalDate: '2026-12-27', endLocalDate: '2027-01-03' },
    ]);
  });
});

describe('WeeklyReportService', () => {
  it('freezes completion facts, retries the same snapshot after failure, and finalizes immutably', async () => {
    const facts = createInMemoryFactRepository();
    await facts.append(tx, completedFact('inside', '2026-07-08T12:00:00.000Z'));
    await facts.append(tx, completedFact('outside', '2026-07-12T16:30:00.000Z'));
    const reports = createInMemoryWeeklyReportRepository();
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ taskId: 'task_week_1' })
      .mockResolvedValueOnce({ taskId: 'task_week_2' });
    const finalizeArtifact = vi.fn().mockResolvedValue(undefined);
    const recordFinalized = vi.fn().mockResolvedValue(undefined);
    const service = createWeeklyReportService({
      repository: reports,
      factRepository: facts,
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
      factSnapshot: [expect.objectContaining({ factId: 'inside', actualSeconds: 600 })],
      generationTaskId: 'task_week_1',
      resourceVersion: 1,
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskKey: `weekly-report:2026-W28:${generating.factSnapshotHash}`,
      }),
    );
    const firstPrompt = submit.mock.calls[0]?.[0]?.prompt as string;
    expect(firstPrompt).toContain('【周报范围】');
    expect(firstPrompt).toContain('【可用学习证据】');
    expect(firstPrompt).toContain('来源标记：fact:inside');
    expect(firstPrompt).toContain('完成了一节课');
    expect(firstPrompt).toContain('10 分钟');
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
    });
    const retrying = await service.retry('2026-W28', 'retry_01');
    expect(retrying).toMatchObject({
      state: 'generating',
      generationTaskId: 'task_week_2',
      factSnapshotHash: generating.factSnapshotHash,
    });
    expect(submit.mock.calls[1]?.[0]).toMatchObject({
      inputSnapshotHash: generating.factSnapshotHash,
    });
    expect(submit.mock.calls[1]?.[0]?.prompt).toBe(firstPrompt);

    await expect(
      service.finalize('2026-W28', 'task_week_2', '# Weekly Review\n\nSolid progress.'),
    ).rejects.toThrow('weekly_report_claim_missing_source');
    await expect(
      service.finalize(
        '2026-W28',
        'task_week_2',
        '# Weekly Review\n\nSolid progress. <!-- sources:fact:invented -->',
      ),
    ).rejects.toThrow('weekly_report_source_unsupported:fact:invented');

    const finalized = await service.finalize(
      '2026-W28',
      'task_week_2',
      '# Weekly Review\n\nOne lesson was completed. <!-- sources:fact:inside -->',
    );
    expect(finalized).toMatchObject({
      state: 'finalized',
      artifactRef: 'weekly_report_2026-W28',
      sourceRefs: ['fact:inside'],
    });
    expect(finalizeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: 'weekly_report_2026-W28', immutable: true }),
      expect.any(Object),
    );
    expect(recordFinalized).toHaveBeenCalledWith(
      {
        type: 'WeeklyReportFinalized',
        localWeekKey: '2026-W28',
        artifactRef: 'weekly_report_2026-W28',
      },
      expect.any(Object),
    );
    await expect(service.retry('2026-W28', 'late_retry')).rejects.toMatchObject({
      code: 'weekly_report_immutable',
    });
  });
});
