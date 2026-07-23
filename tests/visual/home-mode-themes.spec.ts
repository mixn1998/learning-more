import { expect, test } from '@playwright/test';

import { COURSE_MODE_REGISTRY } from '../../apps/web/src/course-mode-registry.js';

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const nonDefaultModes = COURSE_MODE_REGISTRY.filter((mode) => mode.id !== 'standard');
const source = process.env.LM_MODE_VISUAL_SOURCE;
const targets =
  source === 'html'
    ? ([
        {
          name: 'html',
          url: '/01-%E4%B8%BB%E9%A1%B5%E4%B8%8E%E5%85%A8%E5%B1%80%E5%AF%BC%E8%88%AA/%E4%B8%BB%E9%A1%B5.html',
        },
      ] as const)
    : source === 'react'
      ? ([{ name: 'react', url: 'http://127.0.0.1:61587/__visual/home-ready' }] as const)
      : ([
          {
            name: 'html',
            url: '/01-%E4%B8%BB%E9%A1%B5%E4%B8%8E%E5%85%A8%E5%B1%80%E5%AF%BC%E8%88%AA/%E4%B8%BB%E9%A1%B5.html',
          },
          { name: 'react', url: 'http://127.0.0.1:61587/__visual/home-ready' },
        ] as const);

function hexToRgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
}

test.describe('home mode themes match the approved global palette', () => {
  for (const target of targets) {
    for (const mode of nonDefaultModes) {
      for (const viewport of viewports) {
        test(`${target.name} ${mode.id} ${viewport.name}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.goto(target.url, { waitUntil: 'networkidle' });
          await page.locator(`.mode-card[data-mode="${mode.id}"]`).click();
          await expect
            .poll(() => page.evaluate(() => document.documentElement.dataset.courseMode))
            .toBe(mode.id);
          await page.addStyleTag({
            content:
              '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
          });
          await page.evaluate(async () => document.fonts.ready);

          const palette = await page.evaluate(() => {
            const root = getComputedStyle(document.documentElement);
            const prompt = getComputedStyle(document.querySelector<HTMLElement>('.prompt-row')!);
            const primary = getComputedStyle(
              document.querySelector<HTMLElement>('.prompt-row .primary')!,
            );
            const badge = getComputedStyle(document.querySelector<HTMLElement>('.lm-mode-badge')!);
            const selected = getComputedStyle(
              document.querySelector<HTMLElement>(
                '.mode-card[aria-pressed="true"], .mode-card[aria-checked="true"]',
              )!,
            );
            return {
              accent: root.getPropertyValue('--accent').trim(),
              accentDark: root.getPropertyValue('--accent-dark').trim(),
              tint: root.getPropertyValue('--tint').trim(),
              formalAccent: root.getPropertyValue('--lm-accent').trim(),
              formalAccentDark: root.getPropertyValue('--lm-accent-dark').trim(),
              formalTint: root.getPropertyValue('--lm-tint').trim(),
              promptBorder: prompt.borderTopColor,
              primaryBackground: primary.backgroundColor,
              badgeBackground: badge.backgroundColor,
              badgeColor: badge.color,
              selectedBorder: selected.borderTopColor,
              selectedBackground: selected.backgroundColor,
            };
          });

          expect(palette).toMatchObject({
            accent: mode.accent,
            accentDark: mode.accentDark,
            tint: mode.tint,
            promptBorder: hexToRgb(mode.accent),
            primaryBackground: hexToRgb(mode.accent),
            badgeBackground: hexToRgb(mode.tint),
            badgeColor: hexToRgb(mode.accentDark),
            selectedBorder: hexToRgb(mode.accent),
            selectedBackground: hexToRgb(mode.tint),
          });
          if (target.name === 'react') {
            expect(palette).toMatchObject({
              formalAccent: mode.accent,
              formalAccentDark: mode.accentDark,
              formalTint: mode.tint,
            });
          }
          await expect(page.getByRole('button', { name: new RegExp(mode.cta) })).toBeVisible();
          await expect(page.locator('.prompt-row input')).toHaveAttribute(
            'placeholder',
            mode.placeholder,
          );
          await expect(page.locator('.prompt-row input')).toBeFocused();
          await expect(page).toHaveScreenshot(`home-mode-${mode.id}-${viewport.name}.png`, {
            animations: 'disabled',
            fullPage: true,
            maxDiffPixelRatio: 0.003,
            threshold: 0.15,
          });
        });
      }
    }
  }
});
