import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { LearningNoteView } from '@learning-more/contracts';

import { registerLearningNoteRoutes } from './learning-notes.js';

const savedNote: LearningNoteView = {
  id: 'note_01',
  title: '单侧极限',
  markdown: '双侧极限要求左右结果一致。',
  discipline: '数学',
  courseId: 'course_01',
  courseTitle: '微积分',
  lessonId: 'lesson_01',
  lessonTitle: '单侧极限',
  createdAt: '2026-07-28T08:00:00.000Z',
  updatedAt: '2026-07-28T08:00:00.000Z',
  resourceVersion: 1,
};

describe('learning note routes', () => {
  it('lists and creates metadata-snapshotted notes', async () => {
    const list = vi.fn().mockResolvedValue([savedNote]);
    const create = vi.fn().mockResolvedValue(savedNote);
    const app = Fastify();
    await registerLearningNoteRoutes(app, {
      service: { list, create, update: vi.fn(), remove: vi.fn() },
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/learning-notes?courseId=course_01&lessonId=lesson_01',
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ entries: [savedNote] });
    expect(list).toHaveBeenCalledWith({ courseId: 'course_01', lessonId: 'lesson_01' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/learning-notes',
      payload: {
        courseId: 'course_01',
        lessonId: 'lesson_01',
        markdown: savedNote.markdown,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    expect(created.headers.location).toBe('/api/v1/learning-notes/note_01');
  });

  it('requires each note resource version for editing and deletion', async () => {
    const update = vi
      .fn()
      .mockResolvedValue({ ...savedNote, markdown: '修订', resourceVersion: 2 });
    const remove = vi.fn().mockResolvedValue(undefined);
    const app = Fastify();
    await registerLearningNoteRoutes(app, {
      service: { list: vi.fn(), create: vi.fn(), update, remove },
    });

    const missingVersion = await app.inject({
      method: 'PATCH',
      url: '/api/v1/learning-notes/note_01',
      payload: { title: '单侧极限', markdown: '修订' },
    });
    expect(missingVersion.statusCode).toBe(428);

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/learning-notes/note_01',
      headers: { 'if-match': '"1"' },
      payload: { title: '单侧极限的判断', markdown: '修订' },
    });
    expect(updated.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      'note_01',
      { title: '单侧极限的判断', markdown: '修订' },
      1,
    );

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/learning-notes/note_01',
      headers: { 'if-match': '"2"' },
    });
    expect(deleted.statusCode).toBe(204);
    expect(remove).toHaveBeenCalledWith('note_01', 2);
  });
});
