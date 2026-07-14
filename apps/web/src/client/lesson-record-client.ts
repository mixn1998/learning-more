import {
  LessonRecordResponseSchema,
  type LessonRecordView as LessonRecord,
} from '@learning-more/contracts';

import { apiRequest } from './api-client.js';

export type { LessonRecord };

export interface LessonRecordClient {
  getLessonRecord(lessonId: string): Promise<LessonRecord>;
}

export const lessonRecordClient: LessonRecordClient = {
  async getLessonRecord(lessonId) {
    return (
      await apiRequest(`/api/v1/lessons/${encodeURIComponent(lessonId)}/record`, {
        schema: LessonRecordResponseSchema,
      })
    ).data;
  },
};
