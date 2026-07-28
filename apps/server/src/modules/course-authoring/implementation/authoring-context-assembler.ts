import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type { AuthoringContext, FrozenLessonOutlineContext } from '../ports/authoring-agent.js';
import { buildOutlineSemanticManifest } from './outline-semantic-manifest.js';
import { projectSemanticText } from './semantic-context-projection.js';

const MAX_MATERIAL_EXCERPT_CHARS = 12_000;
const MAX_HISTORICAL_DIALOGUE_CHARS = 1_800;

function normalizeMessageContent(content: string): string {
  return content.replace(/\s+/gu, ' ').trim();
}

function projectHistoricalDialogue(records: readonly AuthoringContext['messages'][]): string {
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
  const latestAssistantIndex = unique.findLastIndex((message) => message.role === 'assistant');
  const semanticProjection = unique.filter(
    (message, index) =>
      message.role === 'assistant' || latestAssistantIndex < 0 || index > latestAssistantIndex,
  );
  const rendered = semanticProjection
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`)
    .join('\n');
  return projectSemanticText(rendered, MAX_HISTORICAL_DIALOGUE_CHARS);
}

export function createAuthoringContextAssembler(
  repositories: CourseAuthoringRepositories,
  options: Readonly<{
    listFrozenLessonOutlineContexts?: (
      courseId: string,
    ) => Promise<readonly FrozenLessonOutlineContext[]>;
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
    const frozenLessons =
      adjustmentCourseId === undefined || options.listFrozenLessonOutlineContexts === undefined
        ? []
        : await options.listFrozenLessonOutlineContexts(adjustmentCourseId);
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
              dialogueDigest: projectHistoricalDialogue(historicalMessages),
              frozenLessons,
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
              createdAt: candidate.createdAt,
              markdown: candidate.candidate.outlineMarkdown,
              outlineNodes: buildOutlineSemanticManifest(candidate.candidate.outlineMarkdown),
            },
          }),
    };
  };
}
