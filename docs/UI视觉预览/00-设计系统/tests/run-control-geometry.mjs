import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(testsDir, '..', '..');
const base = 'http://127.0.0.1:61586';
const viewports = [
  ['desktop', { width: 1440, height: 1000 }],
  ['tablet', { width: 1024, height: 768 }],
  ['mobile', { width: 390, height: 844 }],
];

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
  for (const [viewportName, viewport] of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
    const malformed = await page.locator('.lm-btn,.lm-pill,.lm-tab,.history-tab,.pf-btn,.rc-btn').evaluateAll((nodes) => nodes.flatMap((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) return [];
      const issues = [];
      if (rect.height > 72) issues.push(`height=${Math.round(rect.height)}`);
      if (node.scrollHeight > node.clientHeight + 3) issues.push(`text-overflow=${node.scrollHeight}/${node.clientHeight}`);
      return issues.length ? [{ text: node.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), className: node.className, issues }] : [];
    }));
    malformed.forEach((item) => failures.push(`${relative} [${viewportName}] “${item.text}” ${item.issues.join(', ')} (${item.className})`));
    await page.close();
  }
}

await browser.close();
if (failures.length) {
  console.error(`Control geometry failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Control geometry passed: ${files.length} pages × ${viewports.length} viewports`);
