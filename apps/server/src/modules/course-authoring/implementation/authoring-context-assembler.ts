import type { CourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import type { AuthoringContext } from '../ports/authoring-agent.js';

const MAX_MATERIAL_EXCERPT_CHARS = 12_000;

export function createAuthoringContextAssembler(repositories: CourseAuthoringRepositories) {
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
    return {
      outlineSessionId,
      phase: candidate === undefined ? 'assessment' : 'candidate-alignment',
      topic: record.session.topic,
      courseMode: record.session.courseMode,
      completedAssessmentRounds: record.session.completedAssessmentRounds,
      messages: record.messages,
      materials,
      ...(record.session.pendingAlignment === undefined
        ? {}
        : { pendingAlignment: record.session.pendingAlignment }),
      ...(candidate === undefined
        ? {}
        : {
            candidate: {
              candidateVersionId: candidate.id,
              markdown: candidate.candidate.outlineMarkdown,
            },
          }),
    };
  };
}
