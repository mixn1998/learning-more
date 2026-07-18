import { afterEach, describe, expect, it, vi } from 'vitest';

import { learningClient } from './learning-client.js';

afterEach(() => vi.unstubAllGlobals());

describe('LearningClient SSE', () => {
  it('always bypasses the HTTP cache for authoritative lesson progress', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          lessonId: 'lesson_01',
          progress: 'completed',
          resourceVersion: 9,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await learningClient.getLessonState('lesson_01');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/lessons/lesson_01/learning-state',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('delivers a complete frame before the HTTP stream closes', async () => {
    const encoder = new TextEncoder();
    let releasedSecondFrame = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('id: 1\nevent: message.delta\ndata: {"markdown":"first"}\n\n'),
        );
        setTimeout(() => {
          releasedSecondFrame = true;
          controller.enqueue(
            encoder.encode('id: 2\nevent: task.completed\ndata: {"resultRef":"draft_01"}\n\n'),
          );
          controller.close();
        }, 20);
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const observations: Array<{ type: string; beforeSecondFrame: boolean }> = [];

    await learningClient.stream('task_01', (event) => {
      observations.push({ type: event.type, beforeSecondFrame: !releasedSecondFrame });
    });

    expect(observations).toEqual([
      { type: 'message.delta', beforeSecondFrame: true },
      { type: 'task.completed', beforeSecondFrame: false },
    ]);
  });

  it('reconnects after a transient proxy failure', async () => {
    const body = 'id: task_01:1\nevent: task.completed\ndata: {"resultRef":"draft_01"}\n\n';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 502 }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const events: string[] = [];

    await learningClient.stream('task_01', (event) => events.push(event.type));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['task.completed']);
  });
});
