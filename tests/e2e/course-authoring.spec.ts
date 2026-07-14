import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const dataRoot = path.join(process.cwd(), 'tests', '.tmp', 'course-authoring-data');

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

test('recovers a failed generation, confirms the second candidate version, and survives refresh', async ({
  page,
}) => {
  await page.goto('/courses/new');
  await page.getByLabel('学习主题').fill('Probability');
  await page.getByRole('button', { name: '开始创建' }).click();
  await expect(page).toHaveURL(/outlineSessionId=/);
  const sessionUrl = page.url();

  await page.getByLabel('补充需求').fill('Include Bayesian inference');
  await page.getByRole('button', { name: '完成评估' }).click();
  await page.getByLabel('补充需求').fill('I want to apply it to real decisions');
  await page.getByRole('button', { name: '完成评估' }).click();
  await page.getByRole('button', { name: '生成候选大纲' }).click();
  await expect(page.getByRole('alert')).toContainText('生成中断，草稿已保留');

  await page.getByRole('button', { name: '重试生成' }).click();
  await expect(page.getByRole('heading', { name: 'Candidate outline 2' })).toBeVisible();
  await page.getByRole('button', { name: '生成新版本' }).click();
  await expect(page.getByRole('heading', { name: 'Candidate outline 3' })).toBeVisible();

  await page.getByRole('button', { name: '确认此候选' }).click();
  await page.getByRole('button', { name: '确认创建课程' }).click();
  await expect(page).toHaveURL(/\/courses\/course_/);
  const courseId = page.url().split('/').at(-1)!;

  await page.goto(sessionUrl);
  await page.reload();
  await expect(page.getByText(courseId, { exact: true })).toBeVisible();

  const [courseDocument] = await aggregateDocuments('courses');
  expect(courseDocument).toBeDefined();
  const course = courseDocument!.data as {
    id: string;
    outlineVersionId: string;
    lessonIds: string[];
  };
  expect(course.id).toBe(courseId);
  const outlines = await aggregateDocuments('outline-versions');
  expect(outlines.map((document) => document.data.id)).toContain(course.outlineVersionId);
  const lessons = await aggregateDocuments('lesson-definitions');
  const lessonById = new Map(lessons.map((document) => [document.data.id, document.data]));
  expect(course.lessonIds.map((lessonId) => lessonById.get(lessonId)?.semanticKey)).toEqual([
    'probability-space',
    'random-variable',
  ]);
  const sessions = await aggregateDocuments('outline-sessions');
  expect(sessions[0]?.data).toMatchObject({
    session: { confirmedCourseId: courseId, state: 'confirmed' },
  });
});
