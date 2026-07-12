export function buildCandidatePromptInput(input: {
  readonly outlineSessionId: string;
  readonly courseMode: string;
  readonly topic: string;
  readonly assessmentArtifactId?: string;
  readonly materialArtifactRefs?: readonly string[];
}) {
  return {
    schemaVersion: 1,
    outlineSessionId: input.outlineSessionId,
    courseMode: input.courseMode,
    topic: input.topic,
    ...(input.assessmentArtifactId === undefined
      ? {}
      : { assessmentArtifactId: input.assessmentArtifactId }),
    materialArtifactRefs: input.materialArtifactRefs ?? [],
  };
}
