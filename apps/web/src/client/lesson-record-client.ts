import {
  LessonClosureResponseSchema,
  GenerationTaskAcceptedResponseSchema,
  LessonRecordResponseSchema,
  SupplementarySessionResponseSchema,
  type LessonClosureView,
  type LessonRecordView as LessonRecord,
} from '@learning-more/contracts';

import { apiRequest, createCommandAttempt } from './api-client.js';
import { streamGenerationEvents, type GenerationSseEvent } from './sse-client.js';

export type { LessonRecord };

export interface LessonRecordClient {
  getLessonRecord(lessonId: string): Promise<LessonRecord>;
  retryReview?(transactionId: string, resourceVersion: number): Promise<LessonClosureView>;
  startSupplementary?(lessonId: string): Promise<SupplementarySessionView>;
  getSupplementary?(sessionId: string): Promise<SupplementarySessionView>;
  sendSupplementary?(
    sessionId: string,
    markdown: string,
    resourceVersion: number,
  ): Promise<{ taskId: string; resourceVersion: number }>;
  reviseSupplementary?(
    sessionId: string,
    messageId: string,
    markdown: string,
    resourceVersion: number,
  ): Promise<{ taskId: string; resourceVersion: number }>;
  retrySupplementary?(
    sessionId: string,
    resourceVersion: number,
  ): Promise<{ taskId: string; resourceVersion: number }>;
  stopSupplementary?(
    sessionId: string,
    taskId: string,
    resourceVersion: number,
  ): Promise<SupplementarySessionView>;
  archiveSupplementary?(
    sessionId: string,
    resourceVersion: number,
  ): Promise<SupplementarySessionView>;
  renameSupplementary?(
    sessionId: string,
    title: string,
    resourceVersion: number,
  ): Promise<SupplementarySessionView>;
  streamSupplementary?(taskId: string, onEvent: (event: GenerationSseEvent) => void): Promise<void>;
}

export type SupplementarySessionView = ReturnType<typeof SupplementarySessionResponseSchema.parse>;

export const lessonRecordClient: LessonRecordClient = {
  async getLessonRecord(lessonId) {
    return (
      await apiRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}/record`, {
        schema: LessonRecordResponseSchema,
      })
    ).data;
  },
  async retryReview(transactionId, resourceVersion) {
    return (
      await apiRequest(
        `/api/v1/closure-transactions/${encodeURIComponent(transactionId)}/retries`,
        {
          method: 'POST',
          body: {},
          schema: LessonClosureResponseSchema,
          command: createCommandAttempt(),
          resourceVersion,
        },
      )
    ).data;
  },
  async startSupplementary(lessonId) {
    return (
      await apiRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}/supplementary-sessions`, {
        method: 'POST',
        body: {},
        schema: SupplementarySessionResponseSchema,
        command: createCommandAttempt(),
      })
    ).data;
  },
  async sendSupplementary(sessionId, markdown, resourceVersion) {
    return (
      await apiRequest(`/api/v1/supplementary-sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: 'POST',
        body: { markdown },
        schema: GenerationTaskAcceptedResponseSchema,
        command: createCommandAttempt(),
        resourceVersion,
      })
    ).data;
  },
  async getSupplementary(sessionId) {
    return (
      await apiRequest(`/api/v1/supplementary-sessions/${encodeURIComponent(sessionId)}`, {
        schema: SupplementarySessionResponseSchema,
        cache: 'no-store',
      })
    ).data;
  },
  async reviseSupplementary(sessionId, messageId, markdown, resourceVersion) {
    return (
      await apiRequest(
        `/api/v1/supplementary-sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/revisions`,
        {
          method: 'POST',
          body: { markdown },
          schema: GenerationTaskAcceptedResponseSchema,
          command: createCommandAttempt(),
          resourceVersion,
        },
      )
    ).data;
  },
  async retrySupplementary(sessionId, resourceVersion) {
    return (
      await apiRequest(
        `/api/v1/supplementary-sessions/${encodeURIComponent(sessionId)}/generation-retries`,
        {
          method: 'POST',
          body: {},
          schema: GenerationTaskAcceptedResponseSchema,
          command: createCommandAttempt(),
          resourceVersion,
        },
      )
    ).data;
  },
  async stopSupplementary(sessionId, taskId, resourceVersion) {
    return (
      await apiRequest(
        `/api/v1/supplementary-sessions/${encodeURIComponent(sessionId)}/generation-stops`,
        {
          method: 'POST',
          body: { taskId },
          schema: SupplementarySessionResponseSchema,
          command: createCommandAttempt(),
          resourceVersion,
        },
      )
    ).data;
  },
  async archiveSupplementary(sessionId, resourceVersion) {
    return (
      await apiRequest(`/api/v1/supplementary-sessions/${encodeURIComponent(sessionId)}/archives`, {
        method: 'POST',
        body: {},
        schema: SupplementarySessionResponseSchema,
        command: createCommandAttempt(),
        resourceVersion,
      })
    ).data;
  },
  async renameSupplementary(sessionId, title, resourceVersion) {
    return (
      await apiRequest(`/api/v1/supplementary-sessions/${encodeURIComponent(sessionId)}/title`, {
        method: 'PATCH',
        body: { title },
        schema: SupplementarySessionResponseSchema,
        command: createCommandAttempt(),
        resourceVersion,
      })
    ).data;
  },
  streamSupplementary: (taskId, onEvent) => streamGenerationEvents({ taskId, onEvent }),
};
