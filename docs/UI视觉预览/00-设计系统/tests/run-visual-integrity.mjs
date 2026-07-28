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

function auditDom(viewportName) {
  const issues = [];
  const unique = (value) => {
    if (!issues.includes(value)) issues.push(value);
  };
  const visible = (node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const label = (node) => (node.getAttribute('aria-label') || node.textContent || node.value || node.placeholder || node.tagName)
    .replace(/\s+/g, ' ').trim().slice(0, 48);
  const hasHorizontalScroller = (node) => {
    let current = node.parentElement;
    while (current && current !== document.body) {
      const style = getComputedStyle(current);
      if (['auto', 'scroll'].includes(style.overflowX)) return true;
      current = current.parentElement;
    }
    return false;
  };
  const buttonLike = (node) => node.matches([
    'button', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]',
    'select', 'summary', '[role="button"]', '.lm-btn', '.pf-btn', '.rc-btn',
    '.history-tab', '.lm-tab', '.mode-reset'
  ].join(',')) || (node.matches('a[href]') && /(^|[-_])(btn|button|tab|action|control)([-_]|$)/i.test(node.className));
  const cardLikeControl = (node) => node.matches([
    '.day', '.week-day', '.calendar-day', '.mode-card', '.lesson', '.rc-provider',
    '.pf-course', '.pf-policy', '[data-date]', '[data-day]', '[data-mode]'
  ].join(','));

  if (document.documentElement.scrollWidth > innerWidth + 4) {
    unique(`module: page-horizontal-overflow=${document.documentElement.scrollWidth}/${innerWidth}`);
  }

  document.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,summary,[role="button"],.lm-btn,.pf-btn,.rc-btn,.history-tab,.lm-tab,.lm-pill').forEach((node) => {
    if (!visible(node) || !buttonLike(node)) return;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const text = label(node);
    const iconOnly = Boolean(node.getAttribute('aria-label')) && (node.textContent || '').trim().length <= 2;
    const minimum = viewportName === 'mobile' ? 40 : 36;

    if (rect.height + 0.5 < minimum) unique(`control: hit-height=${Math.round(rect.height)} “${text}”`);
    if (iconOnly && rect.width + 0.5 < minimum) unique(`control: hit-width=${Math.round(rect.width)} “${text}”`);
    if (!cardLikeControl(node) && !iconOnly && text.length >= 4 && rect.height > 64 && rect.width / rect.height < 2) {
      unique(`control: text-control-deformed=${Math.round(rect.width)}x${Math.round(rect.height)} “${text}”`);
    }
    if ((node.scrollWidth > node.clientWidth + 3 || node.scrollHeight > node.clientHeight + 3)
      && ['hidden', 'clip'].includes(style.overflow)) {
      unique(`control: clipped-content=${node.scrollWidth}/${node.clientWidth}x${node.scrollHeight}/${node.clientHeight} “${text}”`);
    }
    if ((rect.left < -2 || rect.right > innerWidth + 2) && !hasHorizontalScroller(node)) {
      unique(`control: outside-viewport=${Math.round(rect.left)}..${Math.round(rect.right)} “${text}”`);
    }
  });

  document.querySelectorAll('.lm-actions,.hero-actions,.dialog-actions,.review-dialog-actions,.toolbar,.week-controls,.history-tabs,.lm-tabs,.pf-footer,.rc-actions').forEach((group) => {
    if (!visible(group)) return;
    const controls = [...group.querySelectorAll(':scope > button,:scope > a[href],:scope > .lm-btn,:scope > .pf-btn,:scope > .rc-btn,:scope > .lm-tab,:scope > .history-tab')]
      .filter(visible);
    const rows = new Map();
    controls.forEach((control) => {
      const rect = control.getBoundingClientRect();
      const key = Math.round(rect.top / 4) * 4;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(rect.height);
    });
    rows.forEach((heights) => {
      if (heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 12) {
        unique(`control: action-row-height-drift=${heights.map(Math.round).join('/')}`);
      }
    });
  });

  const moduleSelector = [
    'main', 'section', 'article', '.lm-card', '.home-hero', '.hero', '.main-head', '.schedule-head',
    '.review-dialog', '.nav-modal', '.pf-dialog', '.rc-panel', '.ow-panel', '.workspace-main',
    '.workspace-side', '.insight-card', '.review-card', '.calendar-panel', '.portrait-summary'
  ].join(',');
  document.querySelectorAll(moduleSelector).forEach((node) => {
    if (!visible(node)) return;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    if (rect.width > innerWidth + 4 && !hasHorizontalScroller(node)) {
      unique(`module: wider-than-viewport=${Math.round(rect.width)} ${node.className || node.tagName}`);
    }
    if (['hidden', 'clip'].includes(style.overflowX) && node.scrollWidth > node.clientWidth + 4) {
      unique(`module: clipped-x=${node.scrollWidth}/${node.clientWidth} ${node.className || node.tagName}`);
    }
    if (['hidden', 'clip'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 4) {
      unique(`module: clipped-y=${node.scrollHeight}/${node.clientHeight} ${node.className || node.tagName}`);
    }
  });

  document.querySelectorAll('.lm-card,.home-hero,.hero,.main-head,.schedule-head,.review-dialog,.nav-modal,.pf-dialog,.rc-panel,.ow-panel,.insight-card,.review-card').forEach((parent) => {
    if (!visible(parent)) return;
    const style = getComputedStyle(parent);
    if (['contents', 'inline'].includes(style.display)) return;
    const rect = parent.getBoundingClientRect();
    const contentLeft = rect.left + parent.clientLeft + parseFloat(style.paddingLeft || 0);
    const contentRight = rect.right - parent.clientLeft - parseFloat(style.paddingRight || 0);
    [...parent.children].filter(visible).forEach((child) => {
      const childStyle = getComputedStyle(child);
      if (['absolute', 'fixed'].includes(childStyle.position) || hasHorizontalScroller(child)) return;
      const childRect = child.getBoundingClientRect();
      if (childRect.left < contentLeft - 5 || childRect.right > contentRight + 5) {
        unique(`module: child-outside-content “${label(child)}” in ${parent.className || parent.tagName}`);
      }
    });
  });

  const textSelector = 'h1,h2,h3,h4,p,small,label,button,a,.lm-pill,.lm-kicker,.lm-tab,input,textarea,select,li';
  document.querySelectorAll(textSelector).forEach((node) => {
    if (!visible(node)) return;
    const style = getComputedStyle(node);
    const size = parseFloat(style.fontSize);
    const line = parseFloat(style.lineHeight);
    const text = label(node);
    if (!text) return;
    const isHeading = node.matches('h1,h2,h3,h4');
    const isControl = buttonLike(node) || node.matches('input,textarea,select');
    const minimumSize = node.matches('h1') ? 24 : node.matches('h2') ? 18 : node.matches('h3') ? 14 : node.matches('small') ? 10 : isControl ? 11 : 10;
    const minimumRatio = isHeading ? 1.1 : isControl ? 1.15 : 1.3;
    if (size + 0.1 < minimumSize) unique(`type: font-size=${size}px<${minimumSize}px “${text}”`);
    if (Number.isFinite(line) && line / size < minimumRatio) unique(`type: line-height=${(line / size).toFixed(2)} “${text}”`);
    if (Math.abs(parseFloat(style.letterSpacing)) > 3) unique(`type: letter-spacing=${style.letterSpacing} “${text}”`);
    if ((node.scrollWidth > node.clientWidth + 3 || node.scrollHeight > node.clientHeight + 3)
      && ['hidden', 'clip'].includes(style.overflow)) {
      unique(`type: clipped=${node.scrollWidth}/${node.clientWidth}x${node.scrollHeight}/${node.clientHeight} “${text}”`);
    }
  });

  document.querySelectorAll('.hero,.dialog-head,.dialog-body,.dialog-foot,.nav-head,.nav-body,.nav-foot,.review-dialog-head,.review-scroll,.review-dialog-foot').forEach((node) => {
    if (!visible(node)) return;
    const style = getComputedStyle(node);
    const left = parseFloat(style.paddingLeft);
    const right = parseFloat(style.paddingRight);
    if (Math.abs(left - right) > 4) unique(`spacing: uneven-horizontal-padding=${left}/${right} ${node.className}`);
    if (left < 10 || right < 10) unique(`spacing: thin-horizontal-padding=${left}/${right} ${node.className}`);
  });

  return issues;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});

// Prove the detector is red-capable for the exact regression families reported by the user.
const selfTest = await browser.newPage({ viewport: { width: 390, height: 844 } });
await selfTest.setContent(`
  <style>
    *{box-sizing:border-box} body{margin:0}
    .lm-actions{display:flex}
    .lm-btn{display:flex;overflow:hidden;width:72px;height:110px;font-size:16px;line-height:16px}
    .lm-card{width:520px;overflow:hidden;padding:4px 24px}
    .lm-card p{font-size:10px;line-height:10px;white-space:nowrap}
    .dialog-head{padding:4px 30px 4px 2px}
  </style>
  <div class="lm-actions"><button class="lm-btn">返回本周课程表</button><button class="lm-btn" style="height:40px">确认</button></div>
  <section class="lm-card"><p>这是会被裁切且行距过紧的模块文字</p></section>
  <header class="dialog-head">边距失衡</header>
`);
const selfTestIssues = await selfTest.evaluate(auditDom, 'mobile');
await selfTest.close();
for (const family of ['control:', 'module:', 'type:', 'spacing:']) {
  if (!selfTestIssues.some((issue) => issue.startsWith(family))) {
    await browser.close();
    throw new Error(`Visual integrity detector self-test failed: missing ${family}`);
  }
}

const failures = [];
for (const file of files) {
  const relative = path.relative(uiRoot, file);
  const route = `/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
  for (const [viewportName, viewport] of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
    const issues = await page.evaluate(auditDom, viewportName);
    issues.forEach((issue) => failures.push(`${relative} [${viewportName}] ${issue}`));
    if (relative.endsWith(`01-主页与全局导航${path.sep}主页.html`) && viewportName === 'mobile') {
      const miniStyles = await page.locator('.mini').evaluateAll((nodes) => nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          backgroundColor: style.backgroundColor,
          borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        };
      }));
      miniStyles.forEach((style, index) => {
        if (style.fontSize !== '9px' || style.lineHeight !== '9px' || style.padding.some((value) => value !== '6px')
          || style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.borderWidths.some((value) => value !== '0px')) {
          failures.push(`${relative} [${viewportName}] type: week-lesson-${index + 1} expected 9px/9px/6px transparent borderless, got ${style.fontSize}/${style.lineHeight}/${style.padding.join('/')} ${style.backgroundColor} ${style.borderWidths.join('/')}`);
        }
      });
      const agendaGap = await page.locator('.agenda').evaluate((node) => {
        const title = node.querySelector('h3');
        const firstLesson = node.querySelector('.agenda-item');
        if (!title || !firstLesson) return null;
        return firstLesson.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
      });
      if (agendaGap !== null && agendaGap < 8) {
        failures.push(`${relative} [${viewportName}] spacing: agenda-title-gap expected >=8px, got ${agendaGap.toFixed(2)}px`);
      }
    }
    if (relative.endsWith(`06-历史统计与学习画像${path.sep}学习日历.html`) && viewportName === 'desktop') {
      const courseStyles = await page.locator('.date-course').evaluateAll((nodes) => nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          backgroundColor: style.backgroundColor,
          borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        };
      }));
      courseStyles.forEach((style, index) => {
        if (style.fontSize !== '9px' || style.lineHeight !== '9px'
          || style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.borderWidths.some((value) => value !== '0px')) {
          failures.push(`${relative} [${viewportName}] type: calendar-lesson-${index + 1} expected 9px/9px transparent borderless, got ${style.fontSize}/${style.lineHeight} ${style.backgroundColor} ${style.borderWidths.join('/')}`);
        }
      });
    }
    await page.close();
  }
}

await browser.close();
if (failures.length) {
  console.error(`Visual integrity failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`Visual integrity passed: ${files.length} pages × ${viewports.length} viewports; detector self-test passed`);
