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

  const initialGeometry = await page.locator('.lm-math-plot-board').evaluateAll((boards) =>
    boards.map((board, index) => {
      const svg = board.querySelector('svg');
      svg?.setAttribute('data-stability-probe', `plot-${index}`);
      const box = board.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  await page.evaluate(() => {
    for (let index = 0; index < 12; index += 1) {
      window.dispatchEvent(new Event('lm:math-plot-fixture-rerender'));
    }
  });
  await expect(page.locator('[data-math-plot-render-version="12"]')).toBeVisible();
  await page.waitForTimeout(250);

  expect(
    await page.locator('.lm-math-plot-board svg').evaluateAll((svgs) =>
      svgs.map((svg) => svg.getAttribute('data-stability-probe')),
    ),
  ).toEqual(['plot-0', 'plot-1', 'plot-2']);
  expect(
    await page.locator('.lm-math-plot-board').evaluateAll((boards) =>
      boards.map((board) => {
        const box = board.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    ),
  ).toEqual(initialGeometry);
  expect(pageErrors).toEqual([]);
});
