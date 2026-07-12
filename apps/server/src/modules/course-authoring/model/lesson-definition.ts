export interface LessonDefinition {
  readonly id: string;
  readonly courseId: string;
  readonly outlineVersionId: string;
  readonly semanticKey: string;
  readonly title: string;
  readonly objective: string;
  readonly coreKnowledgePoints: readonly string[];
  readonly prerequisiteLessonIds: readonly string[];
  readonly estimatedMinutes: number;
  readonly sourceRefs: readonly string[];
  readonly resourceVersion: number;
}
