import {
  LessonClosureResponseSchema,
  LessonRecordResponseSchema,
  SupplementarySessionResponseSchema,
  type LessonClosureView,
  type LessonRecordView as LessonRecord,
} from '@learning-more/contracts';

import { apiRequest, createCommandAttempt } from './api-client.js';

export type { LessonRecord };

export interface LessonRecordClient {
  getLessonRecord(lessonId: string): Promise<LessonRecord>;
  retryReview?(transactionId: string, resourceVersion: number): Promise<LessonClosureView>;
  startSupplementary?(lessonId: string): Promise<{ id: string; resourceVersion: number }>;
  sendSupplementary?(
    sessionId: string,
    markdown: string,
    resourceVersion: number,
  ): Promise<{ id: string; resourceVersion: number }>;
}

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
        schema: SupplementarySessionResponseSchema,
        command: createCommandAttempt(),
        resourceVersion,
      })
    ).data;
  },
};
