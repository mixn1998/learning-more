import { describe, expect, it } from 'vitest';

import {
  createReplacementLessonFact,
  resolveBoundLessonVersion,
} from '../implementation/lesson-version-binding.js';

describe('lesson version binding', () => {
  it('[EQ-LESSON-07] resumes the original definition/session across outline versions and records replacement as a new fact', () => {
    const original = {
      lessonId: 'lesson_v1',
      lessonDefinitionId: 'definition_v1',
      outlineVersionId: 'outline_v1',
    };
    expect(
      resolveBoundLessonVersion({
        binding: original,
        currentOutlineVersionId: 'outline_v2',
        progress: 'abandoned',
        hasOriginalSession: true,
      }),
    ).toEqual({ binding: original, versionChanged: true, resumeOriginal: true });
    expect(
      createReplacementLessonFact({
        original,
        replacement: {
          lessonId: 'lesson_v2',
          lessonDefinitionId: 'definition_v2',
          outlineVersionId: 'outline_v2',
        },
      }),
    ).toEqual({
      type: 'LessonReplacedByNewDefinition',
      originalLessonId: 'lesson_v1',
      replacementLessonId: 'lesson_v2',
      originalPreserved: true,
    });
  });
});
