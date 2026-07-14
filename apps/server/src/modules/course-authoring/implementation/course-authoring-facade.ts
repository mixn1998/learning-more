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
import { createOutlineSession, decide, evolveAll } from '../model/outline-session.js';
import type { CourseCreationRepositories } from '../ports/course-repositories.js';
import type { AuthoringAgent } from '../ports/authoring-agent.js';
import type {
  CandidateAlignmentPlan,
  CandidateAlignmentPlanner,
} from '../ports/candidate-alignment-planner.js';
import type { OutlineSessionRecord } from '../ports/outline-session-repository.js';
import type { OutlineSessionDraftStore } from '../ports/outline-session-draft-store.js';
import type { NextLessonRecommender } from '../../next-lesson/interface.js';
import { confirmCourse } from './confirm-course.js';
import { createAuthoringContextAssembler } from './authoring-context-assembler.js';
import { reviseCourseOutline } from './revise-course-outline.js';

export interface CandidateGenerationCoordinator {
  generate(input: { readonly commandId: string; readonly outlineSessionId: string }): Promise<{
    readonly taskId: string;
    readonly state: 'running' | 'failed_recoverable';
    readonly failureCode?: CandidateGenerationFailureCode;
    readonly resourceVersion: number;
    readonly draftArtifactRef?: string;
  }>;
}

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
  readonly outbox?: Outbox;
  readonly hasLearningEvidence?: (lessonId: string) => Promise<boolean>;
  readonly profileEvidenceSink?: Readonly<{
    capture(checkpoint: CourseAuthoringEvidenceCheckpoint): void;
  }>;
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
}): CourseAuthoring {
  const assembleAuthoringContext = createAuthoringContextAssembler(options.authoring);

  async function sessionRecord(outlineSessionId: string) {
    const record = await options.authoring.outlineSessions.get(outlineSessionId);
    if (record === undefined) throw new ResourceNotFoundError();
    return record;
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
  }): Promise<{ record: OutlineSessionRecord; plan: CandidateAlignmentPlan }> {
    try {
      const context = await assembleAuthoringContext(input.record.session.outlineSessionId);
      const [plan, content] = await Promise.all([
        options.candidateAlignmentPlanner.plan(context),
        options.authoringAgent.respond(context),
      ]);
      const assistantMessageId = options.nextId('message');
      const session = evolveAll(
        input.record.session,
        decide(input.record.session, {
          type: 'completeAlignmentTurn',
          userMessageId: input.userMessageId,
          assistantMessageId,
          action: plan.action,
          targetModuleIds: plan.targetModuleIds,
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
            content: content.trim(),
            status: 'complete',
            createdAt: options.now().toISOString(),
            inReplyToMessageId: input.userMessageId,
            alignmentAction: plan.action,
            targetModuleIds: plan.targetModuleIds,
          },
        ],
      };
      await options.unitOfWork.execute(
        { transactionId: `tx_authoring_alignment_complete_${input.commandId}` },
        (tx) => options.authoring.outlineSessions.save(tx, completed, input.record.resourceVersion),
      );
      return {
        record: { ...completed, resourceVersion: input.record.resourceVersion + 1 },
        plan,
      };
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
    async execute(command, context) {
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
          let resourceVersion = completed.record.resourceVersion;
          if (completed.plan.action !== 'clarify') {
            const generated = await options.candidateGeneration.generate({
              commandId: `${context.commandId}:alignment:${completed.plan.action}`,
              outlineSessionId: command.outlineSessionId,
            });
            resourceVersion = generated.resourceVersion;
          }
          const current = await sessionRecord(command.outlineSessionId);
          return result(
            context,
            {
              kind: 'message',
              outlineSessionId: command.outlineSessionId,
              state: current.session.state,
              completedAssessmentRounds: current.session.completedAssessmentRounds,
              canGenerateCandidate: canGenerateCandidate(current),
            },
            resourceVersion,
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
        const record = await sessionRecord(command.outlineSessionId);
        assertVersion(record.resourceVersion, context);
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
            hasLearningEvidence: options.hasLearningEvidence ?? (async () => false),
            ...(options.nextLessonRecommender === undefined
              ? {}
              : { nextLessonRecommender: options.nextLessonRecommender }),
            now: options.now,
          },
        );
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
        messages: record.messages,
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
        title: course.title,
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
      if ((await options.courses.courses.get(lesson.courseId)) === undefined) {
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
