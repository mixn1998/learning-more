import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLocalFileCourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import { createLocalFileCourseCreationRepositories } from '../../../persistence/course-creation-repositories.js';
import { DataRoot } from '../../../persistence/data-root.js';
import { createStorePaths, initializeStoreLayout } from '../../../persistence/paths.js';
import { recoverTransactions } from '../../../persistence/recover-transactions.js';
import { createUnitOfWork, type TransactionFaultPoint } from '../../../persistence/unit-of-work.js';
import { confirmCourse } from '../implementation/confirm-course.js';
import { createCourseAuthoringModule } from '../implementation/course-authoring-module.js';

const markdown = `\`\`\`learning-more-outline
{"protocol":"learning-more.candidate","schemaVersion":1,"outline":{"courseGoals":["掌握目标"],"disciplineTag":"数学","topicTags":["概率"],"modules":[{"id":"module_1","title":"基础","lessonIds":["lesson_1"]}],"lessons":[{"id":"lesson_1","title":"第一课","objective":"理解概念","coreKnowledgePoints":["概念"],"prerequisiteLessonIds":[],"estimatedMinutes":30,"sourceRefs":["source_topic"]}]}}
\`\`\`
# 第一课`;

describe('confirmCourse crash recovery', () => {
  it('recovers every transaction point to no course or one complete course', async () => {
    const points: TransactionFaultPoint[] = [
      'journal:preparing',
      'journal:prepared',
      'journal:committing',
      'before-apply:0',
      'after-backup:0',
      'after-apply:0',
      'before-apply:1',
      'after-backup:1',
      'after-apply:1',
      'journal:committed',
      'before-cleanup',
      'after-cleanup',
    ];
    for (const [index, selected] of points.entries()) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-confirm-crash-'));
      try {
        const dataRoot = DataRoot.create(directory);
        await initializeStoreLayout(createStorePaths(dataRoot));
        const authoring = createLocalFileCourseAuthoringRepositories(dataRoot);
        const courses = createLocalFileCourseCreationRepositories(dataRoot);
        const stable = createCourseAuthoringModule({
          repositories: authoring,
          unitOfWork: createUnitOfWork({ dataRoot }),
          generationRuntime: { submit: async () => ({ taskId: `task_${index}` }) },
          draftStore: { saveDraft: async () => undefined },
        });
        await stable.createOutlineSession({
          outlineSessionId: `session_${index}`,
          courseMode: 'standard',
          topic: '概率论',
          assessmentArtifactId: 'a1',
        });
        await stable.requestCandidate({
          commandId: `command_${index}`,
          outlineSessionId: `session_${index}`,
          inputSnapshotHash: `hash_${index}`,
          promptInputArtifactRef: `prompt:${index}`,
        });
        await stable.completeCandidate({
          outlineSessionId: `session_${index}`,
          generationTaskId: `task_${index}`,
          candidateVersionId: `candidate_${index}`,
          draftArtifactRef: `draft_${index}`,
          markdown,
          inputManifest: { draftArtifactRef: `draft_${index}`, sourceRefs: ['source_topic'] },
        });
        const crashingUow = createUnitOfWork({
          dataRoot,
          faultInjector(point) {
            if (point === selected) throw new Error(`CRASH:${point}`);
          },
        });
        await expect(
          confirmCourse(
            {
              type: 'courseAuthoring.confirmCourse',
              outlineSessionId: `session_${index}`,
              outlineVersionId: `candidate_${index}`,
              courseId: `course_${index}`,
              metadata: {
                idempotencyKey: `confirm_${index}`,
                requestedAt: '2026-07-13T00:00:00.000Z',
              },
            },
            {
              authoring,
              courses,
              unitOfWork: crashingUow,
              nextEventId: () => `event_${index}`,
              now: () => new Date('2026-07-13T00:00:00.000Z'),
            },
          ),
        ).rejects.toThrow(`CRASH:${selected}`);
        await recoverTransactions(dataRoot);

        const reopenedAuthoring = createLocalFileCourseAuthoringRepositories(dataRoot);
        const reopenedCourses = createLocalFileCourseCreationRepositories(dataRoot);
        const course = await reopenedCourses.courses.get(`course_${index}`);
        const session = await reopenedAuthoring.outlineSessions.get(`session_${index}`);
        const lessons = [];
        for await (const lesson of reopenedCourses.lessons.listByCourse(`course_${index}`))
          lessons.push(lesson);
        expect(course !== undefined).toBe(session?.session.state === 'confirmed');
        expect(course === undefined ? 0 : lessons.length).toBe(course === undefined ? 0 : 1);
        if (course !== undefined) {
          await expect(
            reopenedCourses.outlineVersions.get(course.outlineVersionId),
          ).resolves.toBeDefined();
        }
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    }
  }, 30_000);
});
