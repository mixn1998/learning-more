import {
  BeginLessonClosureBodySchema,
  CourseArchiveResponseSchema,
  CourseReviewResponseSchema,
  DeleteCourseArchiveResponseSchema,
  GenerationStoppedResponseSchema,
  GenerationTaskAcceptedResponseSchema,
  LearningSessionCommandResponseSchema,
  LearningSessionViewResponseSchema,
  LessonClosureResponseSchema,
  LessonEntryStateResponseSchema,
  LessonPreviewResponseSchema,
  LessonProgressCommandResponseSchema,
  LessonSessionStartedResponseSchema,
  SupplementarySessionResponseSchema,
  type CourseArchiveView,
  type CourseReviewView,
  type LearningSessionCommandView,
  type LearningSessionView,
  type LessonClosureView,
} from '@learning-more/contracts';

import type { AuthoringStreamEvent } from './course-authoring-client.js';
import { apiRequest, apiRequestOptional, createCommandAttempt } from './api-client.js';
import { streamGenerationEvents } from './sse-client.js';

export interface LearningClient {
  getLessonPreview(lessonId: string): Promise<{
    lessonId: string;
    courseId: string;
    outlineVersionId: string;
    title: string;
    objective: string;
    coreKnowledgePoints: readonly string[];
    estimatedMinutes: number;
  }>;
  getLessonState(lessonId: string): Promise<{
    lessonId: string;
    progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
    sessionId?: string | undefined;
    stageReviewMarkdown?: string | undefined;
    stageReviewStatus?: 'generating' | 'failed' | 'ready' | undefined;
    resourceVersion: number;
  }>;
  getCourse(courseId: string): Promise<CourseArchiveView>;
  deleteCourse(
    courseId: string,
    resourceVersion: number,
  ): Promise<{ courseId: string; deletedAt: string; portraitRefresh: 'updating' }>;
  start(lessonId: string): Promise<{
    lessonId: string;
    sessionId: string;
    resourceVersion: number;
    writable: boolean;
    leaseToken?: string | undefined;
  }>;
  openLesson(
    sessionId: string,
    resourceVersion: number,
  ): Promise<{
    taskId: string;
    resourceVersion: number;
  }>;
  getSession(sessionId: string): Promise<LearningSessionView>;
  sendMessage(input: {
    sessionId: string;
    markdown: string;
    resourceVersion: number;
  }): Promise<{ taskId: string; resourceVersion: number }>;
  stream(taskId: string, onEvent: (event: AuthoringStreamEvent) => void): Promise<void>;
  stop(input: {
    sessionId: string;
    taskId: string;
    resourceVersion: number;
  }): Promise<{ taskId: string; draftArtifactRef: string; resourceVersion: number }>;
  pause(sessionId: string, resourceVersion: number): Promise<LearningSessionCommandView>;
  resume(sessionId: string, resourceVersion: number): Promise<LearningSessionCommandView>;
  transferLease(sessionId: string, resourceVersion: number): Promise<LearningSessionCommandView>;
  abandon(
    lessonId: string,
    resourceVersion: number,
    sourceSnapshotHash: string,
  ): Promise<{
    progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
    resourceVersion: number;
    reviewStatus?: 'generating' | 'failed' | 'ready' | undefined;
  }>;
  restore(
    lessonId: string,
    resourceVersion: number,
  ): Promise<{
    progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
    resourceVersion: number;
  }>;
  closeLesson(lessonId: string, resourceVersion: number, body: unknown): Promise<LessonClosureView>;
  getClosure(transactionId: string): Promise<LessonClosureView>;
  retryClosure(transactionId: string, resourceVersion: number): Promise<LessonClosureView>;
  startSupplementary(lessonId: string): Promise<{
    id: string;
    resourceVersion: number;
  }>;
  sendSupplementary(
    sessionId: string,
    markdown: string,
    resourceVersion: number,
  ): Promise<{ id: string; resourceVersion: number }>;
  closeCourse(
    courseId: string,
    resourceVersion: number,
    confirmAbandoned: boolean,
  ): Promise<CourseReviewView>;
  getCourseReview(courseId: string): Promise<CourseReviewView | undefined>;
}

async function commandRequest<T>(
  url: string,
  options: {
    body: unknown;
    schema: Readonly<{ parse(value: unknown): T }>;
    resourceVersion?: number;
  },
): Promise<T> {
  return (
    await apiRequest(url, {
      method: 'POST',
      body: options.body,
      schema: options.schema,
      command: createCommandAttempt(),
      ...(options.resourceVersion === undefined
        ? {}
        : { resourceVersion: options.resourceVersion }),
    })
  ).data;
}

export const learningClient: LearningClient = {
  async getLessonPreview(lessonId) {
    return (
      await apiRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}`, {
        schema: LessonPreviewResponseSchema,
      })
    ).data;
  },
  async getLessonState(lessonId) {
    return (
      await apiRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}/learning-state`, {
        schema: LessonEntryStateResponseSchema,
      })
    ).data;
  },
  async getCourse(courseId) {
    return (
      await apiRequest(`/api/v1/courses/${encodeURIComponent(courseId)}`, {
        schema: CourseArchiveResponseSchema,
      })
    ).data;
  },
  async deleteCourse(courseId, resourceVersion) {
    return (
      await apiRequest(`/api/v1/courses/${encodeURIComponent(courseId)}`, {
        method: 'DELETE',
        schema: DeleteCourseArchiveResponseSchema,
        command: createCommandAttempt(),
        resourceVersion,
      })
    ).data;
  },
  start: (lessonId) =>
    commandRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}/sessions`, {
      body: {},
      schema: LessonSessionStartedResponseSchema,
    }),
  openLesson: (sessionId, resourceVersion) =>
    commandRequest(`/api/v1/lesson-sessions/${encodeURIComponent(sessionId)}/opening`, {
      body: {},
      schema: GenerationTaskAcceptedResponseSchema,
      resourceVersion,
    }),
  async getSession(sessionId) {
    return (
      await apiRequest(`/api/v1/lesson-sessions/${encodeURIComponent(sessionId)}`, {
        schema: LearningSessionViewResponseSchema,
      })
    ).data;
  },
  sendMessage: (input) =>
    commandRequest(`/api/v1/lesson-sessions/${encodeURIComponent(input.sessionId)}/messages`, {
      body: { markdown: input.markdown },
      schema: GenerationTaskAcceptedResponseSchema,
      resourceVersion: input.resourceVersion,
    }),
  async stream(taskId, onEvent) {
    await streamGenerationEvents({ taskId, onEvent });
  },
  stop: (input) =>
    commandRequest(
      `/api/v1/lesson-sessions/${encodeURIComponent(input.sessionId)}/generation-stops`,
      {
        body: { taskId: input.taskId },
        schema: GenerationStoppedResponseSchema,
        resourceVersion: input.resourceVersion,
      },
    ),
  pause: (sessionId, resourceVersion) =>
    commandRequest(`/api/v1/lesson-sessions/${encodeURIComponent(sessionId)}/pauses`, {
      body: {},
      schema: LearningSessionCommandResponseSchema,
      resourceVersion,
    }),
  resume: (sessionId, resourceVersion) =>
    commandRequest(`/api/v1/lesson-sessions/${encodeURIComponent(sessionId)}/resumptions`, {
      body: {},
      schema: LearningSessionCommandResponseSchema,
      resourceVersion,
    }),
  transferLease: (sessionId, resourceVersion) =>
    commandRequest(`/api/v1/lesson-sessions/${encodeURIComponent(sessionId)}/lease-transfers`, {
      body: {},
      schema: LearningSessionCommandResponseSchema,
      resourceVersion,
    }),
  abandon: (lessonId, resourceVersion, sourceSnapshotHash) =>
    commandRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}/abandonments`, {
      body: { sourceSnapshotHash },
      schema: LessonProgressCommandResponseSchema,
      resourceVersion,
    }),
  restore: (lessonId, resourceVersion) =>
    commandRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}/restorations`, {
      body: {},
      schema: LessonProgressCommandResponseSchema,
      resourceVersion,
    }),
  closeLesson: (lessonId, resourceVersion, input) =>
    commandRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}/closures`, {
      body: BeginLessonClosureBodySchema.parse(input),
      schema: LessonClosureResponseSchema,
      resourceVersion,
    }),
  async getClosure(transactionId) {
    return (
      await apiRequest(`/api/v1/closure-transactions/${encodeURIComponent(transactionId)}`, {
        schema: LessonClosureResponseSchema,
      })
    ).data;
  },
  retryClosure: (transactionId, resourceVersion) =>
    commandRequest(`/api/v1/closure-transactions/${encodeURIComponent(transactionId)}/retries`, {
      body: {},
      schema: LessonClosureResponseSchema,
      resourceVersion,
    }),
  startSupplementary: (lessonId) =>
    commandRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}/supplementary-sessions`, {
      body: {},
      schema: SupplementarySessionResponseSchema,
    }),
  sendSupplementary: (sessionId, markdown, resourceVersion) =>
    commandRequest(`/api/v1/supplementary-sessions/${encodeURIComponent(sessionId)}/messages`, {
      body: { markdown },
      schema: SupplementarySessionResponseSchema,
      resourceVersion,
    }),
  closeCourse: (courseId, resourceVersion, confirmAbandoned) =>
    commandRequest(`/api/v1/courses/${encodeURIComponent(courseId)}/closures`, {
      body: { confirmAbandoned },
      schema: CourseReviewResponseSchema,
      resourceVersion,
    }),
  async getCourseReview(courseId) {
    return (
      await apiRequestOptional(`/api/v1/courses/${encodeURIComponent(courseId)}/review`, {
        schema: CourseReviewResponseSchema,
      })
    ).data;
  },
};
