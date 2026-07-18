import { expect, test } from '@playwright/test';

const reactVisualBaseUrl = 'http://127.0.0.1:61587';

test('formal-course math plots load the lazy runtime and render real SVG boards', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 1800 });
  await page.goto(`${reactVisualBaseUrl}/__visual/math-plot`, { waitUntil: 'networkidle' });

  const plots = page.locator('.lm-math-plot');
  await expect(plots).toHaveCount(3);
  await expect(page.locator('.lm-math-plot-loading')).toHaveCount(0);
  await expect(page.locator('.lm-math-plot-runtime-fallback')).toHaveCount(0);
  await expect(page.locator('.lm-math-plot-board svg')).toHaveCount(3);
  expect(await page.locator('.lm-math-plot-board svg path').count()).toBeGreaterThan(10);
  expect(
    await page.locator('.lm-math-plot-board').evaluateAll((boards) =>
      boards.every((board) => {
        const svg = board.querySelector('svg');
        return svg !== null && svg.getBoundingClientRect().width > 300 && svg.childElementCount > 5;
      }),
    ),
  ).toBe(true);
  expect(pageErrors).toEqual([]);
});
