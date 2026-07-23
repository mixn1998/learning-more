import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type { AuthoringContext, CompletedLessonOutlineContext } from '../ports/authoring-agent.js';
import { buildOutlineSemanticManifest } from './outline-semantic-manifest.js';

const MAX_MATERIAL_EXCERPT_CHARS = 12_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_MESSAGE_CHARS = 1_000;

function normalizeMessageContent(content: string): string {
  return content.replace(/\s+/gu, ' ').trim().slice(0, MAX_HISTORY_MESSAGE_CHARS);
}

function compactHistoricalDialogue(records: readonly AuthoringContext['messages'][]): string {
  const entries = records
    .flat()
    .filter((message) => message.status === 'complete')
    .map((message) => ({
      role: message.role,
      content: normalizeMessageContent(message.content),
      createdAt: message.createdAt,
    }))
    .filter((message) => message.content.length > 0)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const unique = entries.filter(
    (message, index) =>
      entries.findIndex(
        (candidate) => candidate.role === message.role && candidate.content === message.content,
      ) === index,
  );
  const selected =
    unique.length <= MAX_HISTORY_MESSAGES
      ? unique
      : [...unique.slice(0, 4), ...unique.slice(-(MAX_HISTORY_MESSAGES - 4))];
  return selected
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
    .join('\n');
}

export function createAuthoringContextAssembler(
  repositories: CourseAuthoringRepositories,
  options: Readonly<{
    listCompletedLessonOutlineContexts?: (
      courseId: string,
    ) => Promise<readonly CompletedLessonOutlineContext[]>;
  }> = {},
) {
  return async function assemble(outlineSessionId: string): Promise<AuthoringContext> {
    const record = await repositories.outlineSessions.get(outlineSessionId);
    if (record === undefined) throw new Error('OUTLINE_SESSION_NOT_FOUND');
    const materials: AuthoringContext['materials'][number][] = [];
    for await (const material of repositories.materials.listBySession(outlineSessionId)) {
      materials.push({
        sourceRef: material.artifactRef,
        title: material.originalFileName,
        excerpt: material.extractedText.slice(0, MAX_MATERIAL_EXCERPT_CHARS),
      });
    }
    const candidateVersionId = record.session.latestCandidateVersionId;
    const candidate =
      candidateVersionId === undefined
        ? undefined
        : await repositories.candidateVersions.get(candidateVersionId);
    const adjustmentCourseId = record.session.adjustmentCourseId;
    const historicalMessages: AuthoringContext['messages'][] = [];
    if (adjustmentCourseId !== undefined) {
      for (const historySessionId of record.session.historySessionIds ?? []) {
        const historical = await repositories.outlineSessions.get(historySessionId);
        if (historical !== undefined) historicalMessages.push(historical.messages);
      }
    }
    const completedLessons =
      adjustmentCourseId === undefined || options.listCompletedLessonOutlineContexts === undefined
        ? []
        : await options.listCompletedLessonOutlineContexts(adjustmentCourseId);
    return {
      outlineSessionId,
      phase: candidate === undefined ? 'assessment' : 'candidate-alignment',
      topic: record.session.topic,
      courseMode: record.session.courseMode,
      completedAssessmentRounds: record.session.completedAssessmentRounds,
      messages: record.messages,
      materials,
      ...(adjustmentCourseId === undefined
        ? {}
        : {
            pastVersionContext: {
              dialogueDigest: compactHistoricalDialogue(historicalMessages),
              completedLessons,
            },
          }),
      ...(record.session.pendingAlignment === undefined
        ? {}
        : { pendingAlignment: record.session.pendingAlignment }),
      ...(candidate === undefined
        ? {}
        : {
            candidate: {
              candidateVersionId: candidate.id,
              markdown: candidate.candidate.outlineMarkdown,
              outlineNodes: buildOutlineSemanticManifest(candidate.candidate.outlineMarkdown),
            },
          }),
    };
  };
}
