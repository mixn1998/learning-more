import { spawn } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const dataRoot = path.join(process.cwd(), 'tests', '.tmp', 'course-authoring-data');
const processFile = path.join(process.cwd(), 'tests', '.tmp', 'e2e-processes.json');

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

async function createCourse(page: Page) {
  await page.goto('/courses/new');
  await page.getByLabel('学习主题').fill('Planning history course');
  await page.getByRole('button', { name: '开始创建' }).click();
  await page.getByLabel('补充需求').fill('Two lessons');
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
  const courses = await aggregateDocuments('courses');
  return courses.find((document) => document.data.id === courseId)!.data as {
    id: string;
    lessonIds: string[];
  };
}

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
  throw new Error(`Timed out waiting for server ${expectedUp ? 'up' : 'down'}`);
}

async function restartServer(now?: string) {
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
      env: {
        ...process.env,
        LEARNING_MORE_DATA_ROOT: dataRoot,
        ...(now === undefined ? {} : { LEARNING_MORE_NOW: now }),
      },
    },
  );
  server.unref();
  if (server.pid === undefined) throw new Error('Failed to restart E2E server');
  await writeFile(processFile, JSON.stringify({ server: server.pid, web: processes.web }), 'utf8');
  await waitFor('http://127.0.0.1:43120/api/v1/runtime/ready', true);
}

test('[EQ-SCH-02] creates manual and plan-flow schedules, then rebuilds identical history views', async ({
  page,
}) => {
  const course = await createCourse(page);
  const [manualLessonId, plannedLessonId] = course.lessonIds;
  expect(manualLessonId).toBeDefined();
  expect(plannedLessonId).toBeDefined();

  await page.goto('/planning');
  await page.getByLabel('课程 ID', { exact: true }).fill(course.id);
  await page.getByLabel('课节 ID', { exact: true }).fill(manualLessonId!);
  await page.getByLabel('开始时间').fill('2026-07-16T19:00');
  await page.getByLabel('结束时间').fill('2026-07-16T20:00');
  await page.getByRole('button', { name: '创建手工排期' }).click();
  await expect(page.getByRole('cell', { name: manualLessonId! })).toBeVisible();

  await page.getByLabel('计划课程 ID').fill(course.id);
  await page.getByLabel('计划课节 ID').fill(plannedLessonId!);
  await page.getByRole('button', { name: '生成计划预览' }).click();
  await expect(page.getByText('预览不会修改正式排期')).toBeVisible();
  await page.getByRole('button', { name: '确认计划流' }).click();
  await expect(page.getByRole('cell', { name: plannedLessonId! })).toBeVisible();

  await page.goto(`/lessons/${manualLessonId}`);
  await page.getByRole('button', { name: '开始学习' }).click();
  await page.getByLabel('学习输入').fill('Complete this planned lesson');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeHidden();
  await page.getByRole('button', { name: '结束本课' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.goto('/history');
  await expect(page.getByRole('heading', { name: '学习历史' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: '完成课节' }).filter({ hasText: manualLessonId! }),
  ).toBeVisible();
  const before = await page.evaluate(async () =>
    (await fetch('/api/v1/history?pageSize=100')).json(),
  );
  const weekly = await page.evaluate(async () =>
    (await fetch('/api/v1/history/weeks/2026-W29')).json(),
  );
  expect(
    (weekly as { week: { completedLessonCount: number } }).week.completedLessonCount,
  ).toBeGreaterThanOrEqual(1);

  await rm(path.join(dataRoot, 'read-models', 'learning-facts'), { recursive: true, force: true });
  await restartServer('2026-07-18T16:00:00.000Z');
  const after = await page.evaluate(async () =>
    (await fetch('/api/v1/history?pageSize=100')).json(),
  );
  expect(
    (after as { entries: Array<{ factId: string }> }).entries.map((entry) => entry.factId),
  ).toEqual(
    (before as { entries: Array<{ factId: string }> }).entries.map((entry) => entry.factId),
  );
  const report = await page.evaluate(async () =>
    (await fetch('/api/v1/weekly-reports/2026-W29')).json(),
  );
  const finalizedReport = report as {
    state: string;
    factSnapshot: Array<{ lessonId?: string }>;
  };
  expect(finalizedReport.state).toBe('finalized');
  expect(finalizedReport.factSnapshot).toEqual(
    expect.arrayContaining([expect.objectContaining({ lessonId: manualLessonId })]),
  );
  await page.goto('/history');
  await expect(page.getByText('周报已冻结')).toBeVisible();
  await expect(page.getByText(/本周完成 \d+ 个课节/)).toBeVisible();
});
