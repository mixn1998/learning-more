import { describe, expect, it, vi } from 'vitest';

import { streamGenerationEvents } from './sse-client.js';

function sse(frames: readonly string[]): Response {
  return new Response(frames.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('typed SSE client', () => {
  it('resumes with Last-Event-ID and surfaces reset snapshots before terminal events', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          'id: task_01:4\nevent: task.snapshot\ndata: {"state":"running","lastSequence":4}\n\n',
        ]),
      )
      .mockResolvedValueOnce(
        sse(['id: task_01:5\nevent: task.completed\ndata: {"artifactRef":"draft_01"}\n\n']),
      );
    const events: string[] = [];
    const resets = vi.fn();
    await streamGenerationEvents({
      taskId: 'task_01',
      fetcher,
      onEvent: (event) => events.push(event.type),
      onReset: resets,
      retryDelayMs: 0,
    });
    expect(events).toEqual(['task.snapshot', 'task.completed']);
    expect(resets).toHaveBeenCalledWith({ state: 'running', lastSequence: 4 });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/v1/generation-tasks/task_01/events',
      expect.objectContaining({
        headers: { accept: 'text/event-stream', 'last-event-id': 'task_01:4' },
      }),
    );
  });
});
