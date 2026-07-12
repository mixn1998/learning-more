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
