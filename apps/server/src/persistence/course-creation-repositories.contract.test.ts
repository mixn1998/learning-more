import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLocalFileCourseCreationRepositories } from './course-creation-repositories.js';
import { DataRoot } from './data-root.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createUnitOfWork } from './unit-of-work.js';

describe('LocalFile Course creation repositories', () => {
  it('reopens a complete Course, fixed outline, and stable lesson set', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-course-repo-'));
    try {
      const dataRoot = DataRoot.create(directory);
      await initializeStoreLayout(createStorePaths(dataRoot));
      const repositories = createLocalFileCourseCreationRepositories(dataRoot);
      await createUnitOfWork({ dataRoot }).execute({ transactionId: 'tx_course' }, async (tx) => {
        await repositories.outlineVersions.save(
          tx,
          {
            id: 'outline_01',
            courseId: 'course_01',
            sourceCandidateVersionId: 'candidate_01',
            outlineMarkdown: '# 大纲',
            disciplineTag: '数学',
            topicTags: ['概率'],
            createdAt: '2026-07-13T00:00:00.000Z',
            resourceVersion: 0,
          },
          0,
        );
        await repositories.lessons.save(
          tx,
          {
            id: 'lesson_01',
            courseId: 'course_01',
            outlineVersionId: 'outline_01',
            semanticKey: 'probability-space',
            title: '概率空间',
            objective: '理解概念',
            coreKnowledgePoints: ['样本空间'],
            knowledgeStructure: {
              mainChain: [{ id: 'node_1', content: '样本空间' }],
              branches: [],
            },
            prerequisiteLessonIds: [],
            estimatedMinutes: 30,
            sourceRefs: ['source_topic'],
            resourceVersion: 0,
          },
          0,
        );
        await repositories.courses.save(
          tx,
          {
            id: 'course_01',
            title: '概率论',
            courseMode: 'standard',
            outlineVersionId: 'outline_01',
            lessonIds: ['lesson_01'],
            recommendedLessonId: 'lesson_01',
            status: 'active',
            createdAt: '2026-07-13T00:00:00.000Z',
            resourceVersion: 0,
          },
          0,
        );
      });

      const reopened = createLocalFileCourseCreationRepositories(dataRoot);
      await expect(reopened.courses.get('course_01')).resolves.toMatchObject({
        resourceVersion: 1,
      });
      await expect(reopened.outlineVersions.get('outline_01')).resolves.toMatchObject({
        resourceVersion: 1,
      });
      const lessons = [];
      for await (const lesson of reopened.lessons.listByCourse('course_01')) lessons.push(lesson);
      expect(lessons).toHaveLength(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
