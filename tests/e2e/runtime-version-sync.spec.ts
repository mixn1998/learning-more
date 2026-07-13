import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { removeRuntimeRoot, startLauncher, stopLauncher, waitFor } from './runtime-harness.js';

test('[EQ-SELF-02] blocks stale Web writes and rejects an invalid Launcher capability', async ({
  page,
}) => {
  const root = path.join(process.cwd(), 'tests', '.tmp', 'runtime-version-sync');
  await removeRuntimeRoot(root);
  const launcher = await startLauncher(root);
  const web = spawn(
    process.execPath,
    ['apps/web/node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts'],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, VITE_BUILD_ID: 'stale-web-build' },
    },
  );
  try {
    await waitFor(async () => {
      const response = await fetch('http://127.0.0.1:5173').catch(() => undefined);
      return response?.ok === true ? true : undefined;
    });
    await page.goto('/runtime');
    const initialGeneration = await page.evaluate(async () => {
      const readiness = (await fetch('/api/v1/runtime/ready').then((response) =>
        response.json(),
      )) as { generation?: number };
      return readiness.generation ?? 0;
    });
    await page.getByRole('button', { name: '安全重连' }).click();
    await expect(page.getByText('刷新 AI：完成')).toBeVisible();
    await expect
      .poll(async () => {
        const readiness = await fetch('http://127.0.0.1:43120/api/v1/runtime/ready').then(
          (response) => response.json() as Promise<{ generation?: number }>,
        );
        return readiness.generation ?? 0;
      })
      .toBeGreaterThan(initialGeneration);
    await page.goto('/courses/new');
    await expect(page.getByRole('alert')).toContainText('检测到新版本');
    await expect(page.getByLabel('学习主题')).toBeDisabled();
    const invalidTokenStatus = await page.evaluate(async () => {
      const response = await fetch('http://127.0.0.1:43119/control/v1/reconnect', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-learning-more-capability': 'wrong-capability',
        },
        body: '{}',
      });
      return response.status;
    });
    expect(invalidTokenStatus).toBe(403);
  } finally {
    if (web.exitCode === null) {
      const webExited = once(web, 'exit');
      web.kill();
      await webExited;
    }
    await stopLauncher(launcher).catch(() => undefined);
    await removeRuntimeRoot(root);
  }
});
