import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(testsDir, '..', '..');
const base = 'http://127.0.0.1:61586';
function walkHtml(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkHtml(target);
    return entry.isFile() && entry.name.endsWith('.html') ? [target] : [];
  });
}
const files = fs.readdirSync(uiRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^0[0-7]-/.test(entry.name))
  .flatMap((entry) => walkHtml(path.join(uiRoot, entry.name)));
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const failures = [];

for (const file of files) {
  const relative = path.relative(uiRoot, file);
  const route = `/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(() => {
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function tracked(type, listener, options) {
      if (this instanceof Element) {
        const current = (this.getAttribute('data-audit-events') || '').split(' ').filter(Boolean);
        if (!current.includes(type)) current.push(type);
        this.setAttribute('data-audit-events', current.join(' '));
      }
      return original.call(this, type, listener, options);
    };
  });
  const page = await context.newPage();
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const label = (node) => (node.getAttribute('aria-label') || node.textContent || node.id || node.tagName).replace(/\s+/g, ' ').trim().slice(0, 48);
    const deadButtons = [...document.querySelectorAll('button')].filter((button) => {
      if (!visible(button) || button.disabled) return false;
      if (button.form?.method === 'dialog') return false;
      if ((button.type === 'submit' || !button.getAttribute('type')) && button.form) {
        const formEvents = (button.form.getAttribute('data-audit-events') || '').split(' ');
        if (formEvents.includes('submit') || button.form.onsubmit) return false;
      }
      const events = (button.getAttribute('data-audit-events') || '').split(' ');
      return !events.includes('click') && !button.onclick;
    }).map(label);
    const badLinks = [...document.querySelectorAll('a')].filter((link) => visible(link))
      .filter((link) => !link.getAttribute('href') || ['#', 'javascript:void(0)'].includes(link.getAttribute('href')))
      .map(label);
    return { deadButtons, badLinks };
  });
  result.deadButtons.forEach((label) => failures.push(`${relative}: 未绑定按钮“${label}”`));
  result.badLinks.forEach((label) => failures.push(`${relative}: 无有效目标链接“${label}”`));
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(`Control wiring failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Control wiring passed: ${files.length} pages`);
