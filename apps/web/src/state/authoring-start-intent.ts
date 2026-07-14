import type { CourseMode } from '@learning-more/contracts';

export type AuthoringStartIntent = Readonly<{
  topic: string;
  courseMode: CourseMode;
  materialFile?: File | undefined;
}>;

export type AuthoringLocationState = Readonly<{
  authoringStartIntent: AuthoringStartIntent;
}>;

export function readAuthoringStartIntent(state: unknown): AuthoringStartIntent | undefined {
  if (typeof state !== 'object' || state === null || !('authoringStartIntent' in state)) {
    return undefined;
  }
  const intent = state.authoringStartIntent;
  if (
    typeof intent !== 'object' ||
    intent === null ||
    !('topic' in intent) ||
    typeof intent.topic !== 'string' ||
    !('courseMode' in intent) ||
    typeof intent.courseMode !== 'string'
  ) {
    return undefined;
  }
  return intent as AuthoringStartIntent;
}
