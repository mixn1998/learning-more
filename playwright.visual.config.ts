import path from 'node:path';

import { defineConfig } from '@playwright/test';

const root = process.cwd();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, '.playwright-browsers');
const externalServers = process.env.LM_VISUAL_EXTERNAL_SERVERS === '1';

export default defineConfig({
  testDir: './tests/visual',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'artifacts/visual/report' }]],
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:61586',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    },
  },
  webServer: externalServers
    ? undefined
    : [
        {
          command: 'node "docs/UI视觉预览/00-设计系统/tests/serve-ui-samples.mjs"',
          port: 61_586,
          reuseExistingServer: true,
          timeout: 15_000,
        },
        {
          command: 'corepack pnpm --filter @learning-more/web dev:visual',
          port: 61_587,
          reuseExistingServer: true,
          timeout: 30_000,
        },
      ],
});
