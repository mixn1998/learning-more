import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { DataRoot } from '../../apps/server/src/persistence/data-root.js';
import { createMarkdownArtifactStore } from '../../apps/server/src/persistence/markdown-artifact-store.js';
import { createLocalFileReviewClosureRepositories } from '../../apps/server/src/persistence/review-closure-repositories.js';
import { createUnitOfWork } from '../../apps/server/src/persistence/unit-of-work.js';

const dataRoot = path.join(process.cwd(), 'tests', '.tmp', 'course-authoring-data');
const processFile = path.join(process.cwd(), 'tests', '.tmp', 'e2e-processes.json');

async function waitFor(url: string, expectedUp: boolean) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (expectedUp && response.ok) return;
    } catch {
      if (!expectedUp) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url} to be ${expectedUp ? 'up' : 'down'}`);
}

async function restartServer() {
  const processes = JSON.parse(await readFile(processFile, 'utf8')) as {
    server: number;
    web: number;
  };
  process.kill(processes.server, 'SIGTERM');
  await waitFor('http://127.0.0.1:43120/api/v1/runtime/ready', false);
  const server = spawn(
    process.execPath,
    ['--import', 'tsx', 'tests/e2e/start-course-authoring-server.ts'],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, LEARNING_MORE_DATA_ROOT: dataRoot },
    },
  );
  server.unref();
  if (server.pid === undefined) throw new Error('Failed to restart E2E server');
  await writeFile(processFile, JSON.stringify({ server: server.pid, web: processes.web }), 'utf8');
  await waitFor('http://127.0.0.1:43120/api/v1/runtime/ready', true);
}

async function aggregateDocuments(entityType: string) {
  const directory = path.join(dataRoot, 'entities', entityType);
  const files = await readdir(directory, { recursive: true }).catch(() => []);
  return Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .map(
        async (file) =>
          JSON.parse(await readFile(path.join(directory, file), 'utf8')) as {
            data: Record<string, unknown>;
          },
      ),
  );
}

async function createCourse(page: Page): Promise<{ courseId: string; lessonIds: string[] }> {
  await page.goto('/courses/new');
  await page.getByLabel('学习主题').fill('Probability lifecycle');
  await page.getByRole('button', { name: '开始创建' }).click();
  await page.getByLabel('补充需求').fill('Include recovery and review');
  await page.getByRole('button', { name: '完成评估' }).click();
  await page.getByRole('button', { name: '生成候选大纲' }).click();

  const failure = page.getByRole('alert');
  const candidate = page.getByRole('heading', { name: /Candidate outline/ });
  await expect(failure.or(candidate)).toBeVisible();
  if (await failure.isVisible()) {
    await page.getByRole('button', { name: '重试生成' }).click();
  }
  await expect(candidate).toBeVisible();
  await page.getByRole('button', { name: '确认此候选' }).click();
  await page.getByRole('button', { name: '确认创建课程' }).click();
  await expect(page).toHaveURL(/\/courses\/course_/);
  const courseId = page.url().split('/').at(-1)!;
  const courses = await aggregateDocuments('courses');
  const course = courses.find((document) => document.data.id === courseId)?.data as
    { lessonIds: string[] } | undefined;
  expect(course).toBeDefined();
  return { courseId, lessonIds: course!.lessonIds };
}

async function completeLesson(page: Page, lessonId: string, exerciseLifecycle: boolean) {
  await page.goto(`/lessons/${lessonId}`);
  await page.getByRole('button', { name: '开始学习' }).click();
  const input = page.getByLabel('学习输入');
  await expect(input).toBeEnabled();
  await input.fill(`Explain ${lessonId}`);
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('article', { name: 'AI 导师' }).last()).toContainText(
    '我们从你刚才的问题继续',
  );
  await expect(page.getByRole('button', { name: '停止生成' })).toBeHidden();

  if (exerciseLifecycle) {
    await page.getByRole('button', { name: '暂停学习' }).click();
    await expect(input).toBeDisabled();
    await page.getByRole('button', { name: '继续学习' }).click();
    await expect(input).toBeEnabled();
    await page.getByRole('button', { name: '结束本课' }).click();
    await page.getByRole('button', { name: '确认放弃课节' }).click();
    await expect(page.getByRole('button', { name: '恢复学习' })).toBeVisible();
    await page.getByRole('button', { name: '恢复学习' }).click();
    await expect(input).toBeEnabled();
  }

  await page.getByRole('button', { name: '结束本课' }).click();
  await page.getByRole('button', { name: '完成本课' }).click();
  await expect(page.getByRole('dialog')).toContainText('学习 Review');
  await expect(input).toBeDisabled();
}

async function leaveLessonReadyToCommitAfterRestart(page: Page, lessonId: string) {
  await page.goto(`/lessons/${lessonId}`);
  await page.getByRole('button', { name: '开始学习' }).click();
  const input = page.getByLabel('学习输入');
  await expect(input).toBeEnabled();
  await input.fill(`Explain ${lessonId}`);
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('article', { name: 'AI 导师' }).last()).toContainText(
    '我们从你刚才的问题继续',
  );
  await expect(page.getByRole('button', { name: '停止生成' })).toBeHidden();

  const progressDocuments = await aggregateDocuments('lesson-progress');
  const progress = progressDocuments.find((document) => document.data.lessonId === lessonId)!
    .data as {
    resourceVersion: number;
    learning: { session: { id: string; messageIds: string[] } };
  };
  const root = DataRoot.create(dataRoot);
  const unitOfWork = createUnitOfWork({ dataRoot: root });
  const repositories = createLocalFileReviewClosureRepositories(root);
  const artifactStore = createMarkdownArtifactStore(root, unitOfWork);
  const transactionId = `closure_restart_${Date.now()}`;
  const finalReviewId = `review_final_restart_${Date.now()}`;
  const artifactRef = `artifact_final_restart_${Date.now()}`;
  const markdown = '# Restart Recovery Review\nRecovered exactly once.';
  const checksum = createHash('sha256').update(markdown).digest('hex');
  await artifactStore.finalize({
    artifactId: artifactRef,
    kind: 'lesson-final-review',
    content: markdown,
    immutable: true,
  });
  await unitOfWork.execute({ transactionId: `tx_${transactionId}` }, (tx) =>
    repositories.lessonClosures.save(
      tx,
      {
        transactionId,
        lessonId,
        sessionId: progress.learning.session.id,
        state: 'committing',
        sourceSessionIds: [progress.learning.session.id],
        sourceMessageIds: progress.learning.session.messageIds,
        messageRangeChecksum: checksum,
        endIntent: 'finish lesson before restart',
        expectedSessionVersion: progress.resourceVersion,
        generationTaskId: `task_${transactionId}`,
        review: {
          artifactRef,
          markdown,
          sourceSessionIds: [progress.learning.session.id],
          messageRangeChecksum: checksum,
          contentSha256: checksum,
        },
        finalReviewId,
        updatedAt: new Date().toISOString(),
        resourceVersion: 0,
      },
      0,
    ),
  );
  return { artifactRef, markdown };
}

test('[EQ-LESSON-03] completes learning lifecycle, immutable lesson Reviews, and course closure', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { courseId, lessonIds } = await createCourse(page);
  expect(lessonIds).toHaveLength(2);
  await completeLesson(page, lessonIds[0]!, true);
  await expect(page.getByRole('dialog')).toContainText('学习 Review');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: '开始补充学习' }).click();
  const supplementaryInput = page.getByLabel('补充学习输入');
  await supplementaryInput.fill('Explore a related example');
  await page.getByRole('button', { name: '发送补充消息' }).click();
  await expect(supplementaryInput).toHaveValue('');
  await expect(page.getByText('补充学习会话已独立创建')).toBeVisible();
  const record = await page.evaluate(async (lessonId) => {
    const response = await fetch(`/api/v1/lessons/${lessonId}/record`);
    if (!response.ok) throw new Error(`record request failed: ${response.status}`);
    return response.json() as Promise<{
      courseId: string;
      title: string;
      courseTitle: string;
      completedAt: string;
      actualSeconds: number;
      supplementary: Array<{ label: string; messages: string[] }>;
    }>;
  }, lessonIds[0]!);
  expect(record).toMatchObject({
    courseId,
    supplementary: [{ label: '补充学习 1', messages: ['你：Explore a related example'] }],
  });
  expect(record.title).not.toBe('');
  expect(record.courseTitle).not.toBe('');
  expect(Number.isNaN(Date.parse(record.completedAt))).toBe(false);
  expect(record.actualSeconds).toBeGreaterThanOrEqual(0);
  await page.goto(`/courses/${courseId}/lessons/${lessonIds[0]!}/record`);
  await expect(page.getByRole('heading', { name: record.title })).toBeVisible();
  await page.getByRole('button', { name: '补充学习 1' }).click();
  await expect(page.getByLabel('只读学习对话')).toContainText('Explore a related example');
  const pending = await leaveLessonReadyToCommitAfterRestart(page, lessonIds[1]!);
  await restartServer();
  await page.reload();
  await page.getByRole('button', { name: '查看课节记录' }).click();
  await page.getByRole('tab', { name: '课时 Review' }).click();
  await expect(page.getByLabel('权威课时 Review')).toContainText('Recovered exactly once.');

  await page.goto(`/courses/${courseId}`);
  await page.getByRole('button', { name: '关闭课程并生成总结' }).click();
  await page.getByRole('button', { name: '确认关闭课程' }).click();
  await expect(page.getByRole('heading', { name: '主题核心知识线索' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '总体学习表现' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '推荐扩展课程' })).toBeVisible();

  const lessonProgress = await aggregateDocuments('lesson-progress');
  const completed = lessonProgress.filter((document) =>
    lessonIds.includes(document.data.lessonId as string),
  );
  expect(completed).toHaveLength(2);
  expect(completed.every((document) => document.data.finalReview !== undefined)).toBe(true);
  const stageReviews = await aggregateDocuments('reviews');
  const firstFinalReview = completed.find((document) => document.data.lessonId === lessonIds[0])
    ?.data.finalReview as { id: string; artifactRef: string };
  const firstStageReview = stageReviews.find((document) => document.data.lessonId === lessonIds[0])
    ?.data as { reviewId: string; artifactRef: string };
  expect(firstStageReview.reviewId).toBe(firstFinalReview.id);
  expect(firstStageReview.artifactRef).toBe(firstFinalReview.artifactRef);
  expect(
    completed.filter(
      (document) =>
        (document.data.finalReview as { artifactRef?: string } | undefined)?.artifactRef ===
        pending.artifactRef,
    ),
  ).toHaveLength(1);
  const supplementary = await aggregateDocuments('lesson-sessions');
  expect(supplementary).toHaveLength(1);
  expect(supplementary[0]?.data).toMatchObject({
    lessonId: lessonIds[0],
    sourceFinalReviewId: (
      completed.find((document) => document.data.lessonId === lessonIds[0])?.data.finalReview as {
        id: string;
      }
    ).id,
    messageIds: expect.any(Array),
  });
  const courseReviews = await aggregateDocuments('course-reviews');
  expect(courseReviews.find((document) => document.data.courseId === courseId)?.data).toMatchObject(
    {
      state: 'review-finalized',
    },
  );
});
