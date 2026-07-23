import { describe, expect, it, vi } from 'vitest';

import type { WeeklyReportRecord } from '../ports/weekly-report-repository.js';
import { createWeeklyReportCoordinator } from '../implementation/weekly-report-coordinator.js';

function report(overrides: Partial<WeeklyReportRecord> = {}): WeeklyReportRecord {
  return {
    localWeekKey: '2026-W28',
    timezone: 'Asia/Shanghai',
    startLocalDate: '2026-07-06',
    endLocalDate: '2026-07-13',
    state: 'generating',
    factSnapshot: [],
    factSnapshotHash: 'a'.repeat(64),
    snapshotExclusions: [],
    metricDefinitionVersion: 4,
    generationTaskId: 'task_week',
    attemptCount: 1,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    resourceVersion: 1,
    ...overrides,
  };
}

describe('WeeklyReportCoordinator', () => {
  it('keeps invalid AI output failed instead of finalizing a mechanical fallback', async () => {
    let current: WeeklyReportRecord | undefined;
    const retryAt = '2026-07-20T00:05:00.000Z';
    const service = {
      generate: vi.fn(async () => {
        current = report();
        return current;
      }),
      retry: vi.fn(),
      regenerateLegacyFallback: vi.fn(),
      isLegacyDeterministicOutput: vi.fn(() => false),
      finalize: vi.fn().mockRejectedValue(new Error('weekly_report_claim_missing_source')),
      fail: vi.fn(async () => {
        current = report({ state: 'failed', nextRetryAt: retryAt });
        return current;
      }),
    };
    const coordinator = createWeeklyReportCoordinator({
      repository: {
        get: async () => current,
        async *list() {
          if (current !== undefined) yield current;
        },
      },
      service,
      execution: {
        awaitTerminal: async () => ({
          status: 'completed' as const,
          draftMarkdown: '# 上周学习成果概括\n\n没有来源的机械总结。',
        }),
      },
      readArtifact: async () => undefined,
      now: () => new Date('2026-07-20T00:00:00.000Z'),
    });

    await expect(
      coordinator.reconcile({
        localWeekKey: '2026-W28',
        startLocalDate: '2026-07-06',
        endLocalDate: '2026-07-13',
      }),
    ).resolves.toEqual(new Date(retryAt));
    expect(service.finalize).toHaveBeenCalledTimes(1);
    expect(service.fail).toHaveBeenCalledWith(
      '2026-W28',
      'weekly_report_claim_missing_source',
      'draft_task_week',
    );
    expect(service.regenerateLegacyFallback).not.toHaveBeenCalled();
  });

  it('reconciles every historical invalid window, due failure, and known legacy fallback', async () => {
    const records = new Map<string, WeeklyReportRecord>([
      [
        '2026-W26',
        report({
          localWeekKey: '2026-W26',
          startLocalDate: '2026-06-22',
          endLocalDate: '2026-06-29',
          state: 'finalized',
          artifactRef: 'legacy_artifact',
          contentSha256: 'b'.repeat(64),
        }),
      ],
      [
        '2026-W27',
        report({
          localWeekKey: '2026-W27',
          startLocalDate: '2026-06-29',
          endLocalDate: '2026-07-06',
          state: 'failed',
          nextRetryAt: '2026-07-19T23:59:00.000Z',
        }),
      ],
      [
        '2026-W28',
        report({
          startLocalDate: '2026-07-05',
          endLocalDate: '2026-07-12',
          state: 'finalized',
        }),
      ],
    ]);
    const finalized = (value: WeeklyReportRecord) => ({
      ...value,
      state: 'finalized' as const,
      artifactRef: `artifact_${value.localWeekKey}`,
      contentSha256: 'c'.repeat(64),
    });
    const service = {
      generate: vi.fn(
        async (command: { localWeekKey: string; startLocalDate: string; endLocalDate: string }) => {
          const next = finalized(
            report({
              ...command,
              resourceVersion: records.get(command.localWeekKey)?.resourceVersion ?? 0,
            }),
          );
          records.set(command.localWeekKey, next);
          return next;
        },
      ),
      retry: vi.fn(async (key: string) => {
        const next = finalized(records.get(key)!);
        records.set(key, next);
        return next;
      }),
      regenerateLegacyFallback: vi.fn(async (key: string) => {
        const next = finalized(records.get(key)!);
        records.set(key, next);
        return next;
      }),
      finalize: vi.fn(),
      fail: vi.fn(),
      isLegacyDeterministicOutput: vi.fn(
        (record: WeeklyReportRecord, markdown: string) =>
          record.localWeekKey === '2026-W26' && markdown === 'legacy mechanical markdown',
      ),
    };
    const coordinator = createWeeklyReportCoordinator({
      repository: {
        get: async (key: string) => records.get(key),
        async *list() {
          for (const value of records.values()) yield value;
        },
      },
      service,
      execution: { awaitTerminal: vi.fn() },
      readArtifact: async (artifactRef: string) =>
        artifactRef === 'legacy_artifact' ? 'legacy mechanical markdown' : undefined,
      now: () => new Date('2026-07-20T00:00:00.000Z'),
    });

    await coordinator.reconcile({
      localWeekKey: '2026-W29',
      startLocalDate: '2026-07-13',
      endLocalDate: '2026-07-20',
    });

    expect(service.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        localWeekKey: '2026-W28',
        startLocalDate: '2026-07-06',
        endLocalDate: '2026-07-13',
      }),
    );
    expect(service.retry).toHaveBeenCalledWith('2026-W27', expect.any(String));
    expect(service.regenerateLegacyFallback).toHaveBeenCalledWith(
      '2026-W26',
      expect.objectContaining({
        localWeekKey: '2026-W26',
        startLocalDate: '2026-06-22',
        endLocalDate: '2026-06-29',
      }),
      'legacy mechanical markdown',
    );
  });
});
