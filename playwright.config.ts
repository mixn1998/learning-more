import path from 'node:path';

import { defineConfig } from '@playwright/test';

import { resolveE2eEnvironment } from './tests/support/e2e-environment.js';

const root = process.cwd();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, '.playwright-browsers');
const environment = resolveE2eEnvironment();

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'runtime-*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/tests/playwright.json' }]],
  use: {
    baseURL: environment.webBaseUrl,
    trace: 'retain-on-failure',
  },
});
