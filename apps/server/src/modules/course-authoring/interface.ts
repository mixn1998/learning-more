import type {
  CommandContext,
  CommandResult,
  CandidateGenerationFailureCode,
  CourseMode,
  QueryContext,
} from '@learning-more/contracts';

export type CourseAuthoringCommand =
  | Readonly<{ type: 'CreateOutlineSession'; topic: string; courseMode: CourseMode }>
  | Readonly<{ type: 'AppendOutlineSessionMessage'; outlineSessionId: string; content: string }>
  | Readonly<{ type: 'RequestCandidateGeneration'; outlineSessionId: string }>
  | Readonly<{
      type: 'ConfirmOutlineCandidate';
      outlineSessionId: string;
      candidateVersionId: string;
    }>
  | Readonly<{
      type: 'ReviseCourseOutline';
      courseId: string;
      sourceCandidateVersionId: string;
    }>
  | Readonly<{ type: 'DeleteOutlineSessionDraft'; outlineSessionId: string }>
  | Readonly<{ type: 'SaveOutlineSessionDraft'; outlineSessionId: string }>
  | Readonly<{ type: 'DeleteCourseArchive'; courseId: string }>;

export type CourseAuthoringQuery = Readonly<{
  type: 'GetOutlineSession';
  outlineSessionId: string;
}>;

export type CourseAuthoringResult =
  | Readonly<{
      kind: 'outline-session';
      outlineSessionId: string;
      state: string;
      completedAssessmentRounds: number;
      canGenerateCandidate: boolean;
    }>
  | Readonly<{
      kind: 'message';
      outlineSessionId: string;
      state: string;
      completedAssessmentRounds: number;
      canGenerateCandidate: boolean;
    }>
  | Readonly<{
      kind: 'generation';
      taskId: string;
      draftArtifactRef?: string;
      state: string;
      failureCode?: CandidateGenerationFailureCode;
    }>
  | Readonly<{
      kind: 'confirmation';
      courseId: string;
      outlineVersionId?: string;
    }>
  | Readonly<{ kind: 'revision'; courseId: string; outlineVersionId: string }>
  | Readonly<{ kind: 'outline-session-deleted'; outlineSessionId: string; deletedAt: string }>
  | Readonly<{ kind: 'outline-session-draft-saved'; outlineSessionId: string }>
  | CourseArchiveDeletedResult;

export type CourseArchiveDeletedResult = Readonly<{
  kind: 'course-archive-deleted';
  courseId: string;
  deletedAt: string;
  portraitRefresh: 'updating';
}>;

export type CourseAuthoringEvidenceCheckpoint = Readonly<{
  checkpointId: string;
  checkpointKind: 'authoring_baseline' | 'authoring_candidate_confirmed';
  sourceType: 'outline';
  sourceGroupId: string;
  courseId?: string;
  courseMode: CourseMode;
  dependentSourceGroupIds: readonly string[];
  courseContext: string;
  completeness: 'complete';
  sources: readonly Readonly<{
    sourceRef: string;
    sourceGroupId: string;
    sourceType: 'outline';
    role: 'user' | 'assistant';
    excerpt: string;
    observedAt: string;
  }>[];
}>;

export type CourseAuthoringView = Readonly<{
  outlineSessionId: string;
  resourceVersion: number;
  state: string;
  topic: string;
  courseMode: CourseMode;
  candidateVersionIds: readonly string[];
  completedAssessmentRounds: number;
  canGenerateCandidate: boolean;
  savedAsDraft?: boolean;
  messages: readonly Readonly<{
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'complete' | 'failed';
    createdAt: string;
    inReplyToMessageId?: string;
    alignmentAction?: 'clarify' | 'regenerate' | 'patch';
    targetModuleIds?: readonly string[];
  }>[];
  candidateVersionId?: string;
  candidateMarkdown?: string;
  confirmedCourseId?: string;
  materials?: readonly Readonly<{
    artifactRef: string;
    originalFileName: string;
    format: 'markdown' | 'text' | 'pdf';
    importedAt: string;
    sections: readonly string[];
    warnings: readonly string[];
  }>[];
}>;

export type CourseArchiveView = Readonly<{
  courseId: string;
  title: string;
  status: 'active' | 'closed';
  courseMode: CourseMode;
  outlineVersionId: string;
  lessonIds: readonly string[];
  recommendedLessonId?: string;
  nextLessonRecommendation?: Readonly<{
    versionId: string;
    recommendedLessonId: string;
    rankedLessonIds: readonly string[];
    rationale: string;
    evidenceRefs: readonly string[];
    confidence: number;
    expiresAt: string;
    sourceSnapshotHash: string;
    status: 'current' | 'stale' | 'fallback';
    warnings: readonly string[];
  }>;
  outlineMarkdown?: string;
  lessons?: readonly Readonly<{
    lessonId: string;
    outlineVersionId: string;
    title: string;
    objective: string;
    coreKnowledgePoints: readonly string[];
    prerequisiteLessonIds: readonly string[];
    estimatedMinutes: number;
  }>[];
  outlineVersions?: readonly Readonly<{
    outlineVersionId: string;
    sourceCandidateVersionId: string;
    createdAt: string;
    current: boolean;
  }>[];
  resourceVersion: number;
}>;

export type CourseOutlineVersionView = Readonly<{
  courseId: string;
  outlineVersionId: string;
  sourceCandidateVersionId: string;
  outlineMarkdown: string;
  disciplineTag: string;
  topicTags: readonly string[];
  createdAt: string;
  resourceVersion: number;
  current: boolean;
}>;

export type LessonPreviewView = Readonly<{
  lessonId: string;
  courseId: string;
  outlineVersionId: string;
  title: string;
  objective: string;
  coreKnowledgePoints: readonly string[];
  estimatedMinutes: number;
}>;

export interface CourseAuthoring {
  execute(
    command: CourseAuthoringCommand,
    context: CommandContext,
  ): Promise<CommandResult<CourseAuthoringResult>>;
  query(query: CourseAuthoringQuery, context: QueryContext): Promise<CourseAuthoringView>;
  getCourse?(courseId: string, context: QueryContext): Promise<CourseArchiveView>;
  getOutlineVersion?(
    courseId: string,
    outlineVersionId: string,
    context: QueryContext,
  ): Promise<CourseOutlineVersionView>;
  getLesson?(lessonId: string, context: QueryContext): Promise<LessonPreviewView>;
}
