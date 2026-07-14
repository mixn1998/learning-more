import {
  ConfirmationResponseSchema,
  CourseArchiveResponseSchema,
  CourseOutlineVersionResponseSchema,
  CreateOutlineSessionBodySchema,
  DeleteOutlineSessionResponseSchema,
  SaveOutlineSessionDraftResponseSchema,
  GenerationAcceptedResponseSchema,
  OutlineRevisionResponseSchema,
  OutlineMessageResponseSchema,
  OutlineMaterialResponseSchema,
  OutlineSessionResponseSchema,
  OutlineSessionViewResponseSchema,
  type CourseMode,
  type CandidateGenerationFailureCode,
  type CourseArchiveView,
  type CourseOutlineVersionView,
  type OutlineMaterialView,
} from '@learning-more/contracts';
import { apiRequest, type CommandAttempt } from './api-client.js';
import { streamGenerationEvents } from './sse-client.js';

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
  completedAssessmentRounds?: number | undefined;
  canGenerateCandidate?: boolean | undefined;
  savedAsDraft?: boolean | undefined;
  messages?:
    | readonly Readonly<{
        messageId: string;
        role: 'user' | 'assistant';
        content: string;
        status: 'complete' | 'failed';
        createdAt: string;
        inReplyToMessageId?: string | undefined;
      }>[]
    | undefined;
  candidateVersionIds?: readonly string[] | undefined;
  candidateVersionId?: string | undefined;
  candidateMarkdown?: string | undefined;
  confirmedCourseId?: string | undefined;
  materials?:
    | readonly Readonly<{
        artifactRef: string;
        originalFileName: string;
        format: 'markdown' | 'text' | 'pdf';
        importedAt: string;
        sections: readonly string[];
        warnings: readonly string[];
      }>[]
    | undefined;
}>;

export interface CourseAuthoringClient {
  createOutlineSession(input: {
    topic: string;
    courseMode: CourseMode;
    pageInstanceId: string;
  }): Promise<OutlineSessionView>;
  getOutlineSession(outlineSessionId: string): Promise<OutlineSessionView>;
  deleteOutlineSession(input: {
    outlineSessionId: string;
    resourceVersion: number;
    pageInstanceId: string;
  }): Promise<{ outlineSessionId: string; deletedAt: string }>;
  saveOutlineSessionDraft(input: {
    outlineSessionId: string;
    resourceVersion: number;
    pageInstanceId: string;
  }): Promise<{ outlineSessionId: string; resourceVersion: number }>;
  appendMessage(input: {
    outlineSessionId: string;
    content: string;
    resourceVersion: number;
    pageInstanceId: string;
  }): Promise<{
    outlineSessionId: string;
    state: string;
    resourceVersion: number;
    completedAssessmentRounds?: number;
    canGenerateCandidate?: boolean;
  }>;
  requestCandidateGeneration(input: {
    outlineSessionId: string;
    resourceVersion: number;
    pageInstanceId: string;
  }): Promise<{
    taskId: string;
    draftArtifactRef?: string;
    state: string;
    failureCode?: CandidateGenerationFailureCode;
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
  getCourse(courseId: string): Promise<CourseArchiveView>;
  reviseOutline(input: {
    courseId: string;
    sourceCandidateVersionId: string;
    resourceVersion: number;
    pageInstanceId: string;
  }): Promise<{ courseId: string; outlineVersionId: string; resourceVersion: number }>;
  getOutlineVersion(courseId: string, outlineVersionId: string): Promise<CourseOutlineVersionView>;
  uploadMaterial(input: {
    outlineSessionId: string;
    file: File;
    resourceVersion: number;
    pageInstanceId: string;
  }): Promise<OutlineMaterialView>;
}

function command(pageInstanceId: string): CommandAttempt {
  return { pageInstanceId, idempotencyKey: crypto.randomUUID() };
}

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export const courseAuthoringClient: CourseAuthoringClient = {
  async createOutlineSession(input) {
    const body = CreateOutlineSessionBodySchema.parse({
      topic: input.topic,
      courseMode: input.courseMode,
    });
    return (
      await apiRequest('/api/v1/outline-sessions', {
        method: 'POST',
        body,
        schema: OutlineSessionResponseSchema,
        command: command(input.pageInstanceId),
      })
    ).data;
  },
  async getOutlineSession(outlineSessionId) {
    return (
      await apiRequest(`/api/v1/outline-sessions/${encodeURIComponent(outlineSessionId)}`, {
        schema: OutlineSessionViewResponseSchema,
      })
    ).data;
  },
  async deleteOutlineSession(input) {
    return (
      await apiRequest(`/api/v1/outline-sessions/${encodeURIComponent(input.outlineSessionId)}`, {
        method: 'DELETE',
        schema: DeleteOutlineSessionResponseSchema,
        command: command(input.pageInstanceId),
        resourceVersion: input.resourceVersion,
      })
    ).data;
  },
  async saveOutlineSessionDraft(input) {
    return (
      await apiRequest(
        `/api/v1/outline-sessions/${encodeURIComponent(input.outlineSessionId)}/draft-saves`,
        {
          method: 'POST',
          body: {},
          schema: SaveOutlineSessionDraftResponseSchema,
          command: command(input.pageInstanceId),
          resourceVersion: input.resourceVersion,
        },
      )
    ).data;
  },
  async appendMessage(input) {
    return (
      await apiRequest(
        `/api/v1/outline-sessions/${encodeURIComponent(input.outlineSessionId)}/messages`,
        {
          method: 'POST',
          body: { content: input.content },
          schema: OutlineMessageResponseSchema,
          command: command(input.pageInstanceId),
          resourceVersion: input.resourceVersion,
        },
      )
    ).data;
  },
  async requestCandidateGeneration(input) {
    const parsed = (
      await apiRequest(
        `/api/v1/outline-sessions/${encodeURIComponent(input.outlineSessionId)}/candidate-generations`,
        {
          method: 'POST',
          body: {},
          schema: GenerationAcceptedResponseSchema,
          command: command(input.pageInstanceId),
          resourceVersion: input.resourceVersion,
        },
      )
    ).data;
    return {
      taskId: parsed.taskId,
      state: parsed.state,
      resourceVersion: parsed.resourceVersion,
      ...(parsed.failureCode === undefined ? {} : { failureCode: parsed.failureCode }),
      ...(parsed.draftArtifactRef === undefined
        ? {}
        : { draftArtifactRef: parsed.draftArtifactRef }),
    };
  },
  async streamGeneration(taskId, handlers, signal) {
    await streamGenerationEvents({
      taskId,
      onEvent: handlers.onEvent,
      ...(signal === undefined ? {} : { signal }),
    });
  },
  async confirmCandidate(input) {
    const parsed = (
      await apiRequest(
        `/api/v1/outline-sessions/${encodeURIComponent(input.outlineSessionId)}/confirmations`,
        {
          method: 'POST',
          body: { candidateVersionId: input.candidateVersionId },
          schema: ConfirmationResponseSchema,
          command: command(input.pageInstanceId),
          resourceVersion: input.resourceVersion,
        },
      )
    ).data;
    return {
      courseId: parsed.courseId,
      resourceVersion: parsed.resourceVersion,
      ...(parsed.outlineVersionId === undefined
        ? {}
        : { outlineVersionId: parsed.outlineVersionId }),
    };
  },
  async getCourse(courseId) {
    return (
      await apiRequest(`/api/v1/courses/${encodeURIComponent(courseId)}`, {
        schema: CourseArchiveResponseSchema,
      })
    ).data;
  },
  async reviseOutline(input) {
    return (
      await apiRequest(`/api/v1/courses/${encodeURIComponent(input.courseId)}/outline-revisions`, {
        method: 'POST',
        body: { sourceCandidateVersionId: input.sourceCandidateVersionId },
        schema: OutlineRevisionResponseSchema,
        command: command(input.pageInstanceId),
        resourceVersion: input.resourceVersion,
      })
    ).data;
  },
  async getOutlineVersion(courseId, outlineVersionId) {
    return (
      await apiRequest(
        `/api/v1/courses/${encodeURIComponent(courseId)}/outline-versions/${encodeURIComponent(outlineVersionId)}`,
        { schema: CourseOutlineVersionResponseSchema },
      )
    ).data;
  },
  async uploadMaterial(input) {
    return (
      await apiRequest(
        `/api/v1/outline-sessions/${encodeURIComponent(input.outlineSessionId)}/materials`,
        {
          method: 'POST',
          body: {
            fileName: input.file.name,
            mediaType: input.file.type,
            contentBase64: await fileBase64(input.file),
          },
          schema: OutlineMaterialResponseSchema,
          command: command(input.pageInstanceId),
          resourceVersion: input.resourceVersion,
        },
      )
    ).data;
  },
};
