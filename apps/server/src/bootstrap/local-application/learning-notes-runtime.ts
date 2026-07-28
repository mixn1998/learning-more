import type { LearningNoteRouteOptions } from '../../http/routes/learning-notes.js';
import { createLearningNotesService } from '../../modules/learning-notes/learning-notes-service.js';
import { createLocalFileLearningNoteRepository } from '../../persistence/learning-note-repository.js';
import type { DataRoot } from '../../persistence/data-root.js';
import type { UnitOfWork } from '../../persistence/unit-of-work.js';
import type { LocalCourseRuntime } from './course-runtime.js';

export function createLocalLearningNotesRuntime(
  input: Readonly<{
    dataRoot: DataRoot;
    unitOfWork: UnitOfWork;
    course: LocalCourseRuntime;
    now: () => Date;
  }>,
): LearningNoteRouteOptions {
  return {
    service: createLearningNotesService({
      repository: createLocalFileLearningNoteRepository(input.dataRoot),
      unitOfWork: input.unitOfWork,
      courses: input.course.access,
      now: input.now,
    }),
  };
}
