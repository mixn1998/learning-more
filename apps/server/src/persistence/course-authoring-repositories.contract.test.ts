import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createOutlineSession } from '../modules/course-authoring/model/outline-session.js';
import { createCourseAuthoringModule } from '../modules/course-authoring/implementation/course-authoring-module.js';
import {
  createInMemoryCourseAuthoringRepositories,
  createLocalFileCourseAuthoringRepositories,
} from './course-authoring-repositories.js';
import { DataRoot } from './data-root.js';
import { checksumJson, encodeJson } from './json-codec.js';
import { createStorePaths, initializeStoreLayout } from './paths.js';
import { createUnitOfWork } from './unit-of-work.js';
import { recoverTransactions } from './recover-transactions.js';
import type { TransactionFaultPoint } from './unit-of-work.js';

const candidateMarkdown = `\`\`\`learning-more-outline
{"protocol":"learning-more.candidate","schemaVersion":1,"outline":{"courseGoals":["掌握目标"],"disciplineTag":"数学","topicTags":["概率"],"modules":[{"id":"module_1","title":"基础","lessonIds":["lesson_1"]}],"lessons":[{"id":"lesson_1","title":"第一课","objective":"理解概念","coreKnowledgePoints":["概念"],"prerequisiteLessonIds":[],"estimatedMinutes":30,"sourceRefs":["source_topic"]}]}}
\`\`\`
# 第一课`;

describe('course authoring repository adapters', () => {
  it('reads the known pre-conversation session shape without classifying it as corruption', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-authoring-legacy-'));
    try {
      const dataRoot = DataRoot.create(directory);
      const paths = createStorePaths(dataRoot);
      await initializeStoreLayout(paths);
      const data = {
        resourceVersion: 7,
        candidateCommandReceipts: {},
        session: {
          outlineSessionId: 'session_legacy',
          courseMode: 'brainstorm',
          topic: 'legacy topic',
          state: 'ready-for-candidates',
          assessmentArtifactId: 'assessment_legacy',
          candidateVersionIds: [],
        },
      };
      const document = {
        schema: 'learning-more/outline-sessions',
        schemaVersion: 1,
        entityType: 'outline-sessions',
        entityId: 'session_legacy',
        resourceVersion: 7,
        createdAt: 'preserved-in-data',
        updatedAt: '2026-07-14T00:00:00.000Z',
        contentSha256: checksumJson(data),
        data,
      };
      const file = paths.aggregate('outline-sessions', 'session_legacy');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, encodeJson(document), 'utf8');

      await expect(
        createLocalFileCourseAuthoringRepositories(dataRoot).outlineSessions.get('session_legacy'),
      ).resolves.toMatchObject({
        resourceVersion: 7,
        messages: [],
        session: {
          state: 'assessment-ready',
          messageIds: [],
          completedAssessmentRounds: 0,
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('LocalFile persists Unicode sessions across reopen and detects corruption', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-authoring-repo-'));
    try {
      const dataRoot = DataRoot.create(directory);
      const paths = createStorePaths(dataRoot);
      await initializeStoreLayout(paths);
      const unitOfWork = createUnitOfWork({ dataRoot });
      const repositories = createLocalFileCourseAuthoringRepositories(dataRoot);
      const session = createOutlineSession({
        outlineSessionId: '会话_01',
        courseMode: 'reading_seminar',
        topic: '阅读概率论原著',
      });
      await unitOfWork.execute({ transactionId: 'tx_save_session' }, (tx) =>
        repositories.outlineSessions.save(
          tx,
          {
            session,
            resourceVersion: 0,
            candidateCommandReceipts: {},
            messages: [],
          },
          0,
        ),
      );

      await expect(
        createLocalFileCourseAuthoringRepositories(dataRoot).outlineSessions.get('会话_01'),
      ).resolves.toMatchObject({
        resourceVersion: 1,
        session: { topic: '阅读概率论原著' },
      });

      await writeFile(paths.aggregate('outline-sessions', '会话_01'), '{"corrupt":true}\n', 'utf8');
      await expect(repositories.outlineSessions.get('会话_01')).rejects.toMatchObject({
        code: 'storage_corrupted',
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('InMemory shared backing reopens with the same version behavior', async () => {
    const first = createInMemoryCourseAuthoringRepositories();
    const session = createOutlineSession({
      outlineSessionId: 'session_01',
      courseMode: 'standard',
      topic: '主题',
    });
    await first.outlineSessions.save(
      {
        stageJson: async () => undefined,
        stageText: async () => undefined,
        deleteOnCommit: async () => undefined,
      },
      {
        session,
        resourceVersion: 0,
        candidateCommandReceipts: {},
        messages: [],
      },
      0,
    );

    await expect(first.outlineSessions.get('session_01')).resolves.toMatchObject({
      resourceVersion: 1,
    });
    await expect(
      first.outlineSessions.save(
        {
          stageJson: async () => undefined,
          stageText: async () => undefined,
          deleteOnCommit: async () => undefined,
        },
        {
          session,
          resourceVersion: 0,
          candidateCommandReceipts: {},
          messages: [],
        },
        0,
      ),
    ).rejects.toMatchObject({ code: 'version_conflict', currentVersion: 1 });
  });

  it('persists an immutable material snapshot', async () => {
    const repositories = createInMemoryCourseAuthoringRepositories();
    const context = {
      stageJson: async () => undefined,
      stageText: async () => undefined,
      deleteOnCommit: async () => undefined,
    };
    const material = {
      artifactRef: 'material:abc',
      outlineSessionId: 'session_01',
      originalFileName: '原文.md',
      format: 'markdown' as const,
      sha256: 'a'.repeat(64),
      importedAt: '2026-07-13T00:00:00.000Z',
      parserVersion: 'material-ingestion-v1' as const,
      extractedText: '# 原文',
      sections: [{ title: '原文', level: 1 }],
      warnings: [],
      resourceVersion: 0,
    };

    await repositories.materials.save(context, material, 0);

    await expect(repositories.materials.get('material:abc')).resolves.toMatchObject({
      resourceVersion: 1,
      originalFileName: '原文.md',
    });
    await expect(repositories.materials.save(context, material, 0)).rejects.toMatchObject({
      code: 'immutable_resource',
    });
  });

  it('never leaves an orphan candidate at any transaction crash point', async () => {
    const faultPoints: TransactionFaultPoint[] = [
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
    for (const [index, selectedPoint] of faultPoints.entries()) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-authoring-crash-'));
      try {
        const dataRoot = DataRoot.create(directory);
        await initializeStoreLayout(createStorePaths(dataRoot));
        const repositories = createLocalFileCourseAuthoringRepositories(dataRoot);
        const stableModule = createCourseAuthoringModule({
          repositories,
          unitOfWork: createUnitOfWork({ dataRoot }),
          generationRuntime: { submit: async () => ({ taskId: `task_${index}` }) },
          draftStore: { saveDraft: async () => undefined },
        });
        await stableModule.createOutlineSession({
          outlineSessionId: `session_${index}`,
          courseMode: 'standard',
          topic: '概率论',
          assessmentArtifactId: 'a1',
        });
        await stableModule.requestCandidate({
          commandId: `command_${index}`,
          outlineSessionId: `session_${index}`,
          inputSnapshotHash: `hash_${index}`,
          promptInputArtifactRef: `prompt:${index}`,
        });
        const crashingModule = createCourseAuthoringModule({
          repositories,
          unitOfWork: createUnitOfWork({
            dataRoot,
            faultInjector(point) {
              if (point === selectedPoint) throw new Error(`CRASH:${point}`);
            },
          }),
          generationRuntime: { submit: async () => ({ taskId: `task_${index}` }) },
          draftStore: { saveDraft: async () => undefined },
        });

        await expect(
          crashingModule.completeCandidate({
            outlineSessionId: `session_${index}`,
            generationTaskId: `task_${index}`,
            candidateVersionId: `candidate_${index}`,
            draftArtifactRef: `draft_${index}`,
            markdown: candidateMarkdown,
            inputManifest: { draftArtifactRef: `draft_${index}`, sourceRefs: ['source_topic'] },
          }),
        ).rejects.toThrow(`CRASH:${selectedPoint}`);
        await recoverTransactions(dataRoot);

        const reopened = createLocalFileCourseAuthoringRepositories(dataRoot);
        const candidate = await reopened.candidateVersions.get(`candidate_${index}`);
        const session = await reopened.outlineSessions.get(`session_${index}`);
        expect(candidate !== undefined).toBe(
          session?.session.latestCandidateVersionId === `candidate_${index}`,
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    }
  }, 30_000);
});
