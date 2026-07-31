import { expect, test, type Page } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:61587/__visual/chat-components';

async function openFixture(page: Page) {
  await page.goto(fixtureUrl, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-visual-ready="true"]')).toBeVisible();
}

test.describe('shared chat components', () => {
  test('right-aligns short messages horizontally and preserves explicit newlines', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openFixture(page);

    const stream = page.getByRole('log', { name: '会话组件视觉验证' });
    const shortRow = stream.locator('[data-message-id="short"]');
    const shortBubble = shortRow.locator('.chat-user-bubble');
    const multilineBubble = stream
      .locator('[data-message-id="multiline"]')
      .locator('.chat-user-bubble');
    const [rowBox, shortBox, multilineBox] = await Promise.all([
      shortRow.boundingBox(),
      shortBubble.boundingBox(),
      multilineBubble.boundingBox(),
    ]);

    expect(rowBox).not.toBeNull();
    expect(shortBox).not.toBeNull();
    expect(multilineBox).not.toBeNull();
    expect(Math.abs(rowBox!.x + rowBox!.width - (shortBox!.x + shortBox!.width))).toBeLessThan(1);
    expect(shortBox!.height).toBeLessThan(60);
    expect(multilineBox!.height).toBeGreaterThan(shortBox!.height);
    await expect(multilineBubble).toHaveText('第一行\n第二行仍然完整显示');
    expect(
      await shortBubble.evaluate((element) => ({
        overflowWrap: getComputedStyle(element).overflowWrap,
        whiteSpace: getComputedStyle(element).whiteSpace,
        writingMode: getComputedStyle(element).writingMode,
      })),
    ).toEqual({ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', writingMode: 'horizontal-tb' });
  });

  test('keeps long content inside the mobile viewport and submits through the composer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixture(page);

    const longBubble = page.locator('[data-message-id="long"] .chat-user-bubble');
    const box = await longBubble.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);

    const input = page.getByLabel('会话输入');
    await input.fill('移动端\n换行输入');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.locator('[data-message-id="submitted"] .chat-user-bubble')).toHaveText(
      '移动端\n换行输入',
    );
    await expect(input).toHaveValue('');
  });
});
