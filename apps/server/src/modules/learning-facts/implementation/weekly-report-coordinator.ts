import { weeklyReportWindowForKey, type WeeklyReportWindow } from '@learning-more/contracts';

import type {
  WeeklyReportRecord,
  WeeklyReportRepository,
} from '../ports/weekly-report-repository.js';

type WeeklyReportLifecycle = Readonly<{
  generate(command: WeeklyReportWindow & { commandId: string }): Promise<WeeklyReportRecord>;
  retry(
    localWeekKey: string,
    commandId: string,
    expectedVersion?: number,
  ): Promise<WeeklyReportRecord>;
  fail(
    localWeekKey: string,
    errorCode: string,
    draftArtifactRef: string,
  ): Promise<WeeklyReportRecord>;
  finalize(localWeekKey: string, taskId: string, markdown: string): Promise<WeeklyReportRecord>;
  isLegacyDeterministicOutput(record: WeeklyReportRecord, markdown: string): boolean;
  regenerateLegacyFallback(
    localWeekKey: string,
    command: Pick<WeeklyReportWindow, 'startLocalDate' | 'endLocalDate'>,
    legacyMarkdown: string,
  ): Promise<WeeklyReportRecord>;
}>;

type GenerationTerminal = Readonly<{
  status: string;
  draftMarkdown?: string | undefined;
  errorCode?: string | undefined;
}>;

function errorCode(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'weekly_report_generation_interrupted';
}

function hasCanonicalWindow(record: WeeklyReportRecord, window: WeeklyReportWindow): boolean {
  return (
    record.startLocalDate === window.startLocalDate && record.endLocalDate === window.endLocalDate
  );
}

export function createWeeklyReportCoordinator(options: {
  repository: Pick<WeeklyReportRepository, 'get' | 'list'>;
  service: WeeklyReportLifecycle;
  execution: { awaitTerminal(taskId: string): Promise<GenerationTerminal> };
  readArtifact(artifactRef: string): Promise<string | undefined>;
  now(): Date;
}) {
  const activeFinishes = new Map<string, Promise<void>>();

  async function performFinishGeneration(record: WeeklyReportRecord): Promise<void> {
    let terminal: GenerationTerminal;
    try {
      terminal = await options.execution.awaitTerminal(record.generationTaskId);
    } catch (error) {
      await options.service.fail(
        record.localWeekKey,
        errorCode(error),
        `draft_${record.generationTaskId}`,
      );
      return;
    }
    const markdown = terminal.draftMarkdown?.trim() ?? '';
    if (terminal.status !== 'completed' || markdown === '') {
      await options.service.fail(
        record.localWeekKey,
        terminal.errorCode ??
          (markdown === '' ? 'weekly_report_output_empty' : 'weekly_report_generation_failed'),
        `draft_${record.generationTaskId}`,
      );
      return;
    }
    try {
      await options.service.finalize(record.localWeekKey, record.generationTaskId, markdown);
    } catch (error) {
      await options.service.fail(
        record.localWeekKey,
        errorCode(error),
        `draft_${record.generationTaskId}`,
      );
    }
  }

  function finishGeneration(record: WeeklyReportRecord): Promise<void> {
    const existing = activeFinishes.get(record.generationTaskId);
    if (existing !== undefined) return existing;
    const active = performFinishGeneration(record).finally(() => {
      if (activeFinishes.get(record.generationTaskId) === active) {
        activeFinishes.delete(record.generationTaskId);
      }
    });
    activeFinishes.set(record.generationTaskId, active);
    return active;
  }

  async function reconcileWindow(window: WeeklyReportWindow): Promise<void> {
    let record = await options.repository.get(window.localWeekKey);
    if (record === undefined || !hasCanonicalWindow(record, window)) {
      record = await options.service.generate({
        ...window,
        commandId: `reconcile_weekly_${window.localWeekKey}`,
      });
    } else if (record.state === 'finalized') {
      const markdown =
        record.artifactRef === undefined
          ? undefined
          : await options.readArtifact(record.artifactRef);
      if (markdown !== undefined && options.service.isLegacyDeterministicOutput(record, markdown)) {
        record = await options.service.regenerateLegacyFallback(
          record.localWeekKey,
          window,
          markdown,
        );
      } else {
        return;
      }
    } else if (record.state === 'failed') {
      if (record.nextRetryAt !== undefined && new Date(record.nextRetryAt) > options.now()) return;
      record = await options.service.retry(
        record.localWeekKey,
        `retry_weekly_${record.localWeekKey}_${record.attemptCount ?? 1}`,
      );
    }
    if (record.state === 'generating') await finishGeneration(record);
  }

  return {
    async retry(
      localWeekKey: string,
      commandId: string,
      expectedVersion: number,
    ): Promise<WeeklyReportRecord> {
      const record = await options.service.retry(localWeekKey, commandId, expectedVersion);
      if (record.state === 'generating') {
        void finishGeneration(record).catch(() => undefined);
      }
      return record;
    },
    async reconcile(currentWindow: WeeklyReportWindow): Promise<Date | undefined> {
      const windows = new Map<string, WeeklyReportWindow>([
        [currentWindow.localWeekKey, currentWindow],
      ]);
      for await (const record of options.repository.list()) {
        windows.set(record.localWeekKey, weeklyReportWindowForKey(record.localWeekKey));
      }
      for (const window of [...windows.values()].sort((left, right) =>
        left.localWeekKey.localeCompare(right.localWeekKey),
      )) {
        await reconcileWindow(window);
      }
      let earliest: Date | undefined;
      for await (const record of options.repository.list()) {
        if (record.state !== 'failed' || record.nextRetryAt === undefined) continue;
        const candidate = new Date(record.nextRetryAt);
        if (earliest === undefined || candidate < earliest) earliest = candidate;
      }
      return earliest;
    },
  };
}
