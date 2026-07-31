import { expect, test } from '@playwright/test';

const reactBaseUrl = 'http://127.0.0.1:61587';

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const componentStates = [
  {
    id: 'runtime-status',
    reactPath: '/__visual/ui-components',
    locator: '.lm-global-runtime',
  },
  {
    id: 'semantic-status',
    reactPath: '/__visual/ui-components',
    locator: '.demo:nth-of-type(2)',
  },
  {
    id: 'course-mode-token',
    reactPath: '/__visual/course-modes',
    locator: '.token:first-child',
  },
  {
    id: 'authoring-assessment-panel',
    reactPath: '/__visual/authoring-standard',
    locator: '.ow-panel:first-child',
  },
  {
    id: 'authoring-outline-panel',
    reactPath: '/__visual/authoring-standard',
    locator: '.ow-panel:last-child',
  },
] as const;

test.describe('Design-system key components stay within the 0.1% gate', () => {
  for (const state of componentStates) {
    for (const viewport of viewports) {
      test(`${state.id} ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${reactBaseUrl}${state.reactPath}`, { waitUntil: 'networkidle' });
        await expect(page.locator('[data-visual-ready="true"]')).toBeVisible();
        await page.addStyleTag({
          content:
            '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
        });
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator(state.locator)).toHaveScreenshot(
          `component-${state.id}-${viewport.name}.png`,
          {
            animations: 'disabled',
            maxDiffPixelRatio: 0.001,
            threshold: 0.15,
          },
        );
      });
    }
  }
});
