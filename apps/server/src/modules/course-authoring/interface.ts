import type {
  CommandContext,
  CommandResult,
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
    }>;

export type CourseAuthoringQuery = Readonly<{
  type: 'GetOutlineSession';
  outlineSessionId: string;
}>;

export type CourseAuthoringResult =
  | Readonly<{ kind: 'outline-session'; outlineSessionId: string; state?: string }>
  | Readonly<{ kind: 'message'; outlineSessionId: string; state: string }>
  | Readonly<{
      kind: 'generation';
      taskId: string;
      draftArtifactRef?: string;
      state: string;
    }>
  | Readonly<{
      kind: 'confirmation';
      courseId: string;
      outlineVersionId?: string;
    }>
  | Readonly<{ kind: 'revision'; courseId: string; outlineVersionId: string }>;

export type CourseAuthoringView = Readonly<{
  outlineSessionId: string;
  resourceVersion: number;
  state: string;
  [key: string]: unknown;
}>;

export interface CourseAuthoring {
  execute(
    command: CourseAuthoringCommand,
    context: CommandContext,
  ): Promise<CommandResult<CourseAuthoringResult>>;
  query(query: CourseAuthoringQuery, context: QueryContext): Promise<CourseAuthoringView>;
}
