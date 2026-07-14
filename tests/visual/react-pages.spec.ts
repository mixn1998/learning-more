import { expect, test } from '@playwright/test';

import { VISUAL_SAMPLE_STATES } from './sample-state-map.js';

const reactVisualBaseUrl = 'http://127.0.0.1:61587';

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const migratedStateIds = [
  'ui-components',
  'course-modes',
  'home',
  'authoring-standard',
  'authoring-brainstorm',
  'authoring-argument',
  'authoring-case',
  'authoring-business',
  'authoring-process',
  'authoring-decision',
  'authoring-cross',
  'authoring-reading',
  'course-active',
  'course-revision',
  'course-closed',
  'course-lifecycle-confirm',
  'course-review',
  'planning',
  'plan-flow',
  'history',
  'calendar',
  'weekly-report',
  'portrait',
  'runtime',
  'lesson-preview',
  'lesson-abandoned',
  'lesson-session',
  'lesson-review-dialog',
  'lesson-record',
] as const;

test.describe('React pages match the approved HTML samples', () => {
  for (const stateId of migratedStateIds) {
    const state = VISUAL_SAMPLE_STATES.find((candidate) => candidate.id === stateId);
    if (state === undefined) {
      throw new Error(`Missing visual sample state: ${stateId}`);
    }

    for (const viewport of viewports) {
      test(`${state.id} ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${reactVisualBaseUrl}/__visual/${encodeURIComponent(state.fixture)}`, {
          waitUntil: 'networkidle',
        });
        await expect(page.locator('[data-visual-ready="true"]')).toBeVisible();
        await page.addStyleTag({
          content:
            '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
        });
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await expect(page).toHaveScreenshot(`${state.id}-${viewport.name}.png`, {
          animations: 'disabled',
          fullPage: true,
          maxDiffPixelRatio: 0.003,
          threshold: 0.15,
        });
      });
    }
  }
});
