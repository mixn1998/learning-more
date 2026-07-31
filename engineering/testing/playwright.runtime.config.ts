import path from 'node:path';

import { defineConfig } from '@playwright/test';

const root = process.cwd();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, '.local/cache/playwright');

export default defineConfig({
  testDir: path.join(root, 'engineering/tests/e2e'),
  testMatch: 'runtime-*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  outputDir: '.local/artifacts/playwright/runtime-results',
  reporter: [['list'], ['json', { outputFile: '.local/artifacts/tests/playwright-runtime.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
});
