import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(testsDir, '..', '..');
const base = 'http://127.0.0.1:61586';
const signal = /点击|关闭|返回|进入后|确认后|不会|只用于|只提供|可以|支持|请先|先了解|用于|建议|需要|将会|将在|选择后/;

function walkHtml(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkHtml(target);
    return entry.isFile() && entry.name.endsWith('.html') ? [target] : [];
  });
}

const files = fs.readdirSync(uiRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^0[1-7]-/.test(entry.name))
  .flatMap((entry) => walkHtml(path.join(uiRoot, entry.name)));
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });

for (const file of files) {
  const relative = path.relative(uiRoot, file);
  const route = `/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  const candidates = await page.locator('p, small, .subtitle, .lm-kicker, .ow-note, .nav-inherit, footer span').evaluateAll((nodes) =>
    [...new Set(nodes.filter((node) => {
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).map((node) => node.textContent.trim()).filter(Boolean))]
  );
  const matched = candidates.filter((text) => signal.test(text));
  if (matched.length) {
    console.log(`\n[${relative}]`);
    matched.forEach((text) => console.log(`- ${text}`));
  }
  await page.close();
}

await browser.close();
