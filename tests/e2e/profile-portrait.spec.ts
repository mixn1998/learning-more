import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import type { LearningFact } from '../../apps/server/src/modules/learning-facts/interface.js';
import { DataRoot } from '../../apps/server/src/persistence/data-root.js';
import { createLocalFileFactRepository } from '../../apps/server/src/persistence/learning-facts-repositories.js';
import { createUnitOfWork } from '../../apps/server/src/persistence/unit-of-work.js';

const dataDirectory = path.join(process.cwd(), 'tests', '.tmp', 'course-authoring-data');

async function documents(root: string) {
  const files = await readdir(root, { recursive: true }).catch(() => []);
  return Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .map(
        async (file) =>
          JSON.parse(await readFile(path.join(root, file), 'utf8')) as {
            data: Record<string, unknown>;
          },
      ),
  );
}

async function createCourse(page: Page) {
  await page.goto('/courses/new');
  await page.getByLabel('学习主题').fill('Portrait evidence course');
  await page.getByRole('button', { name: '开始创建' }).click();
  await page.getByLabel('补充需求').fill('Two independent lessons');
  await page.getByRole('button', { name: '完成评估' }).click();
  await page.getByRole('button', { name: '生成候选大纲' }).click();
  const failure = page.getByRole('alert');
  const candidate = page.getByRole('heading', { name: /Candidate outline/ });
  await expect(failure.or(candidate)).toBeVisible();
  if (await failure.isVisible()) await page.getByRole('button', { name: '重试生成' }).click();
  await expect(candidate).toBeVisible();
  await page.getByRole('button', { name: '确认此候选' }).click();
  await page.getByRole('button', { name: '确认创建课程' }).click();
  await expect(page).toHaveURL(/\/courses\/course_/);
  const courseId = new URL(page.url()).pathname.split('/').at(-1)!;
  const courses = await documents(path.join(dataDirectory, 'entities', 'courses'));
  return courses.find((document) => document.data.id === courseId)!.data as {
    id: string;
    lessonIds: string[];
  };
}

async function completeLesson(page: Page, lessonId: string) {
  await page.goto(`/lessons/${lessonId}`);
  await page.getByRole('button', { name: '开始学习' }).click();
  await page.getByLabel('学习输入').fill(`Complete independent lesson ${lessonId}`);
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('heading', { name: /Candidate outline/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeHidden();
  await page.getByRole('button', { name: '结束本课' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('generates evidence-backed portraits and keeps old versions auditable after retraction', async ({
  page,
}) => {
  const course = await createCourse(page);
  expect(course.lessonIds).toHaveLength(2);
  await completeLesson(page, course.lessonIds[0]!);
  await completeLesson(page, course.lessonIds[1]!);

  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: '学习画像' })).toBeVisible();
  await page.getByRole('button', { name: '刷新学习画像' }).click();
  await expect(page.getByRole('heading', { name: '当前学习画像' })).toBeVisible();
  const evidenceButtons = page.getByRole('button', { name: /查看证据链/ });
  expect(await evidenceButtons.count()).toBeGreaterThan(0);
  await evidenceButtons.first().click();
  await expect(page.getByRole('dialog', { name: '复合行为证据链' })).toBeVisible();
  expect(await page.getByRole('dialog').getByRole('listitem').count()).toBeGreaterThanOrEqual(2);

  const oldPortrait = await page.evaluate(async () => (await fetch('/api/v1/portrait')).json());
  const oldVersion = oldPortrait as {
    versionId: string;
    claims: Array<{ evidenceIds: string[] }>;
  };
  const referencedEvidenceId = oldVersion.claims.flatMap((claim) => claim.evidenceIds)[0]!;
  const candidateDocuments = await documents(
    path.join(dataDirectory, 'portrait-evidence', 'candidates'),
  );
  const referencedCandidate = candidateDocuments.find(
    (document) => document.data.evidenceId === referencedEvidenceId,
  )!.data as { sourceRefs: string[]; sourceGroupId: string };
  const supersededFactId = referencedCandidate.sourceRefs[0]!.replace(/^fact:/, '');
  const timestamp = new Date().toISOString();
  const replacementFact: LearningFact = {
    factId: `fact_retraction_${randomUUID()}`,
    factType: 'LessonRestoredFact',
    subjectRefs: {
      courseId: course.id,
      lessonId: referencedCandidate.sourceGroupId.replace(/^lesson:/, ''),
    },
    occurredAt: timestamp,
    recordedAt: timestamp,
    sourceEventId: `event_retraction_${randomUUID()}`,
    dataKeys: ['lesson.restored_at', 'lesson.lifecycle_status'],
    payload: { supersedesFactId: supersededFactId },
    schemaVersion: 1,
  };
  const dataRoot = DataRoot.create(dataDirectory);
  await createUnitOfWork({ dataRoot }).execute(
    { transactionId: `tx_retraction_${randomUUID()}` },
    (tx) => createLocalFileFactRepository(dataRoot).append(tx, replacementFact),
  );
  await page.evaluate(async () => fetch('/api/v1/profile-facts'));
  const newPortrait = await page.evaluate(async () =>
    (
      await fetch('/api/v1/portrait-refreshes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'x-csrf-token': 'development-csrf',
        },
        body: JSON.stringify({ tokenBudget: 8_000 }),
      })
    ).json(),
  );
  expect(
    (newPortrait as { claims: Array<{ evidenceIds: string[] }> }).claims.flatMap(
      (claim) => claim.evidenceIds,
    ),
  ).not.toContain(referencedEvidenceId);
  const oldAfterRetraction = await page.evaluate(
    async (versionId) => (await fetch(`/api/v1/portraits/${versionId}`)).json(),
    oldVersion.versionId,
  );
  expect(oldAfterRetraction).toEqual(oldPortrait);
});
