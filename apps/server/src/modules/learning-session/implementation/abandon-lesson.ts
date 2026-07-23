import type { CommandContext } from '@learning-more/contracts';

import type { LearningSessionModule } from '../interface.js';

export async function abandonLesson(
  input: { readonly lessonId: string; readonly sourceSnapshotHash: string },
  context: CommandContext,
  dependencies: {
    readonly sessionModule: LearningSessionModule;
    readonly stageReviews: {
      request(input: {
        lessonId: string;
        sourceSessionId: string;
        sourceSnapshotHash: string;
        commandId: string;
      }): Promise<{ reviewId: string; taskId: string }>;
    };
  },
) {
  const abandoned = await dependencies.sessionModule.execute(
    { type: 'AbandonLesson', lessonId: input.lessonId },
    context,
  );
  if (abandoned.value.progress !== 'abandoned' || abandoned.value.sessionId === undefined) {
    return { ...abandoned.value, stageReview: undefined };
  }
  const stageReview = await dependencies.stageReviews.request({
    lessonId: input.lessonId,
    sourceSessionId: abandoned.value.sessionId,
    sourceSnapshotHash: input.sourceSnapshotHash,
    commandId: context.commandId,
  });
  return { ...abandoned.value, stageReview };
}
