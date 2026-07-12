import {
  ApplicationProblemSchema,
  ConfirmationResponseSchema,
  CreateOutlineSessionBodySchema,
  GenerationAcceptedResponseSchema,
  OutlineMessageResponseSchema,
  OutlineSessionResponseSchema,
  OutlineSessionViewResponseSchema,
  type CourseMode,
} from '@learning-more/contracts';

export type AuthoringStreamEvent = Readonly<{
  type: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type OutlineSessionView = Readonly<{
  outlineSessionId: string;
  resourceVersion: number;
  state: string;
  topic?: string | undefined;
  courseMode?: CourseMode | undefined;
  candidateVersionIds?: readonly string[] | undefined;
  candidateVersionId?: string | undefined;
  candidateMarkdown?: string | undefined;
  confirmedCourseId?: string | undefined;
}>;

export interface CourseAuthoringClient {
  createOutlineSession(input: {
    topic: string;
    courseMode: CourseMode;
    pageInstanceId: string;
  }): Promise<OutlineSessionView>;
  getOutlineSession(outlineSessionId: string): Promise<OutlineSessionView>;
  appendMessage(input: {
    outlineSessionId: string;
    content: string;
    resourceVersion: number;
    pageInstanceId: string;
  }): Promise<OutlineSessionView & { kind?: string }>;
  requestCandidateGeneration(input: {
    outlineSessionId: string;
    resourceVersion: number;
    pageInstanceId: string;
  }): Promise<{
    taskId: string;
    draftArtifactRef?: string;
    state: string;
    resourceVersion: number;
  }>;
  streamGeneration(
    taskId: string,
    handlers: { readonly onEvent: (event: AuthoringStreamEvent) => void },
    signal?: AbortSignal,
  ): Promise<void>;
  confirmCandidate(input: {
    outlineSessionId: string;
    candidateVersionId: string;
    resourceVersion: number;
    pageInstanceId: string;
  }): Promise<{ courseId: string; outlineVersionId?: string; resourceVersion: number }>;
}

function csrfToken(): string {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ??
    'development-csrf'
  );
}

function commandHeaders(pageInstanceId: string, resourceVersion?: number): HeadersInit {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
    'x-csrf-token': csrfToken(),
    'x-page-instance-id': pageInstanceId,
    ...(resourceVersion === undefined ? {} : { 'if-match': `"${resourceVersion}"` }),
  };
}

async function problemOr(response: Response): Promise<never> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = ApplicationProblemSchema.safeParse(body);
  if (parsed.success) throw parsed.data;
  throw new Error(`Unexpected HTTP ${response.status}`);
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) return problemOr(response);
  return response.json();
}

function responseVersion(response: Response, fallback?: number): number {
  const etag = response.headers.get('etag');
  const match = etag === null ? null : /^"(\d+)"$/.exec(etag);
  if (match !== null) return Number(match[1]);
  if (fallback !== undefined) return fallback;
  throw new Error('Missing ETag');
}

async function* sseEvents(response: Response): AsyncGenerator<AuthoringStreamEvent> {
  if (response.body === null) throw new Error('Missing SSE body');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = frame.split('\n');
      const type = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const dataLine = lines.find((line) => line.startsWith('data: '))?.slice(6);
      if (type !== undefined && dataLine !== undefined) {
        const data: unknown = JSON.parse(dataLine);
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          yield { type, data: data as Record<string, unknown> };
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export const courseAuthoringClient: CourseAuthoringClient = {
  async createOutlineSession(input) {
    const body = CreateOutlineSessionBodySchema.parse({
      topic: input.topic,
      courseMode: input.courseMode,
    });
    const response = await fetch('/api/v1/outline-sessions', {
      method: 'POST',
      headers: commandHeaders(input.pageInstanceId),
      body: JSON.stringify(body),
    });
    return OutlineSessionResponseSchema.parse(await json(response));
  },
  async getOutlineSession(outlineSessionId) {
    const response = await fetch(
      `/api/v1/outline-sessions/${encodeURIComponent(outlineSessionId)}`,
    );
    return OutlineSessionViewResponseSchema.parse(await json(response));
  },
  async appendMessage(input) {
    const response = await fetch(
      `/api/v1/outline-sessions/${encodeURIComponent(input.outlineSessionId)}/messages`,
      {
        method: 'POST',
        headers: commandHeaders(input.pageInstanceId, input.resourceVersion),
        body: JSON.stringify({ content: input.content }),
      },
    );
    const body = OutlineMessageResponseSchema.parse(await json(response));
    return { ...body, resourceVersion: responseVersion(response, body.resourceVersion) };
  },
  async requestCandidateGeneration(input) {
    const response = await fetch(
      `/api/v1/outline-sessions/${encodeURIComponent(input.outlineSessionId)}/candidate-generations`,
      {
        method: 'POST',
        headers: commandHeaders(input.pageInstanceId, input.resourceVersion),
        body: '{}',
      },
    );
    const parsed = GenerationAcceptedResponseSchema.parse(await json(response));
    return {
      taskId: parsed.taskId,
      state: parsed.state,
      resourceVersion: parsed.resourceVersion,
      ...(parsed.draftArtifactRef === undefined
        ? {}
        : { draftArtifactRef: parsed.draftArtifactRef }),
    };
  },
  async streamGeneration(taskId, handlers, signal) {
    const response = await fetch(`/api/v1/generation-tasks/${encodeURIComponent(taskId)}/events`, {
      headers: { accept: 'text/event-stream' },
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) return problemOr(response);
    for await (const event of sseEvents(response)) handlers.onEvent(event);
  },
  async confirmCandidate(input) {
    const response = await fetch(
      `/api/v1/outline-sessions/${encodeURIComponent(input.outlineSessionId)}/confirmations`,
      {
        method: 'POST',
        headers: commandHeaders(input.pageInstanceId, input.resourceVersion),
        body: JSON.stringify({ candidateVersionId: input.candidateVersionId }),
      },
    );
    const parsed = ConfirmationResponseSchema.parse(await json(response));
    return {
      courseId: parsed.courseId,
      resourceVersion: parsed.resourceVersion,
      ...(parsed.outlineVersionId === undefined
        ? {}
        : { outlineVersionId: parsed.outlineVersionId }),
    };
  },
};
