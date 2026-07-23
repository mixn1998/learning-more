import { expect, test } from '@playwright/test';

const htmlBaseUrl = 'http://127.0.0.1:61586';
const reactBaseUrl = 'http://127.0.0.1:61587';

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const componentStates = [
  {
    id: 'runtime-status',
    htmlPath: '00-设计系统/共享组件与状态色.html',
    reactPath: '/__visual/ui-components',
    locator: '.lm-global-runtime',
  },
  {
    id: 'semantic-status',
    htmlPath: '00-设计系统/共享组件与状态色.html',
    reactPath: '/__visual/ui-components',
    locator: '.demo:nth-of-type(2)',
  },
  {
    id: 'course-mode-token',
    htmlPath: '00-设计系统/九模式视觉身份.html',
    reactPath: '/__visual/course-modes',
    locator: '.token:first-child',
  },
  {
    id: 'authoring-assessment-panel',
    htmlPath: '02-课程创建与大纲/标准模式建档.html',
    reactPath: '/__visual/authoring-standard',
    locator: '.ow-panel:first-child',
  },
  {
    id: 'authoring-outline-panel',
    htmlPath: '02-课程创建与大纲/标准模式建档.html',
    reactPath: '/__visual/authoring-standard',
    locator: '.ow-panel:last-child',
  },
] as const;

type Source = 'html' | 'react';

const requestedSource = process.env.LM_COMPONENT_VISUAL_SOURCE;
const sources: readonly Source[] =
  requestedSource === 'html' || requestedSource === 'react' ? [requestedSource] : ['html', 'react'];

function encodedHtmlPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

test.describe('Design-system key components stay within the 0.1% gate', () => {
  for (const state of componentStates) {
    for (const viewport of viewports) {
      for (const source of sources) {
        test(`${state.id} ${viewport.name} ${source}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          const url =
            source === 'html'
              ? `${htmlBaseUrl}/${encodedHtmlPath(state.htmlPath)}`
              : `${reactBaseUrl}${state.reactPath}`;
          await page.goto(url, { waitUntil: 'networkidle' });
          if (source === 'react') {
            await expect(page.locator('[data-visual-ready="true"]')).toBeVisible();
          }
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
  }
});
