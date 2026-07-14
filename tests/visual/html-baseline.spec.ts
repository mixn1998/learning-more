import { expect, test } from '@playwright/test';

import { VISUAL_SAMPLE_STATES } from './sample-state-map.js';

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test.describe('HTML visual migration baselines', () => {
  for (const state of VISUAL_SAMPLE_STATES) {
    for (const viewport of viewports) {
      test(`${state.id} ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`/${state.htmlPath.split('/').map(encodeURIComponent).join('/')}`, {
          waitUntil: 'networkidle',
        });
        await page.addStyleTag({
          content:
            '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
        });
        await page.evaluate(async () => document.fonts.ready);
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
