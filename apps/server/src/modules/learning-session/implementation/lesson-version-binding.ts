export type LessonVersionBinding = Readonly<{
  lessonId: string;
  lessonDefinitionId: string;
  outlineVersionId: string;
}>;

export function resolveBoundLessonVersion(
  input: Readonly<{
    binding: LessonVersionBinding;
    currentOutlineVersionId: string;
    progress: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
    hasOriginalSession: boolean;
  }>,
): Readonly<{
  binding: LessonVersionBinding;
  versionChanged: boolean;
  resumeOriginal: boolean;
}> {
  return {
    binding: input.binding,
    versionChanged: input.binding.outlineVersionId !== input.currentOutlineVersionId,
    resumeOriginal:
      input.hasOriginalSession &&
      (input.progress === 'in_progress' || input.progress === 'abandoned'),
  };
}

export function createReplacementLessonFact(
  input: Readonly<{
    original: LessonVersionBinding;
    replacement: LessonVersionBinding;
  }>,
): Readonly<{
  type: 'LessonReplacedByNewDefinition';
  originalLessonId: string;
  replacementLessonId: string;
  originalPreserved: true;
}> {
  if (input.original.lessonId === input.replacement.lessonId) {
    throw new Error('replacement_lesson_id_must_be_new');
  }
  return {
    type: 'LessonReplacedByNewDefinition',
    originalLessonId: input.original.lessonId,
    replacementLessonId: input.replacement.lessonId,
    originalPreserved: true,
  };
}
