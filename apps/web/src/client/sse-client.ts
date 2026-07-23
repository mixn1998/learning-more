export type GenerationSseEvent = Readonly<{
  id?: string;
  type: string;
  data: Readonly<Record<string, unknown>>;
}>;

function terminal(event: GenerationSseEvent): boolean {
  if (['task.completed', 'task.failed', 'task.cancelled'].includes(event.type)) return true;
  return (
    event.type === 'task.snapshot' &&
    typeof event.data.state === 'string' &&
    event.data.state !== 'running' &&
    event.data.state !== 'queued'
  );
}

async function* readFrames(response: Response): AsyncGenerator<GenerationSseEvent> {
  if (response.body === null) throw new Error('generation_stream_unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (frame: string): GenerationSseEvent | undefined => {
    const lines = frame.split('\n');
    const id = lines.find((line) => line.startsWith('id: '))?.slice(4);
    const type = lines.find((line) => line.startsWith('event: '))?.slice(7);
    const dataLine = lines.find((line) => line.startsWith('data: '))?.slice(6);
    if (type === undefined || dataLine === undefined) return undefined;
    const data: unknown = JSON.parse(dataLine);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
    return { ...(id === undefined ? {} : { id }), type, data: data as Record<string, unknown> };
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const event = parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (event !== undefined) yield event;
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
}

export async function streamGenerationEvents(
  options: Readonly<{
    taskId: string;
    onEvent(event: GenerationSseEvent): void;
    onReset?(snapshot: Readonly<Record<string, unknown>>): void;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    retryDelayMs?: number;
    maxFailures?: number;
  }>,
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  let lastEventId: string | undefined;
  let failures = 0;
  while (!options.signal?.aborted) {
    try {
      const response = await fetcher(
        `/api/v1/generation-tasks/${encodeURIComponent(options.taskId)}/events`,
        {
          headers: {
            accept: 'text/event-stream',
            ...(lastEventId === undefined ? {} : { 'last-event-id': lastEventId }),
          },
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
      if (!response.ok) throw new Error('generation_stream_unavailable');
      failures = 0;
      for await (const event of readFrames(response)) {
        if (event.id !== undefined) lastEventId = event.id;
        options.onEvent(event);
        if (event.type === 'task.snapshot') options.onReset?.(event.data);
        if (terminal(event)) return;
      }
    } catch (error) {
      if (options.signal?.aborted) return;
      failures += 1;
      if (failures >= (options.maxFailures ?? 20)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 50));
  }
}
