import type {
  CandidateGenerationFailureCode,
  CommandContext,
  CommandResult,
} from '@learning-more/contracts';

import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type { Outbox } from '../../../persistence/outbox.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type {
  CourseAuthoring,
  CourseAuthoringEvidenceCheckpoint,
  CourseAuthoringResult,
  CourseAuthoringView,
} from '../interface.js';
import {
  createOutlineAdjustmentSession,
  createOutlineSession,
  decide,
  evolveAll,
} from '../model/outline-session.js';
import type { CourseCreationRepositories } from '../ports/course-repositories.js';
import type { AuthoringAgent, CompletedLessonOutlineContext } from '../ports/authoring-agent.js';
import type { CandidateAlignmentPlanner } from '../ports/candidate-alignment-planner.js';
import type { OutlineSessionRecord } from '../ports/outline-session-repository.js';
import type { OutlineSessionDraftStore } from '../ports/outline-session-draft-store.js';
import type { NextLessonRecommender } from '../../next-lesson/interface.js';
import type { PlanningOutlineRevisionParticipant } from '../../planning/interface.js';
import { confirmCourse } from './confirm-course.js';
import { createAuthoringContextAssembler } from './authoring-context-assembler.js';
import { reviseCourseOutline } from './revise-course-outline.js';
import { resolveCourseTitle } from '../model/course-title.js';

export interface CandidateGenerationCoordinator {
  generate(input: { readonly commandId: string; readonly outlineSessionId: string }): Promise<{
    readonly taskId: string;
    readonly state: 'running' | 'failed_recoverable';
    readonly failureCode?: CandidateGenerationFailureCode;
    readonly resourceVersion: number;
    readonly draftArtifactRef?: string;
  }>;
  recover(input: { readonly outlineSessionId: string; readonly taskId: string }): Promise<void>;
  cancel?(input: { readonly commandId: string; readonly outlineSessionId: string }): Promise<{
    readonly taskId: string;
    readonly state: 'failed_recoverable';
    readonly failureCode: 'generation_interrupted';
    readonly resourceVersion: number;
  }>;
}

export type RecoverableCourseAuthoring = CourseAuthoring &
  Readonly<{
    recoverInterruptedTurns(): Promise<void>;
  }>;

class ResourceNotFoundError extends Error {
  readonly code = 'resource_not_found';
  constructor() {
    super('resource_not_found');
    this.name = 'ResourceNotFoundError';
  }
}

function assertVersion(current: number, context: CommandContext): void {
  if (context.expectedVersion !== current) throw new RepositoryVersionConflictError(current);
}

export function createCourseAuthoringFacade(options: {
  readonly authoring: CourseAuthoringRepositories;
  readonly courses: CourseCreationRepositories;
  readonly unitOfWork: UnitOfWork;
  readonly candidateGeneration: CandidateGenerationCoordinator;
  readonly authoringAgent: AuthoringAgent;
  readonly candidateAlignmentPlanner: CandidateAlignmentPlanner;
  readonly nextLessonRecommender?: NextLessonRecommender;
  readonly outlineRevisionLiveCleanup?: PlanningOutlineRevisionParticipant;
  readonly outbox?: Outbox;
  readonly isLessonCompleted?: (lessonId: string) => Promise<boolean>;
  readonly listCompletedLessonOutlineContexts?: (
    courseId: string,
  ) => Promise<readonly CompletedLessonOutlineContext[]>;
  readonly profileEvidenceSink?: Readonly<{
    capture(checkpoint: CourseAuthoringEvidenceCheckpoint): void;
  }>;
  readonly onOutlineVersionPublished?: (input: {
    courseId: string;
    outlineVersionId: string;
  }) => Promise<void>;
  readonly nextId: (
    kind: 'session' | 'course' | 'event' | 'outline' | 'adjustment' | 'message',
  ) => string;
  readonly now: () => Date;
  readonly courseArchiveDeletion?: Readonly<{
    execute(
      command: Readonly<{ courseId: string }>,
      context: CommandContext,
    ): Promise<CommandResult<Extract<CourseAuthoringResult, { kind: 'course-archive-deleted' }>>>;
  }>;
  readonly outlineSessionDraftStore?: OutlineSessionDraftStore;
}): RecoverableCourseAuthoring {
  const assembleAuthoringContext = createAuthoringContextAssembler(options.authoring, {
    ...(options.listCompletedLessonOutlineContexts === undefined
      ? {}
      : {
          listCompletedLessonOutlineContexts: options.listCompletedLessonOutlineContexts,
        }),
  });

  async function sessionRecord(outlineSessionId: string) {
    const record = await options.authoring.outlineSessions.get(outlineSessionId);
    if (record === undefined) throw new ResourceNotFoundError();
    return record;
  }

  async function candidateLineage(candidateVersionId: string) {
    const lineage = [];
    const visited = new Set<string>();
    let currentId: string | undefined = candidateVersionId;
    while (currentId !== undefined && !visited.has(currentId)) {
      visited.add(currentId);
      const candidate = await options.authoring.candidateVersions.get(currentId);
      if (candidate === undefined) break;
      lineage.push(candidate);
      currentId = candidate.parentVersionId;
    }
    return lineage.reverse();
  }

  function orderedUnique(values: readonly string[]): string[] {
    return [...new Set(values)];
  }

  function sessionActivity(record: OutlineSessionRecord): string {
    return record.messages.at(-1)?.createdAt ?? '';
  }

  async function openCourseAdjustmentSession(input: {
    readonly courseId: string;
    readonly courseMode: Parameters<typeof createOutlineAdjustmentSession>[0]['courseMode'];
    readonly topic: string;
    readonly baselineCandidateVersionId: string;
    readonly commandId: string;
  }): Promise<OutlineSessionRecord> {
    const lineage = await candidateLineage(input.baselineCandidateVersionId);
    const lineageCandidateIds = new Set(lineage.map((candidate) => candidate.id));
    const lineageSessionIds = orderedUnique(lineage.map((candidate) => candidate.outlineSessionId));
    const allSessions: OutlineSessionRecord[] = [];
    for await (const record of options.authoring.outlineSessions.list()) allSessions.push(record);

    const relatedAdjustments = allSessions
      .filter((record) => {
        if (record.session.confirmedCourseId !== undefined) return false;
        if (record.session.adjustmentCourseId === input.courseId) return true;
        return record.session.candidateVersionIds.some((candidateId) =>
          lineageCandidateIds.has(candidateId),
        );
      })
      .sort((left, right) => {
        const byActivity = sessionActivity(left).localeCompare(sessionActivity(right));
        if (byActivity !== 0) return byActivity;
        const byVersion = left.resourceVersion - right.resourceVersion;
        if (byVersion !== 0) return byVersion;
        return left.session.outlineSessionId.localeCompare(right.session.outlineSessionId);
      });
    const active = relatedAdjustments.at(-1);
    const historySessionIds = orderedUnique([
      ...lineageSessionIds,
      ...relatedAdjustments
        .filter((record) => record.session.outlineSessionId !== active?.session.outlineSessionId)
        .map((record) => record.session.outlineSessionId),
    ]);

    if (active !== undefined) {
      const nextHistory = orderedUnique([
        ...(active.session.historySessionIds ?? []),
        ...historySessionIds,
      ]).filter((sessionId) => sessionId !== active.session.outlineSessionId);
      const alreadyLinked =
        active.session.adjustmentCourseId === input.courseId &&
        JSON.stringify(active.session.historySessionIds ?? []) === JSON.stringify(nextHistory);
      if (alreadyLinked) return active;
      const linked: OutlineSessionRecord = {
        ...active,
        session: {
          ...active.session,
          adjustmentCourseId: input.courseId,
          historySessionIds: nextHistory,
        },
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_link_outline_adjustment_${input.commandId}` },
        (tx) => options.authoring.outlineSessions.save(tx, linked, active.resourceVersion),
      );
      return { ...linked, resourceVersion: active.resourceVersion + 1 };
    }

    const outlineSessionId = options.nextId('session');
    const started: OutlineSessionRecord = {
      session: createOutlineAdjustmentSession({
        outlineSessionId,
        topic: input.topic,
        courseMode: input.courseMode,
        baselineCandidateVersionId: input.baselineCandidateVersionId,
        courseId: input.courseId,
        historySessionIds,
      }),
      resourceVersion: 0,
      candidateCommandReceipts: {},
      messages: [],
    };
    await options.unitOfWork.execute(
      { transactionId: `tx_create_outline_adjustment_${input.commandId}` },
      (tx) => options.authoring.outlineSessions.save(tx, started, 0),
    );
    return { ...started, resourceVersion: 1 };
  }

  async function projectedConversation(record: OutlineSessionRecord) {
    const sources: OutlineSessionRecord[] = [];
    for (const sessionId of record.session.historySessionIds ?? []) {
      const historical = await options.authoring.outlineSessions.get(sessionId);
      if (historical !== undefined) sources.push(historical);
    }
    sources.push(record);
    const seen = new Set<string>();
    return sources
      .flatMap((source, sourceIndex) =>
        source.messages.map((message, messageIndex) => ({
          message,
          order: sourceIndex * 10_000 + messageIndex,
        })),
      )
      .filter(({ message }) => {
        if (seen.has(message.messageId)) return false;
        seen.add(message.messageId);
        return true;
      })
      .sort(
        (left, right) =>
          left.message.createdAt.localeCompare(right.message.createdAt) || left.order - right.order,
      )
      .map(({ message }) => message);
  }

  function result(
    context: CommandContext,
    value: CourseAuthoringResult,
    resourceVersion: number,
    outcome: 'completed' | 'accepted' = 'completed',
  ): CommandResult<CourseAuthoringResult> {
    return { commandId: context.commandId, outcome, value, resourceVersion };
  }

  function canGenerateCandidate(record: OutlineSessionRecord): boolean {
    return (
      record.session.completedAssessmentRounds >= 3 &&
      ![
        'assessment-turn-running',
        'alignment-turn-running',
        'generating-candidates',
        'confirming',
        'confirmed',
      ].includes(record.session.state)
    );
  }

  function captureAuthoringCheckpoint(
    record: OutlineSessionRecord,
    checkpointKind: CourseAuthoringEvidenceCheckpoint['checkpointKind'],
    candidate?: Readonly<{ id: string; createdAt: string; candidate: { outlineMarkdown: string } }>,
    courseId?: string,
  ): void {
    if (options.profileEvidenceSink === undefined) return;
    const suffix = checkpointKind === 'authoring_baseline' ? 'baseline' : 'candidate-confirmed';
    const sourceGroupId = `outline:${record.session.outlineSessionId}`;
    const messageSources = record.messages.slice(-63).map((message) => ({
      sourceRef: `message:${message.messageId}`,
      sourceGroupId,
      sourceType: 'outline' as const,
      role: message.role,
      excerpt: message.content,
      observedAt: message.createdAt,
    }));
    options.profileEvidenceSink.capture({
      checkpointId: `profile:${record.session.outlineSessionId}:${suffix}`,
      checkpointKind,
      sourceType: 'outline',
      sourceGroupId,
      courseMode: record.session.courseMode,
      ...(courseId === undefined ? {} : { courseId }),
      dependentSourceGroupIds: [],
      courseContext: record.session.topic,
      completeness: 'complete',
      sources: [
        ...messageSources,
        ...(candidate === undefined
          ? []
          : [
              {
                sourceRef: `outline:${candidate.id}`,
                sourceGroupId,
                sourceType: 'outline' as const,
                role: 'assistant' as const,
                excerpt: candidate.candidate.outlineMarkdown,
                observedAt: candidate.createdAt,
              },
            ]),
      ],
    });
  }

  async function completeAlignmentTurn(input: {
    readonly record: OutlineSessionRecord;
    readonly userMessageId: string;
    readonly commandId: string;
  }): Promise<OutlineSessionRecord> {
    try {
      const context = await assembleAuthoringContext(input.record.session.outlineSessionId);
      const content = (await options.authoringAgent.respond(context)).trim();
      if (content === '') throw new Error('authoring_agent_empty_response');
      const assistantMessageId = options.nextId('message');
      const session = evolveAll(
        input.record.session,
        decide(input.record.session, {
          type: 'completeAlignmentTurn',
          userMessageId: input.userMessageId,
          assistantMessageId,
          action: 'clarify',
          targetModuleIds: [],
        }),
      );
      const completed: OutlineSessionRecord = {
        ...input.record,
        session,
        messages: [
          ...input.record.messages,
          {
            messageId: assistantMessageId,
            role: 'assistant',
            content,
            status: 'complete',
            createdAt: options.now().toISOString(),
            inReplyToMessageId: input.userMessageId,
          },
        ],
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_authoring_alignment_complete_${input.commandId}` },
        (tx) => options.authoring.outlineSessions.save(tx, completed, input.record.resourceVersion),
      );
      return { ...completed, resourceVersion: input.record.resourceVersion + 1 };
    } catch (error) {
      const session = evolveAll(
        input.record.session,
        decide(input.record.session, {
          type: 'failAlignmentTurn',
          userMessageId: input.userMessageId,
        }),
      );
      await options.unitOfWork.execute(
        { transactionId: `tx_authoring_alignment_failed_${input.commandId}` },
        (tx) =>
          options.authoring.outlineSessions.save(
            tx,
            { ...input.record, session },
            input.record.resourceVersion,
          ),
      );
      throw error;
    }
  }

  async function completeAuthoringTurn(input: {
    readonly record: OutlineSessionRecord;
    readonly userMessageId: string;
    readonly commandId: string;
  }): Promise<OutlineSessionRecord> {
    try {
      const content = (
        await options.authoringAgent.respond(
          await assembleAuthoringContext(input.record.session.outlineSessionId),
        )
      ).trim();
      if (content === '') throw new Error('authoring_agent_empty_response');
      const assistantMessageId = options.nextId('message');
      const session = evolveAll(
        input.record.session,
        decide(input.record.session, {
          type: 'completeAssessmentTurn',
          userMessageId: input.userMessageId,
          assistantMessageId,
        }),
      );
      const completed: OutlineSessionRecord = {
        ...input.record,
        session,
        messages: [
          ...input.record.messages,
          {
            messageId: assistantMessageId,
            role: 'assistant',
            content,
            status: 'complete',
            createdAt: options.now().toISOString(),
            inReplyToMessageId: input.userMessageId,
          },
        ],
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_authoring_turn_complete_${input.commandId}` },
        (tx) => options.authoring.outlineSessions.save(tx, completed, input.record.resourceVersion),
      );
      const stored = { ...completed, resourceVersion: input.record.resourceVersion + 1 };
      if (stored.session.completedAssessmentRounds === 3) {
        captureAuthoringCheckpoint(stored, 'authoring_baseline');
      }
      return stored;
    } catch (error) {
      const session = evolveAll(
        input.record.session,
        decide(input.record.session, {
          type: 'failAssessmentTurn',
          userMessageId: input.userMessageId,
        }),
      );
      await options.unitOfWork.execute(
        { transactionId: `tx_authoring_turn_failed_${input.commandId}` },
        (tx) =>
          options.authoring.outlineSessions.save(
            tx,
            { ...input.record, session },
            input.record.resourceVersion,
          ),
      );
      throw error;
    }
  }

  return {
    async recoverInterruptedTurns() {
      for await (const record of options.authoring.outlineSessions.list()) {
        if (
          record.session.state !== 'assessment-turn-running' &&
          record.session.state !== 'alignment-turn-running'
        ) {
          continue;
        }
        const userMessageId = record.session.activeUserMessageId;
        if (userMessageId === undefined) continue;
        try {
          if (record.session.state === 'alignment-turn-running') {
            await completeAlignmentTurn({
              record,
              userMessageId,
              commandId: `recover_${record.session.outlineSessionId}_${record.resourceVersion}`,
            });
          } else {
            await completeAuthoringTurn({
              record,
              userMessageId,
              commandId: `recover_${record.session.outlineSessionId}_${record.resourceVersion}`,
            });
          }
        } catch {
          // The completion helpers persist a retryable non-running state when the
          // provider cannot be recovered. A concurrent writer wins by version.
        }
      }
    },
    async execute(command, context) {
      if (command.type === 'CreateOutlineAdjustmentSession') {
        const course = await options.courses.courses.get(command.courseId);
        if (course === undefined) throw new ResourceNotFoundError();
        assertVersion(course.resourceVersion, context);
        const outline = await options.courses.outlineVersions.get(course.outlineVersionId);
        if (outline === undefined) throw new ResourceNotFoundError();
        const baselineCandidate = await options.authoring.candidateVersions.get(
          outline.sourceCandidateVersionId,
        );
        if (baselineCandidate === undefined) throw new ResourceNotFoundError();
        const started = await openCourseAdjustmentSession({
          courseId: course.id,
          topic: resolveCourseTitle(outline.outlineMarkdown, course.title),
          courseMode: course.courseMode,
          baselineCandidateVersionId: baselineCandidate.id,
          commandId: context.commandId,
        });
        return result(
          context,
          {
            kind: 'outline-session',
            outlineSessionId: started.session.outlineSessionId,
            state: started.session.state,
            completedAssessmentRounds: started.session.completedAssessmentRounds,
            canGenerateCandidate: canGenerateCandidate(started),
          },
          started.resourceVersion,
        );
      }

      if (command.type === 'CreateOutlineSession') {
        const outlineSessionId = options.nextId('session');
        const userMessageId = options.nextId('message');
        let session = createOutlineSession({
          outlineSessionId,
          topic: command.topic,
          courseMode: command.courseMode,
        });
        session = evolveAll(session, decide(session, { type: 'startAssessment' }));
        session = evolveAll(
          session,
          decide(session, { type: 'startAssessmentTurn', userMessageId }),
        );
        const started: OutlineSessionRecord = {
          session,
          resourceVersion: 0,
          candidateCommandReceipts: {},
          messages: [
            {
              messageId: userMessageId,
              role: 'user',
              content: command.topic.trim(),
              status: 'complete',
              createdAt: options.now().toISOString(),
            },
          ],
        };
        await options.unitOfWork.execute(
          { transactionId: `tx_create_outline_${context.commandId}` },
          (tx) => options.authoring.outlineSessions.save(tx, started, 0),
        );
        const completed = await completeAuthoringTurn({
          record: { ...started, resourceVersion: 1 },
          userMessageId,
          commandId: context.commandId,
        });
        return result(
          context,
          {
            kind: 'outline-session',
            outlineSessionId,
            state: completed.session.state,
            completedAssessmentRounds: completed.session.completedAssessmentRounds,
            canGenerateCandidate: canGenerateCandidate(completed),
          },
          completed.resourceVersion,
        );
      }

      if (command.type === 'AppendOutlineSessionMessage') {
        const record = await sessionRecord(command.outlineSessionId);
        assertVersion(record.resourceVersion, context);
        const userMessageId = options.nextId('message');
        const isAlignment = record.session.state === 'candidate-ready';
        const session = evolveAll(
          record.session,
          decide(record.session, {
            type: isAlignment ? 'startAlignmentTurn' : 'startAssessmentTurn',
            userMessageId,
          }),
        );
        const started: OutlineSessionRecord = {
          ...record,
          session,
          messages: [
            ...record.messages,
            {
              messageId: userMessageId,
              role: 'user',
              content: command.content.trim(),
              status: 'complete',
              createdAt: options.now().toISOString(),
            },
          ],
        };
        await options.unitOfWork.execute(
          { transactionId: `tx_authoring_turn_start_${context.commandId}` },
          (tx) => options.authoring.outlineSessions.save(tx, started, record.resourceVersion),
        );
        if (isAlignment) {
          const completed = await completeAlignmentTurn({
            record: { ...started, resourceVersion: record.resourceVersion + 1 },
            userMessageId,
            commandId: context.commandId,
          });
          return result(
            context,
            {
              kind: 'message',
              outlineSessionId: command.outlineSessionId,
              state: completed.session.state,
              completedAssessmentRounds: completed.session.completedAssessmentRounds,
              canGenerateCandidate: canGenerateCandidate(completed),
            },
            completed.resourceVersion,
          );
        }
        const completed = await completeAuthoringTurn({
          record: { ...started, resourceVersion: record.resourceVersion + 1 },
          userMessageId,
          commandId: context.commandId,
        });
        return result(
          context,
          {
            kind: 'message',
            outlineSessionId: command.outlineSessionId,
            state: completed.session.state,
            completedAssessmentRounds: completed.session.completedAssessmentRounds,
            canGenerateCandidate: canGenerateCandidate(completed),
          },
          completed.resourceVersion,
        );
      }

      if (command.type === 'RequestCandidateGeneration') {
        let record = await sessionRecord(command.outlineSessionId);
        assertVersion(record.resourceVersion, context);
        if (record.session.adjustmentCourseId !== undefined) {
          const planned = await options.candidateAlignmentPlanner.plan(
            await assembleAuthoringContext(record.session.outlineSessionId),
          );
          const plan: Readonly<{
            action: 'patch' | 'regenerate';
            rationale: string;
            targetModuleIds: readonly string[];
          }> =
            planned.action === 'clarify'
              ? {
                  action: 'patch',
                  rationale: planned.rationale,
                  targetModuleIds: ['outline:root'],
                }
              : {
                  action: planned.action,
                  rationale: planned.rationale,
                  targetModuleIds: planned.targetModuleIds,
                };
          const targetModuleIds =
            plan.action === 'patch' && plan.targetModuleIds.length === 0
              ? ['outline:root']
              : plan.targetModuleIds;
          const session = evolveAll(
            record.session,
            decide(record.session, {
              type: 'planCandidateGeneration',
              action: plan.action,
              targetModuleIds,
            }),
          );
          const latestAssistantIndex = record.messages.findLastIndex(
            (message) => message.role === 'assistant',
          );
          const messages = record.messages.map((message, index) =>
            index === latestAssistantIndex
              ? {
                  ...message,
                  alignmentAction: plan.action,
                  targetModuleIds,
                }
              : message,
          );
          const plannedRecord: OutlineSessionRecord = { ...record, session, messages };
          await options.unitOfWork.execute(
            { transactionId: `tx_plan_outline_candidate_${context.commandId}` },
            (tx) =>
              options.authoring.outlineSessions.save(tx, plannedRecord, record.resourceVersion),
          );
          record = { ...plannedRecord, resourceVersion: record.resourceVersion + 1 };
        }
        decide(record.session, {
          type: 'requestCandidate',
          generationTaskId: 'eligibility-check',
        });
        const generated = await options.candidateGeneration.generate({
          commandId: context.commandId,
          outlineSessionId: command.outlineSessionId,
        });
        return result(
          context,
          {
            kind: 'generation',
            taskId: generated.taskId,
            state: generated.state,
            ...(generated.failureCode === undefined ? {} : { failureCode: generated.failureCode }),
            ...(generated.draftArtifactRef === undefined
              ? {}
              : { draftArtifactRef: generated.draftArtifactRef }),
          },
          generated.resourceVersion,
          'accepted',
        );
      }

      if (command.type === 'CancelCandidateGeneration') {
        const record = await sessionRecord(command.outlineSessionId);
        assertVersion(record.resourceVersion, context);
        if (options.candidateGeneration.cancel === undefined)
          throw new Error('generation_cancellation_not_configured');
        const cancelled = await options.candidateGeneration.cancel({
          commandId: context.commandId,
          outlineSessionId: command.outlineSessionId,
        });
        return result(
          context,
          {
            kind: 'generation',
            taskId: cancelled.taskId,
            state: cancelled.state,
            failureCode: cancelled.failureCode,
          },
          cancelled.resourceVersion,
        );
      }

      if (command.type === 'ConfirmOutlineCandidate') {
        const record = await sessionRecord(command.outlineSessionId);
        assertVersion(record.resourceVersion, context);
        const requestedCourseId = options.nextId('course');
        const confirmation = await confirmCourse(
          {
            type: 'courseAuthoring.confirmCourse',
            outlineSessionId: command.outlineSessionId,
            outlineVersionId: command.candidateVersionId,
            courseId: requestedCourseId,
            metadata: {
              idempotencyKey: context.idempotencyKey,
              requestedAt: context.requestedAt,
              ...(context.expectedVersion === undefined
                ? {}
                : { expectedVersion: context.expectedVersion }),
              ...(context.pageInstanceId === undefined
                ? {}
                : { pageInstanceId: context.pageInstanceId }),
            },
          },
          {
            authoring: options.authoring,
            courses: options.courses,
            unitOfWork: options.unitOfWork,
            ...(options.outbox === undefined ? {} : { outbox: options.outbox }),
            ...(options.nextLessonRecommender === undefined
              ? {}
              : { nextLessonRecommender: options.nextLessonRecommender }),
            nextEventId: () => options.nextId('event'),
            now: options.now,
          },
        );
        const course = await options.courses.courses.get(confirmation.courseId);
        if (course === undefined) throw new ResourceNotFoundError();
        const updated = await sessionRecord(command.outlineSessionId);
        const confirmedCandidate = await options.authoring.candidateVersions.get(
          command.candidateVersionId,
        );
        captureAuthoringCheckpoint(
          updated,
          'authoring_candidate_confirmed',
          confirmedCandidate,
          confirmation.courseId,
        );
        void options
          .onOutlineVersionPublished?.({
            courseId: confirmation.courseId,
            outlineVersionId: course.outlineVersionId,
          })
          .catch(() => undefined);
        return result(
          context,
          {
            kind: 'confirmation',
            courseId: confirmation.courseId,
            outlineVersionId: course.outlineVersionId,
          },
          updated.resourceVersion,
        );
      }

      if (command.type === 'ReviseCourseOutline') {
        const course = await options.courses.courses.get(command.courseId);
        if (course === undefined) throw new ResourceNotFoundError();
        assertVersion(course.resourceVersion, context);
        const candidate = await options.authoring.candidateVersions.get(
          command.sourceCandidateVersionId,
        );
        if (candidate === undefined) throw new ResourceNotFoundError();
        const outlineVersionId = options.nextId('outline');
        await reviseCourseOutline(
          {
            adjustmentSessionId: options.nextId('adjustment'),
            courseId: command.courseId,
            sourceCandidateVersionId: command.sourceCandidateVersionId,
            newOutlineVersionId: outlineVersionId,
            expectedCourseVersion: course.resourceVersion,
            candidate: candidate.candidate,
          },
          {
            repositories: options.courses,
            unitOfWork: options.unitOfWork,
            isLessonCompleted: options.isLessonCompleted ?? (async () => false),
            ...(options.nextLessonRecommender === undefined
              ? {}
              : { nextLessonRecommender: options.nextLessonRecommender }),
            ...(options.outlineRevisionLiveCleanup === undefined
              ? {}
              : { liveCleanup: options.outlineRevisionLiveCleanup }),
            now: options.now,
          },
        );
        void options
          .onOutlineVersionPublished?.({ courseId: command.courseId, outlineVersionId })
          .catch(() => undefined);
        return result(
          context,
          { kind: 'revision', courseId: command.courseId, outlineVersionId },
          course.resourceVersion + 1,
        );
      }
      if (command.type === 'DeleteCourseArchive') {
        if (options.courseArchiveDeletion === undefined) {
          throw new Error('course_archive_deletion_not_configured');
        }
        return options.courseArchiveDeletion.execute({ courseId: command.courseId }, context);
      }
      if (command.type === 'DeleteOutlineSessionDraft') {
        if (options.outlineSessionDraftStore === undefined) {
          throw new Error('outline_session_draft_deletion_not_configured');
        }
        const record = await sessionRecord(command.outlineSessionId);
        assertVersion(record.resourceVersion, context);
        if (
          record.session.state === 'confirmed' ||
          record.session.confirmedCourseId !== undefined
        ) {
          throw Object.assign(new Error('outline_session_already_confirmed'), {
            code: 'outline_session_already_confirmed',
          });
        }
        await options.unitOfWork.execute(
          { transactionId: `tx_delete_outline_${context.commandId}` },
          (tx) => options.outlineSessionDraftStore!.stageDelete(tx, command.outlineSessionId),
        );
        return result(
          context,
          {
            kind: 'outline-session-deleted',
            outlineSessionId: command.outlineSessionId,
            deletedAt: options.now().toISOString(),
          },
          record.resourceVersion,
        );
      }
      if (command.type === 'SaveOutlineSessionDraft') {
        const record = await sessionRecord(command.outlineSessionId);
        assertVersion(record.resourceVersion, context);
        if (record.session.state === 'confirmed')
          throw new Error('outline_session_already_confirmed');
        await options.unitOfWork.execute(
          { transactionId: `tx_save_outline_draft_${context.commandId}` },
          (tx) =>
            options.authoring.outlineSessions.save(
              tx,
              { ...record, session: { ...record.session, savedAsDraft: true } },
              record.resourceVersion,
            ),
        );
        return result(
          context,
          { kind: 'outline-session-draft-saved', outlineSessionId: command.outlineSessionId },
          record.resourceVersion + 1,
        );
      }
      throw new Error('unsupported_course_authoring_command');
    },
    async query(query) {
      const record = await sessionRecord(query.outlineSessionId);
      const messages = await projectedConversation(record);
      const candidate =
        record.session.latestCandidateVersionId === undefined
          ? undefined
          : await options.authoring.candidateVersions.get(record.session.latestCandidateVersionId);
      const materials = [];
      for await (const material of options.authoring.materials.listBySession(
        query.outlineSessionId,
      )) {
        materials.push({
          artifactRef: material.artifactRef,
          originalFileName: material.originalFileName,
          format: material.format,
          importedAt: material.importedAt,
          sections: material.sections.map((section) => section.title),
          warnings: material.warnings,
        });
      }
      return {
        outlineSessionId: record.session.outlineSessionId,
        resourceVersion: record.resourceVersion,
        state: record.session.state,
        topic: record.session.topic,
        courseMode: record.session.courseMode,
        candidateVersionIds: record.session.candidateVersionIds,
        completedAssessmentRounds: record.session.completedAssessmentRounds,
        canGenerateCandidate: canGenerateCandidate(record),
        ...(record.session.savedAsDraft === true ? { savedAsDraft: true } : {}),
        messages,
        ...(record.session.activeCandidateTaskId === undefined
          ? {}
          : { generationTaskId: record.session.activeCandidateTaskId }),
        ...(record.session.latestCandidateVersionId === undefined
          ? {}
          : { candidateVersionId: record.session.latestCandidateVersionId }),
        ...(candidate === undefined
          ? {}
          : { candidateMarkdown: candidate.candidate.outlineMarkdown }),
        ...(record.session.confirmedCourseId === undefined
          ? {}
          : { confirmedCourseId: record.session.confirmedCourseId }),
        materials,
      } satisfies CourseAuthoringView;
    },
    async getCourse(courseId) {
      const course = await options.courses.courses.get(courseId);
      if (course === undefined) throw new ResourceNotFoundError();
      const outline = await options.courses.outlineVersions.get(course.outlineVersionId);
      if (outline === undefined) throw new ResourceNotFoundError();
      const lessons = [];
      for (const lesson of await Promise.all(
        course.lessonIds.map((lessonId) => options.courses.lessons.get(lessonId)),
      )) {
        if (lesson !== undefined) lessons.push(lesson);
      }
      const outlineVersions = [];
      for await (const version of options.courses.outlineVersions.listByCourse(courseId)) {
        outlineVersions.push({
          outlineVersionId: version.id,
          sourceCandidateVersionId: version.sourceCandidateVersionId,
          createdAt: version.createdAt,
          current: version.id === course.outlineVersionId,
        });
      }
      return {
        courseId: course.id,
        title: resolveCourseTitle(outline.outlineMarkdown, course.title),
        status: course.status,
        courseMode: course.courseMode,
        outlineVersionId: course.outlineVersionId,
        lessonIds: course.lessonIds,
        ...(course.recommendedLessonId === undefined
          ? {}
          : { recommendedLessonId: course.recommendedLessonId }),
        ...(course.nextLessonRecommendation === undefined
          ? {}
          : { nextLessonRecommendation: course.nextLessonRecommendation }),
        outlineMarkdown: outline.outlineMarkdown,
        lessons: lessons.map((lesson) => ({
          lessonId: lesson.id,
          outlineVersionId: lesson.outlineVersionId,
          title: lesson.title,
          objective: lesson.objective,
          coreKnowledgePoints: lesson.coreKnowledgePoints,
          prerequisiteLessonIds: lesson.prerequisiteLessonIds,
          estimatedMinutes: lesson.estimatedMinutes,
        })),
        outlineVersions: outlineVersions.sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt),
        ),
        resourceVersion: course.resourceVersion,
      };
    },
    async getOutlineVersion(courseId, outlineVersionId) {
      const [course, outline] = await Promise.all([
        options.courses.courses.get(courseId),
        options.courses.outlineVersions.get(outlineVersionId),
      ]);
      if (course === undefined || outline === undefined || outline.courseId !== courseId) {
        throw new ResourceNotFoundError();
      }
      return {
        courseId,
        outlineVersionId: outline.id,
        sourceCandidateVersionId: outline.sourceCandidateVersionId,
        outlineMarkdown: outline.outlineMarkdown,
        disciplineTag: outline.disciplineTag,
        topicTags: outline.topicTags,
        createdAt: outline.createdAt,
        resourceVersion: outline.resourceVersion,
        current: course.outlineVersionId === outline.id,
      };
    },
    async getLesson(lessonId) {
      const lesson = await options.courses.lessons.get(lessonId);
      if (lesson === undefined) throw new ResourceNotFoundError();
      const course = await options.courses.courses.get(lesson.courseId);
      if (course === undefined || !course.lessonIds.includes(lessonId)) {
        throw new ResourceNotFoundError();
      }
      return {
        lessonId: lesson.id,
        courseId: lesson.courseId,
        outlineVersionId: lesson.outlineVersionId,
        title: lesson.title,
        objective: lesson.objective,
        coreKnowledgePoints: lesson.coreKnowledgePoints,
        estimatedMinutes: lesson.estimatedMinutes,
      };
    },
  };
}
