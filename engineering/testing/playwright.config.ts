import path from 'node:path';

import { defineConfig } from '@playwright/test';

import { resolveE2eEnvironment } from '../tests/support/e2e-environment.js';

const root = process.cwd();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, '.local/cache/playwright');
const environment = resolveE2eEnvironment();

export default defineConfig({
  testDir: path.join(root, 'engineering/tests/e2e'),
  testIgnore: 'runtime-*.spec.ts',
  globalSetup: path.join(root, 'engineering/tests/e2e/global-setup.ts'),
  globalTeardown: path.join(root, 'engineering/tests/e2e/global-teardown.ts'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  outputDir: '.local/artifacts/playwright/results',
  reporter: [['list'], ['json', { outputFile: '.local/artifacts/tests/playwright.json' }]],
  use: {
    baseURL: environment.webBaseUrl,
    trace: 'retain-on-failure',
  },
});
