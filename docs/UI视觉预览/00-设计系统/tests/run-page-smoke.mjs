import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const base = 'http://127.0.0.1:61586';
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(testsDir, '..', '..');
function walkHtml(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkHtml(target);
    return entry.isFile() && entry.name.endsWith('.html') ? [target] : [];
  });
}
const targets = fs.readdirSync(uiRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^0[0-7]-/.test(entry.name))
  .flatMap((entry) => walkHtml(path.join(uiRoot, entry.name)))
  .map((file) => {
    const relative = path.relative(uiRoot, file);
    const route = `/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
    return [relative, route];
  });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const failures = [];

for (const [name, route] of targets) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  const visibleHidden = await page.evaluate(() => [...document.querySelectorAll('[hidden]')]
    .filter((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })
    .map((node) => `${node.tagName.toLowerCase()}#${node.id}.${node.className}`));
  if (visibleHidden.length) failures.push(`${name}: hidden 元素仍可见 (${visibleHidden.join(', ')})`);
  const bodyText = await page.locator('body').innerText();
  if (/固定大弹窗四步向导|点击顶部步骤或使用底部按钮切换|当前模式只提供整体体验语境/.test(bodyText)) {
    failures.push(`${name}: 页面仍显示样稿/策略说明`);
  }
  if (name.endsWith('计划流向导与管理.html')) {
    if (!(await page.locator('#pf-wizard-view').isVisible())) failures.push('计划流: 向导初始态未显示');
    if (await page.locator('#pf-management-view').isVisible()) failures.push('计划流: 管理态被提前同时展示');
  }
  if (!name.startsWith('00-设计系统') && !(await page.evaluate(() => Boolean(window.SampleUI)))) failures.push(`${name}: SampleUI 未加载`);
  if (errors.length) failures.push(`${name}: ${errors.join(' | ')}`);
  await page.close();
}

await browser.close();
if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Page smoke passed: ${targets.length} pages`);
