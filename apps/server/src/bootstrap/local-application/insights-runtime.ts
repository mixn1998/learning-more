import { randomUUID } from 'node:crypto';

import type { LearningFactsRouteOptions } from '../../http/routes/learning-facts.js';
import { createWeeklyReportScheduler } from '../../modules/learning-facts/implementation/weekly-report-scheduler.js';
import {
  createWeeklyReportService,
  deterministicWeeklyReportMarkdown,
} from '../../modules/learning-facts/implementation/weekly-report-service.js';
import { weeklyReportMarkdownForRead } from '../../modules/learning-facts/implementation/weekly-report-output.js';
import type { DataRoot } from '../../persistence/data-root.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import { createLocalFileWeeklyReportRepository } from '../../persistence/weekly-report-repositories.js';
import type { LocalEventFactsRuntime } from './event-facts-runtime.js';
import type { LocalGenerationRuntime } from './generation-runtime.js';
import type { LocalLearningRuntime } from './learning-runtime.js';
import type { LocalCourseRuntime } from './course-runtime.js';

function broadDiscipline(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return '未分类领域';
  if (/(?:商业|创业|business|entrepreneur)/iu.test(normalized)) return '商业';
  if (/(?:数学|mathematics?|calculus)/iu.test(normalized)) return '数学';
  return normalized;
}

function oneSentence(value: string | undefined, fallback: string): string {
  const normalized = (value?.trim() || fallback)
    .replace(/<!--[^]*?-->/gu, ' ')
    .replace(/^[#>*\-+\d.\s]+/gmu, '')
    .replace(/[*_`~]/gu, '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/\s+/gu, ' ')
    .trim();
  const sentence = normalized.match(/^.*?[。！？!?](?:\s|$)/u)?.[0]?.trim() ?? normalized;
  const characters = Array.from(sentence);
  return characters.length <= 100 ? sentence : `${characters.slice(0, 99).join('')}…`;
}

function reviewCoreInsight(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('coreInsight' in value)) return undefined;
  return typeof value.coreInsight === 'string' ? value.coreInsight : undefined;
}

export type LocalInsightsRuntime = Readonly<{
  routes: LearningFactsRouteOptions;
  start(): Promise<void>;
  close(): Promise<void>;
}>;

export function createLocalInsightsRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    artifactStore: ReturnType<typeof createMarkdownArtifactStore>;
    now: () => Date;
    generation: LocalGenerationRuntime;
    events: LocalEventFactsRuntime;
    course: LocalCourseRuntime;
    learning: LocalLearningRuntime;
  }>,
): LocalInsightsRuntime {
  const repository = createLocalFileWeeklyReportRepository(input.dataRoot);
  const weeklyReports = createWeeklyReportService({
    repository,
    factRepository: input.events.factRepository,
    prepareSnapshot: input.events.flush,
    async resolveCompletedLesson({ lessonId }) {
      if (lessonId === undefined) return undefined;
      const lesson = await input.course.access.getLesson(lessonId);
      if (lesson === undefined) return undefined;
      const course = await input.course.access.getCourse(lesson.courseId);
      const outline =
        course === undefined
          ? undefined
          : await input.course.access.getOutlineVersion(course.outlineVersionId);
      const learning = await input.learning.access.getRecord(lessonId);
      return {
        title: lesson.title,
        disciplineTag: broadDiscipline(outline?.disciplineTag),
        summary: oneSentence(reviewCoreInsight(learning?.finalReview?.document), lesson.objective),
      };
    },
    unitOfWork: input.unitOfWork,
    generationRuntime: input.generation.runtime,
    finalizeArtifact: (artifactInput, tx) => input.artifactStore.stageFinalize(tx, artifactInput),
    async recordFinalized(event, tx) {
      const eventId = `event_${randomUUID()}`;
      const timestamp = input.now().toISOString();
      await input.events.outbox.enqueue(tx, [
        {
          id: eventId,
          schema_version: 1,
          type: event.type,
          occurred_at: timestamp,
          recorded_at: timestamp,
          source: 'LearningFacts',
          target_refs: { weeklyReportId: event.localWeekKey },
          payload: {
            localWeekKey: event.localWeekKey,
            artifactRef: event.artifactRef,
          },
          idempotency_key: `weekly-report-finalized:${event.localWeekKey}`,
          correlation_id: eventId,
        },
      ]);
    },
    providerId: 'current',
    timeZone: 'Asia/Shanghai',
    now: input.now,
  });
  const scheduler = createWeeklyReportScheduler({
    timeZone: 'Asia/Shanghai',
    hasReport: async (localWeekKey) => {
      const state = (await repository.get(localWeekKey))?.state;
      return state === 'finalized';
    },
    now: input.now,
    async enqueue(command) {
      let report = await repository.get(command.localWeekKey);
      report ??= await weeklyReports.generate({
        ...command,
        commandId: `generate_weekly_${command.localWeekKey}`,
      });
      if (report.state === 'failed') {
        report = await weeklyReports.retry(
          command.localWeekKey,
          `retry_weekly_${command.localWeekKey}`,
        );
      }
      if (report.state !== 'generating') return;
      const task = await input.generation.execution.awaitTerminal(report.generationTaskId);
      const markdown = task.draftMarkdown?.trim() ?? '';
      if (task.status !== 'completed' || markdown === '') {
        await weeklyReports.fail(
          command.localWeekKey,
          task.errorCode ?? 'ai_unavailable',
          `draft_${report.generationTaskId}`,
        );
        return;
      }
      try {
        await weeklyReports.finalize(command.localWeekKey, report.generationTaskId, markdown);
      } catch (error) {
        try {
          await weeklyReports.finalize(
            command.localWeekKey,
            report.generationTaskId,
            deterministicWeeklyReportMarkdown(report),
          );
        } catch {
          await weeklyReports.fail(
            command.localWeekKey,
            error instanceof Error ? error.message : 'weekly_report_output_invalid',
            `draft_${report.generationTaskId}`,
          );
        }
      }
    },
  });

  return {
    routes: {
      queries: {
        getHistory: input.events.historyView,
        getCourseSummary: input.events.courseSummaryView,
        getStatistics: input.events.statisticsView,
        getCalendar: input.events.calendarView,
        getWeekly: input.events.weeklyView,
        async getWeeklyReport(localWeekKey) {
          const report = await repository.get(localWeekKey);
          if (report === undefined) return undefined;
          const markdown =
            report.artifactRef === undefined
              ? undefined
              : (await input.artifactStore.read(report.artifactRef))?.content;
          return {
            ...report,
            ...(markdown === undefined
              ? {}
              : { markdown: weeklyReportMarkdownForRead(markdown, report.factSnapshot.length) }),
          };
        },
      },
    },
    start: scheduler.start,
    close: async () => scheduler.stop(),
  };
}
