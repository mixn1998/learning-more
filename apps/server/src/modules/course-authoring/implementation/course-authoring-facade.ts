import { createHash } from 'node:crypto';

import type { CommandContext, CommandResult } from '@learning-more/contracts';

import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type { Outbox } from '../../../persistence/outbox.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import type { UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CourseAuthoring, CourseAuthoringResult, CourseAuthoringView } from '../interface.js';
import { createOutlineSession, decide, evolveAll } from '../model/outline-session.js';
import type { CourseCreationRepositories } from '../ports/course-repositories.js';
import { confirmCourse } from './confirm-course.js';
import { reviseCourseOutline } from './revise-course-outline.js';

export interface CandidateGenerationCoordinator {
  generate(input: { readonly commandId: string; readonly outlineSessionId: string }): Promise<{
    readonly taskId: string;
    readonly state: 'running' | 'failed_recoverable';
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

function assessmentArtifactId(sessionId: string, content: string): string {
  return `assessment_${createHash('sha256')
    .update(`${sessionId}\0${content}`, 'utf8')
    .digest('hex')
    .slice(0, 32)}`;
}

function assertVersion(current: number, context: CommandContext): void {
  if (context.expectedVersion !== current) throw new RepositoryVersionConflictError(current);
}

export function createCourseAuthoringFacade(options: {
  readonly authoring: CourseAuthoringRepositories;
  readonly courses: CourseCreationRepositories;
  readonly unitOfWork: UnitOfWork;
  readonly candidateGeneration: CandidateGenerationCoordinator;
  readonly outbox?: Outbox;
  readonly assessmentStore?: { saveDraft(id: string, markdown: string): Promise<void> };
  readonly hasLearningEvidence?: (lessonId: string) => Promise<boolean>;
  readonly nextId: (kind: 'session' | 'course' | 'event' | 'outline' | 'adjustment') => string;
  readonly now: () => Date;
}): CourseAuthoring {
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

  return {
    async execute(command, context) {
      if (command.type === 'CreateOutlineSession') {
        const outlineSessionId = options.nextId('session');
        let session = createOutlineSession({
          outlineSessionId,
          topic: command.topic,
          courseMode: command.courseMode,
        });
        session = evolveAll(session, decide(session, { type: 'startAssessment' }));
        await options.unitOfWork.execute(
          { transactionId: `tx_create_outline_${context.commandId}` },
          (tx) =>
            options.authoring.outlineSessions.save(
              tx,
              { session, resourceVersion: 0, candidateCommandReceipts: {} },
              0,
            ),
        );
        return result(
          context,
          { kind: 'outline-session', outlineSessionId, state: session.state },
          1,
        );
      }

      if (command.type === 'AppendOutlineSessionMessage') {
        const record = await sessionRecord(command.outlineSessionId);
        assertVersion(record.resourceVersion, context);
        const artifactId = assessmentArtifactId(command.outlineSessionId, command.content);
        await options.assessmentStore?.saveDraft(artifactId, command.content);
        const session = evolveAll(
          record.session,
          decide(record.session, { type: 'completeAssessment', assessmentArtifactId: artifactId }),
        );
        await options.unitOfWork.execute(
          { transactionId: `tx_assessment_${context.commandId}` },
          (tx) =>
            options.authoring.outlineSessions.save(
              tx,
              { ...record, session },
              record.resourceVersion,
            ),
        );
        return result(
          context,
          { kind: 'message', outlineSessionId: command.outlineSessionId, state: session.state },
          record.resourceVersion + 1,
        );
      }

      if (command.type === 'RequestCandidateGeneration') {
        const record = await sessionRecord(command.outlineSessionId);
        assertVersion(record.resourceVersion, context);
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
            nextEventId: () => options.nextId('event'),
            now: options.now,
          },
        );
        const course = await options.courses.courses.get(confirmation.courseId);
        if (course === undefined) throw new ResourceNotFoundError();
        const updated = await sessionRecord(command.outlineSessionId);
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
            now: options.now,
          },
        );
        return result(
          context,
          { kind: 'revision', courseId: command.courseId, outlineVersionId },
          course.resourceVersion + 1,
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
      return {
        outlineSessionId: record.session.outlineSessionId,
        resourceVersion: record.resourceVersion,
        state: record.session.state,
        topic: record.session.topic,
        courseMode: record.session.courseMode,
        candidateVersionIds: record.session.candidateVersionIds,
        ...(record.session.latestCandidateVersionId === undefined
          ? {}
          : { candidateVersionId: record.session.latestCandidateVersionId }),
        ...(candidate === undefined
          ? {}
          : { candidateMarkdown: candidate.candidate.outlineMarkdown }),
        ...(record.session.confirmedCourseId === undefined
          ? {}
          : { confirmedCourseId: record.session.confirmedCourseId }),
      } satisfies CourseAuthoringView;
    },
  };
}
