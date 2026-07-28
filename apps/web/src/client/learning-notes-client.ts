import {
  LearningNoteListResponseSchema,
  LearningNoteSchema,
  type LearningNoteView,
} from '@learning-more/contracts';

import { apiRequest, createCommandAttempt } from './api-client.js';

export type LearningNotesClient = Readonly<{
  list(filter?: Readonly<{ courseId?: string; lessonId?: string }>): Promise<LearningNoteView[]>;
  create(
    input: Readonly<{
      courseId: string;
      lessonId: string;
      title?: string | undefined;
      markdown: string;
    }>,
  ): Promise<LearningNoteView>;
  update(
    note: LearningNoteView,
    input: Readonly<{ title: string; markdown: string }>,
  ): Promise<LearningNoteView>;
  remove(note: LearningNoteView): Promise<void>;
}>;

export const learningNotesClient: LearningNotesClient = {
  async list(filter = {}) {
    const query = new URLSearchParams();
    if (filter.courseId !== undefined) query.set('courseId', filter.courseId);
    if (filter.lessonId !== undefined) query.set('lessonId', filter.lessonId);
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    return (
      await apiRequest(`/api/v1/learning-notes${suffix}`, {
        schema: LearningNoteListResponseSchema,
      })
    ).data.entries;
  },
  async create(input) {
    return (
      await apiRequest('/api/v1/learning-notes', {
        method: 'POST',
        body: input,
        command: createCommandAttempt(),
        schema: LearningNoteSchema,
      })
    ).data;
  },
  async update(note, input) {
    return (
      await apiRequest(`/api/v1/learning-notes/${encodeURIComponent(note.id)}`, {
        method: 'PATCH',
        body: input,
        command: createCommandAttempt(),
        resourceVersion: note.resourceVersion,
        schema: LearningNoteSchema,
      })
    ).data;
  },
  async remove(note) {
    await apiRequest(`/api/v1/learning-notes/${encodeURIComponent(note.id)}`, {
      method: 'DELETE',
      command: createCommandAttempt(),
      resourceVersion: note.resourceVersion,
      schema: { parse: () => undefined },
    });
  },
};
