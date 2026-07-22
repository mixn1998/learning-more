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

  test('structured lesson Review keeps prose inside one reading column', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${reactVisualBaseUrl}/__visual/lesson-review-dialog`, {
      waitUntil: 'networkidle',
    });
    await expect(page.locator('[data-visual-ready="true"]')).toBeVisible();

    await page.locator('.lesson-review-scroll').evaluate((container) => {
      const nodes = [
        '宽泛研究题目',
        '识别决策者与决策用途',
        '明确目标市场和时间范围',
        '列出可执行方案',
        '区分结果目标与硬约束',
        '先按硬约束筛选',
        '再按结果目标优选',
      ];
      container.innerHTML = `
        <article class="structured-review">
          <section>
            <h2>知识图谱</h2>
            <div class="review-knowledge-map">
              <ol class="review-knowledge-chain">
                ${nodes.map((node) => `<li>${node}</li>`).join('')}
              </ol>
            </div>
          </section>
          <section>
            <h2>核心思想</h2>
            <div class="lm-ai-content">
              <p>本课要解决的问题，是“研究是否扩张”无法直接支持行动：它没有说明谁要在什么时间、针对哪个市场、从哪些方案中做选择，也没有把增长诉求和现金流安全转化为明确的决策规则。</p>
            </div>
          </section>
        </article>`;
    });

    const layout = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('.lesson-review-scroll')!;
      const review = document.querySelector<HTMLElement>('.structured-review')!;
      const paragraph = review.querySelector<HTMLElement>('p')!;
      const chain = review.querySelector<HTMLElement>('.review-knowledge-chain')!;
      return {
        viewportClientWidth: viewport.clientWidth,
        viewportScrollWidth: viewport.scrollWidth,
        reviewWidth: review.getBoundingClientRect().width,
        paragraphWidth: paragraph.getBoundingClientRect().width,
        chainClientWidth: chain.clientWidth,
        chainScrollWidth: chain.scrollWidth,
      };
    });

    expect(layout.viewportScrollWidth).toBe(layout.viewportClientWidth);
    expect(layout.reviewWidth).toBeLessThanOrEqual(820);
    expect(layout.paragraphWidth).toBeLessThanOrEqual(layout.reviewWidth);
    expect(layout.chainScrollWidth).toBeGreaterThan(layout.chainClientWidth);
  });
});
