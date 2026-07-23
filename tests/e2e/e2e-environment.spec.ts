import { expect, test } from '@playwright/test';

import { resolveE2eEnvironment } from '../support/e2e-environment.js';

test('uses an isolated compatible runtime instead of a foreign local-service instance', async ({
  page,
}) => {
  const environment = resolveE2eEnvironment();
  const readiness = await fetch(`${environment.serverBaseUrl}/api/v1/runtime/ready`).then(
    (response) => response.json() as Promise<{ buildId: string }>,
  );
  expect(readiness.buildId).toBe(environment.buildId);

  await page.goto('/courses/new');
  await expect(page.getByLabel('学习主题')).toBeEnabled();
});
