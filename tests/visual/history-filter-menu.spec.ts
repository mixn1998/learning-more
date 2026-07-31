import { expect, test } from '@playwright/test';

test('history filters keep a compact custom menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:61587/__visual/history-statistics', {
    waitUntil: 'networkidle',
  });
  await expect(page.locator('[data-visual-ready="true"]')).toBeVisible();

  await page.getByRole('combobox', { name: '学科 / 领域' }).click();
  await expect(page.getByRole('listbox', { name: '学科 / 领域选项' })).toBeVisible();
  await expect
    .poll(async () =>
      page
        .locator('.history-stat-select-option')
        .evaluateAll((options) => [
          ...new Set(options.map((option) => getComputedStyle(option).fontWeight)),
        ]),
    )
    .toEqual(['400']);
  await expect
    .poll(async () =>
      page
        .locator('.history-stat-select-trigger strong')
        .evaluateAll((values) => [
          ...new Set(values.map((value) => getComputedStyle(value).fontWeight)),
        ]),
    )
    .toEqual(['400']);
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
  });
  await expect(page.locator('.history-stat-course-panel')).toHaveScreenshot(
    'history-filter-menu-open.png',
    {
      animations: 'disabled',
      maxDiffPixelRatio: 0.003,
      threshold: 0.15,
    },
  );
});
