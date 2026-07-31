import { expect, test } from '@playwright/test';

import { VISUAL_SAMPLE_STATES } from './sample-state-map.js';

const reactVisualBaseUrl = 'http://127.0.0.1:61587';

type AccessibilityAudit = Readonly<{
  failures: readonly string[];
  focus: Readonly<{
    tag: string;
    name: string;
    indicator: boolean;
  }>;
  reducedMotionFailures: readonly string[];
}>;

test.describe('React accessibility release gate', () => {
  for (const state of VISUAL_SAMPLE_STATES) {
    test(`${state.id} has keyboard, ARIA, reduced-motion, and 200% zoom coverage`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${reactVisualBaseUrl}/__visual/${encodeURIComponent(state.fixture)}`, {
        waitUntil: 'networkidle',
      });
      await expect(page.locator('[data-visual-ready="true"]')).toBeVisible();

      await page.keyboard.press('Tab');
      const audit = await page.evaluate<AccessibilityAudit>(() => {
        const failures: string[] = [];
        const visible = (element: Element) => {
          const html = element as HTMLElement;
          const style = getComputedStyle(html);
          const rect = html.getBoundingClientRect();
          return (
            !html.hidden &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const text = (element: Element) =>
          (element.getAttribute('aria-label') ?? element.textContent ?? '')
            .replace(/\s+/gu, ' ')
            .trim();

        for (const [index, tablist] of [
          ...document.querySelectorAll('[role="tablist"]'),
        ].entries()) {
          const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
          const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
          if (selected.length !== 1)
            failures.push(`tablist ${index} must have exactly one selected tab`);
          for (const tab of tabs) {
            const controls = tab.getAttribute('aria-controls');
            const panel = controls === null ? null : document.getElementById(controls);
            if (tab.id === '') failures.push(`tab ${text(tab)} has no id`);
            if (panel === null) failures.push(`tab ${text(tab)} has no controlled panel`);
            else {
              if (panel.getAttribute('role') !== 'tabpanel') {
                failures.push(`tab ${text(tab)} target is not a tabpanel`);
              }
              if (panel.getAttribute('aria-labelledby') !== tab.id) {
                failures.push(`tabpanel for ${text(tab)} is not labelled by its tab`);
              }
            }
            const active = tab.getAttribute('aria-selected') === 'true';
            if (tab.tabIndex !== (active ? 0 : -1)) {
              failures.push(`tab ${text(tab)} has an invalid roving tabindex`);
            }
          }
        }

        for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
          if (dialog.getAttribute('aria-modal') !== 'true') failures.push('dialog is not modal');
          const labelledBy = dialog.getAttribute('aria-labelledby');
          if (
            dialog.getAttribute('aria-label') === null &&
            (labelledBy === null || document.getElementById(labelledBy) === null)
          ) {
            failures.push('dialog has no valid accessible label');
          }
          if (visible(dialog) && !dialog.contains(document.activeElement)) {
            failures.push('open dialog does not contain focus');
          }
        }

        for (const control of document.querySelectorAll<HTMLElement>('input, textarea, select')) {
          if (!visible(control) || control.hasAttribute('disabled')) continue;
          const named =
            (control instanceof HTMLInputElement ||
              control instanceof HTMLTextAreaElement ||
              control instanceof HTMLSelectElement) &&
            ((control.labels?.length ?? 0) > 0 ||
              control.hasAttribute('aria-label') ||
              control.hasAttribute('aria-labelledby'));
          if (!named)
            failures.push(
              `${control.tagName.toLowerCase()}#${control.id || '(no-id)'} has no label`,
            );
        }

        for (const image of document.querySelectorAll<HTMLImageElement>('img')) {
          if (!image.hasAttribute('alt')) failures.push(`image ${image.src} has no alt attribute`);
        }

        const active = document.activeElement as HTMLElement | null;
        const activeStyle = active === null ? undefined : getComputedStyle(active);
        const indicator =
          activeStyle !== undefined &&
          ((activeStyle.outlineStyle !== 'none' &&
            Number.parseFloat(activeStyle.outlineWidth) > 0) ||
            activeStyle.boxShadow !== 'none');
        const focus = {
          tag: active?.tagName.toLowerCase() ?? 'none',
          name: active === null ? '' : text(active),
          indicator,
        };
        if (active === null || active === document.body)
          failures.push('keyboard Tab did not move focus');
        if (!indicator)
          failures.push(`focused ${focus.tag} ${focus.name} has no visible indicator`);

        const reducedMotionFailures = [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(visible)
          .flatMap((element) => {
            const style = getComputedStyle(element);
            const animation = Math.max(
              ...style.animationDuration
                .split(',')
                .map((part) =>
                  part.trim().endsWith('ms')
                    ? Number.parseFloat(part)
                    : Number.parseFloat(part) * 1000,
                ),
            );
            const transition = Math.max(
              ...style.transitionDuration
                .split(',')
                .map((part) =>
                  part.trim().endsWith('ms')
                    ? Number.parseFloat(part)
                    : Number.parseFloat(part) * 1000,
                ),
            );
            return animation > 0.02 || transition > 0.02
              ? [
                  `${element.tagName.toLowerCase()}.${element.className}: ${animation}/${transition}ms`,
                ]
              : [];
          });

        return { failures, focus, reducedMotionFailures };
      });

      expect(audit.failures).toEqual([]);
      expect(audit.reducedMotionFailures).toEqual([]);

      await page.setViewportSize({ width: 720, height: 500 });
      await page.waitForTimeout(50);
      const zoomOverflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(
        zoomOverflow.scrollWidth,
        `200% zoom equivalent overflowed ${zoomOverflow.scrollWidth - zoomOverflow.clientWidth}px`,
      ).toBeLessThanOrEqual(zoomOverflow.clientWidth + 1);
    });
  }
});
