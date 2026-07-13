import path from 'node:path';

import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(process.cwd(), '.playwright-browsers');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'runtime-*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
});
