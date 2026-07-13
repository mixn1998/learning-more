export type StageReviewStatus = 'generating' | 'failed' | 'committed';

export type StageReviewState = Readonly<{
  reviewId: string;
  lessonId: string;
  sourceSessionId: string;
  sourceSnapshotHash: string;
  status: StageReviewStatus;
  taskId: string;
  requestReceipts: Readonly<Record<string, string>>;
  artifactRef?: string;
  contentSha256?: string;
  errorCode?: string;
  draftArtifactRef?: string;
  replacementCount: number;
  updatedAt: string;
  resourceVersion: number;
}>;

export type LessonClosureState =
  | 'open'
  | 'generating'
  | 'generating-failed'
  | 'review-ready'
  | 'committing'
  | 'completed'
  | 'cancelled';

export type LessonClosureRecord = Readonly<{
  transactionId: string;
  lessonId: string;
  sessionId: string;
  state: LessonClosureState;
  sourceSessionIds: readonly string[];
  sourceMessageIds: readonly string[];
  messageRangeChecksum: string;
  endIntent: string;
  expectedSessionVersion: number;
  generationTaskId: string;
  review?: Readonly<{
    artifactRef: string;
    markdown: string;
    sourceSessionIds: readonly string[];
    messageRangeChecksum: string;
    contentSha256: string;
  }>;
  finalReviewId?: string;
  errorCode?: string;
  draftArtifactRef?: string;
  updatedAt: string;
  resourceVersion: number;
}>;
