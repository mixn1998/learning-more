import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import type { CandidateEvidence } from '../../apps/server/src/modules/profile-evidence/interface.js';
import { DataRoot } from '../../apps/server/src/persistence/data-root.js';
import { createLocalFileEvidenceRepositories } from '../../apps/server/src/persistence/profile-evidence-repositories.js';
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
  const completeAssessment = page.getByRole('button', { name: '完成评估' });
  await page.getByLabel('补充需求').fill('Two independent lessons');
  await expect(completeAssessment).toBeEnabled();
  await completeAssessment.click();
  await page.getByLabel('补充需求').fill('Keep both lessons practical');
  await expect(completeAssessment).toBeEnabled();
  await completeAssessment.click();
  await page.getByRole('button', { name: '生成候选大纲' }).click();
  const failure = page.getByRole('alert');
  const candidate = page.getByRole('heading', { name: /候选大纲/ });
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

async function completeLesson(page: Page, courseId: string, lessonId: string) {
  await page.goto(`/lessons/${lessonId}`);
  await page.getByRole('button', { name: '开始学习' }).click();
  const input = page.getByLabel('学习输入');
  const assistantMessages = page.getByRole('article', { name: 'AI 导师' });
  await expect(assistantMessages.last()).toContainText('我们从你刚才的问题继续');
  await expect(input).toBeEnabled();
  const openingMessageCount = await assistantMessages.count();
  await input.fill(`Complete independent lesson ${lessonId}`);
  await page.getByRole('button', { name: '发送' }).click();
  await expect(assistantMessages).toHaveCount(openingMessageCount + 1);
  await expect(assistantMessages.last()).toContainText('我们从你刚才的问题继续');
  await expect(page.getByRole('button', { name: '停止生成' })).toBeHidden();
  for (const answer of ['Apply the idea', 'My integrated answer', 'No other questions']) {
    const messageCount = await assistantMessages.count();
    await input.fill(answer);
    await page.getByRole('button', { name: '发送' }).click();
    await expect(assistantMessages).toHaveCount(messageCount + 1);
    await expect(input).toBeEnabled();
  }
  await page.getByRole('button', { name: '结束本课' }).click();
  const completeLessonButton = page.getByRole('button', { name: '完成本课' });
  await expect(completeLessonButton).toBeEnabled();
  await completeLessonButton.click();
  await expect(page).toHaveURL(`/courses/${courseId}`);
}

test('generates evidence-backed portraits and keeps old versions auditable after retraction', async ({
  page,
}) => {
  const firstCourse = await createCourse(page);
  const secondCourse = await createCourse(page);
  expect(firstCourse.lessonIds).toHaveLength(2);
  expect(secondCourse.lessonIds).toHaveLength(2);
  await completeLesson(page, firstCourse.id, firstCourse.lessonIds[0]!);
  await completeLesson(page, secondCourse.id, secondCourse.lessonIds[0]!);

  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: '学习画像', exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const response = await fetch('/api/v1/portrait-evidence?pageSize=100');
          if (!response.ok) return 0;
          const payload = (await response.json()) as {
            entries: Array<{ evidenceId: string; sourceGroup: string; status: string }>;
          };
          return payload.entries.filter(
            (entry) =>
              entry.evidenceId.startsWith('evidence_checkpoint_') &&
              entry.sourceGroup === 'review' &&
              entry.status === 'active',
          ).length;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: /刷新(?:学习)?画像/ }).click();
  await expect(page.locator('.portrait-insight-card').first()).toBeVisible();
  const evidenceChains = page.locator('.portrait-evidence-chain');
  expect(await evidenceChains.count()).toBeGreaterThan(0);
  await evidenceChains.first().locator('summary').click();
  await expect(evidenceChains.first()).toHaveAttribute('open', '');
  expect(
    await evidenceChains.first().locator('.portrait-evidence-node').count(),
  ).toBeGreaterThanOrEqual(2);

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
  )!.data as CandidateEvidence;
  const dataRoot = DataRoot.create(dataDirectory);
  const evidence = createLocalFileEvidenceRepositories(dataRoot).evidence;
  await createUnitOfWork({ dataRoot }).execute(
    { transactionId: `tx_retraction_${randomUUID()}` },
    (tx) =>
      evidence.save(
        tx,
        { ...referencedCandidate, status: 'retracted' },
        referencedCandidate.resourceVersion,
      ),
  );
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
