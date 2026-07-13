import type { AuthoringStreamEvent } from './course-authoring-client.js';
import { getPageInstanceId } from '../state/page-instance.js';
import { streamGenerationEvents } from './sse-client.js';

export interface LearningClient {
  start(lessonId: string): Promise<{
    lessonId: string;
    sessionId: string;
    resourceVersion: number;
    writable: boolean;
    leaseToken?: string;
  }>;
  getSession(sessionId: string): Promise<{
    resourceVersion: number;
    learning: {
      progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
      session?: { state: 'active' | 'paused' | 'frozen' | 'closed' };
    };
    finalReview?: { id: string; markdown?: string };
  }>;
  sendMessage(input: {
    sessionId: string;
    markdown: string;
    establishesEvidence: boolean;
    resourceVersion: number;
  }): Promise<{ taskId: string; resourceVersion: number }>;
  stream(taskId: string, onEvent: (event: AuthoringStreamEvent) => void): Promise<void>;
  stop(input: {
    sessionId: string;
    taskId: string;
    resourceVersion: number;
  }): Promise<{ taskId: string; draftArtifactRef: string; resourceVersion: number }>;
  pause(sessionId: string, resourceVersion: number): Promise<unknown>;
  resume(sessionId: string, resourceVersion: number): Promise<unknown>;
  transferLease(
    sessionId: string,
    resourceVersion: number,
  ): Promise<{
    resourceVersion: number;
    leaseToken: string;
  }>;
  abandon(lessonId: string, resourceVersion: number, sourceSnapshotHash: string): Promise<unknown>;
  restore(lessonId: string, resourceVersion: number): Promise<unknown>;
  closeLesson(lessonId: string, resourceVersion: number, body: unknown): Promise<unknown>;
  getClosure(transactionId: string): Promise<unknown>;
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
  ): Promise<{ state: string; artifactRef?: string; resourceVersion: number }>;
  getCourseReview(
    courseId: string,
  ): Promise<{ state: string; artifactRef?: string; resourceVersion: number } | undefined>;
}

function headers(resourceVersion?: number): HeadersInit {
  return {
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
    'x-page-instance-id': getPageInstanceId(),
    'x-csrf-token': 'development-csrf',
    ...(resourceVersion === undefined ? {} : { 'if-match': `"${resourceVersion}"` }),
  };
}

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  if (!response.ok) throw body;
  return body as Record<string, unknown>;
}

async function stream(taskId: string, onEvent: (event: AuthoringStreamEvent) => void) {
  await streamGenerationEvents({ taskId, onEvent });
}

export const learningClient: LearningClient = {
  start: (lessonId) =>
    request(`/api/v1/lessons/${encodeURIComponent(lessonId)}/sessions`, {
      method: 'POST',
      headers: headers(),
      body: '{}',
    }) as ReturnType<LearningClient['start']>,
  getSession: (sessionId) =>
    request(`/api/v1/lesson-sessions/${encodeURIComponent(sessionId)}`) as ReturnType<
      LearningClient['getSession']
    >,
  sendMessage: (input) =>
    request(`/api/v1/lesson-sessions/${encodeURIComponent(input.sessionId)}/messages`, {
      method: 'POST',
      headers: headers(input.resourceVersion),
      body: JSON.stringify({
        markdown: input.markdown,
        establishesEvidence: input.establishesEvidence,
      }),
    }) as ReturnType<LearningClient['sendMessage']>,
  stream,
  stop: (input) =>
    request(`/api/v1/lesson-sessions/${encodeURIComponent(input.sessionId)}/generation-stops`, {
      method: 'POST',
      headers: headers(input.resourceVersion),
      body: JSON.stringify({ taskId: input.taskId }),
    }) as ReturnType<LearningClient['stop']>,
  pause: (sessionId, version) =>
    request(`/api/v1/lesson-sessions/${encodeURIComponent(sessionId)}/pauses`, {
      method: 'POST',
      headers: headers(version),
      body: '{}',
    }),
  resume: (sessionId, version) =>
    request(`/api/v1/lesson-sessions/${encodeURIComponent(sessionId)}/resumptions`, {
      method: 'POST',
      headers: headers(version),
      body: '{}',
    }),
  transferLease: (sessionId, version) =>
    request(`/api/v1/lesson-sessions/${encodeURIComponent(sessionId)}/lease-transfers`, {
      method: 'POST',
      headers: headers(version),
      body: '{}',
    }) as ReturnType<LearningClient['transferLease']>,
  abandon: (lessonId, version, sourceSnapshotHash) =>
    request(`/api/v1/lessons/${encodeURIComponent(lessonId)}/abandonments`, {
      method: 'POST',
      headers: headers(version),
      body: JSON.stringify({ sourceSnapshotHash }),
    }),
  restore: (lessonId, version) =>
    request(`/api/v1/lessons/${encodeURIComponent(lessonId)}/restorations`, {
      method: 'POST',
      headers: headers(version),
      body: '{}',
    }),
  closeLesson: (lessonId, version, body) =>
    request(`/api/v1/lessons/${encodeURIComponent(lessonId)}/closures`, {
      method: 'POST',
      headers: headers(version),
      body: JSON.stringify(body),
    }),
  getClosure: (id) => request(`/api/v1/closure-transactions/${encodeURIComponent(id)}`),
  startSupplementary: (lessonId) =>
    request(`/api/v1/lessons/${encodeURIComponent(lessonId)}/supplementary-sessions`, {
      method: 'POST',
      headers: headers(),
      body: '{}',
    }) as ReturnType<LearningClient['startSupplementary']>,
  sendSupplementary: (sessionId, markdown, version) =>
    request(`/api/v1/supplementary-sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      headers: headers(version),
      body: JSON.stringify({ markdown }),
    }) as ReturnType<LearningClient['sendSupplementary']>,
  closeCourse: (courseId, version, confirmAbandoned) =>
    request(`/api/v1/courses/${encodeURIComponent(courseId)}/closures`, {
      method: 'POST',
      headers: headers(version),
      body: JSON.stringify({ confirmAbandoned }),
    }) as ReturnType<LearningClient['closeCourse']>,
  async getCourseReview(courseId) {
    const response = await fetch(`/api/v1/courses/${encodeURIComponent(courseId)}/review`);
    if (response.status === 404) return undefined;
    if (!response.ok) throw await response.json();
    return (await response.json()) as Awaited<ReturnType<LearningClient['getCourseReview']>>;
  },
};
