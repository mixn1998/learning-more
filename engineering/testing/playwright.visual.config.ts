import path from 'node:path';

import { defineConfig } from '@playwright/test';

const root = process.cwd();
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, '.local/cache/playwright');
const externalServers = process.env.LM_VISUAL_EXTERNAL_SERVERS === '1';

export default defineConfig({
  testDir: path.join(root, 'engineering/tests/visual'),
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  outputDir: '.local/artifacts/visual/results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: '.local/artifacts/visual/report' }]],
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:61587',
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
    : {
        command: 'corepack pnpm --filter @learning-more/web dev:visual',
        port: 61_587,
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
