# Learning MORE React UI Transition Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 HTML 样稿短收口与冻结，建立 84 张权威视觉基线，并交付 React 设计系统、AI 内容排版、正式 App Shell 和可复用视觉测试基础。

**Architecture:** 冻结的 28 个 HTML 页面只提供迁移基线；正式 UI 由 `packages/ui` 的纯视觉原语和 `apps/web` 的 Route/Feature/ViewModel 组合。视觉测试把 HTML 迁移基线、React 长期基线和运行产物分开保存，并使用同一组锁定视口、字体和差异阈值。

**Tech Stack:** TypeScript 5.9、React 19、Vite 8、Vitest 4、Testing Library、Playwright 1.61、CSS Custom Properties、pnpm 10。

## Global Constraints

- 权威设计为 `docs/superpowers/specs/2026-07-13-react-ui-transition-design.md`；本计划只覆盖其中切片 0 与切片 1。
- HTML 清单固定为 28 页；冻结后不得新增页面、状态、交互路径或模拟业务模型。
- 固定视口为桌面 `1440×1000`、平板 `1024×768`、移动端 `390×844`，共 84 张 HTML 全页基线。
- 全页阈值固定为 `threshold: 0.15`、`maxDiffPixelRatio: 0.003`；关键组件固定为 `maxDiffPixelRatio: 0.001`。
- 权威视觉环境固定为 Windows Edge/Chromium；截图前必须确认 Times New Roman、SimSun 与 SimHei 可用。
- AI 标题使用 SimHei/黑体；AI 正文中文使用 SimSun/宋体、英文使用 Times New Roman；代码继续使用项目等宽字体。
- `packages/ui` 不得读取路由、调用 API 或持有课程业务规则；`apps/web` 不新增全局状态库。
- 不新增 UI 框架，不复制 HTML 模拟状态机，不使用 iframe 或 `dangerouslySetInnerHTML` 嵌入样稿。
- 所有写入继续走真实 API、SSE、幂等命令与版本保护；视觉 Fixture 不得进入生产业务分支。
- 当前工作区存在并行未提交改动。每个任务开始前先检查目标文件 diff，保留用户改动；每次只提交本任务列出的文件。

---

### Task 1: 固定 28 页清单并修复样稿审计运行入口

**Files:**
- Create: `tools/architecture/src/ui-sample-inventory.test.ts`
- Create: `docs/UI视觉预览/00-设计系统/tests/run-all-audits.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/report-instructional-copy.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-control-geometry.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-control-wiring.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-module-geometry.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-page-smoke.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-typography-spacing.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-visual-integrity.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: 根工作区已声明的 `@playwright/test@1.61.1` 与当前 28 个 HTML 文件。
- Produces: `pnpm ui-samples:verify`；架构测试保证页面数、删除确认页与 Playwright 依赖声明不漂移。

- [ ] **Step 1: 写出会因裸 `playwright` 导入和缺少统一脚本而失败的架构测试**

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const uiRoot = path.join(root, 'docs/UI视觉预览');
const testsRoot = path.join(uiRoot, '00-设计系统/tests');

function walkHtml(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkHtml(target);
    return entry.isFile() && entry.name.endsWith('.html') ? [target] : [];
  });
}

describe('frozen UI sample inventory', () => {
  it('contains exactly 28 pages including permanent deletion confirmation', () => {
    const pages = walkHtml(uiRoot).map((file) => path.relative(uiRoot, file).replaceAll('\\', '/'));
    expect(pages).toHaveLength(28);
    expect(pages).toContain('02-课程创建与大纲/课程永久删除确认.html');
  });

  it('uses only the declared Playwright package and exposes one audit command', () => {
    for (const file of readdirSync(testsRoot).filter((name) => name.endsWith('.mjs'))) {
      expect(readFileSync(path.join(testsRoot, file), 'utf8')).not.toMatch(
        /require\(['"]playwright['"]\)/,
      );
    }
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['ui-samples:verify']).toBe(
      'node docs/UI视觉预览/00-设计系统/tests/run-all-audits.mjs',
    );
    expect(existsSync(path.join(testsRoot, 'run-all-audits.mjs'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试并确认它先失败**

Run: `pnpm exec vitest run tools/architecture/src/ui-sample-inventory.test.ts`

Expected: FAIL，至少报告 `require('playwright')` 或 `ui-samples:verify` 不存在。

- [ ] **Step 3: 把八个浏览器脚本的运行时导入统一改为已声明包**

在上方列出的八个 `.mjs` 文件中保留 `createRequire(import.meta.url)`，只把这一行：

```js
const { chromium } = require('playwright');
```

替换为：

```js
const { chromium } = require('@playwright/test');
```

- [ ] **Step 4: 新增单一审计入口并在根脚本暴露**

```js
// docs/UI视觉预览/00-设计系统/tests/run-all-audits.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const scripts = [
  'run-ui-audit.mjs',
  'run-page-smoke.mjs',
  'run-control-wiring.mjs',
  'run-control-geometry.mjs',
  'run-module-geometry.mjs',
  'run-typography-spacing.mjs',
  'run-visual-integrity.mjs',
  'run-interaction-regression.mjs',
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(directory, script)], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
```

在 `package.json` 的 `scripts` 中增加：

```json
"ui-samples:verify": "node docs/UI视觉预览/00-设计系统/tests/run-all-audits.mjs"
```

- [ ] **Step 5: 运行测试与统一审计入口**

Run: `pnpm exec vitest run tools/architecture/src/ui-sample-inventory.test.ts`

Expected: PASS。

Run: `pnpm ui-samples:verify`

Expected: 八类审计全部退出码为 0；如果仍出现既有 9 个视觉失败，记录精确页面与视口并在 Task 2 修复，不绕过检查器。

- [ ] **Step 6: 提交审计入口**

```bash
git add package.json tools/architecture/src/ui-sample-inventory.test.ts docs/UI视觉预览/00-设计系统/tests
git commit -m "test: lock UI sample audit inventory"
```

### Task 2: 同步 HTML AI 排版并清零三视口视觉失败

**Files:**
- Create: `docs/UI视觉预览/00-设计系统/tests/run-ai-typography.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/assets/base.css`
- Modify: `docs/UI视觉预览/00-设计系统/assets/workspace.css`
- Modify: `docs/UI视觉预览/00-设计系统/assets/learning.css`
- Modify: `docs/UI视觉预览/02-课程创建与大纲/*.html`
- Modify: `docs/UI视觉预览/03-课程规划与排期/*.html`
- Modify: `docs/UI视觉预览/04-课节学习/*.html`
- Modify: `docs/UI视觉预览/05-Review与学习档案/*.html`
- Modify: `docs/UI视觉预览/06-历史统计与学习画像/学习画像.html`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-all-audits.mjs`

**Interfaces:**
- Consumes: `.lm-ai-content` 语义类、三种锁定字体和既有样稿审计器。
- Produces: 冻结前唯一一次 AI 排版同步；全部 AI 内容具有统一字体和垂直节奏。

- [ ] **Step 1: 先写真实浏览器字体与节奏检查器**

```js
// docs/UI视觉预览/00-设计系统/tests/run-ai-typography.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(testsDir, '..', '..');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return entry.isFile() && entry.name.endsWith('.html') ? [target] : [];
  });
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [];
let aiBlocks = 0;

for (const file of walk(uiRoot)) {
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.lm-ai-content')];
    return {
      count: blocks.length,
      blocks: blocks.map((block) => {
        const style = getComputedStyle(block);
        const headings = [...block.querySelectorAll('h1,h2,h3,h4,h5,h6')];
        const code = [...block.querySelectorAll('code,pre,kbd,samp')];
        return {
          family: style.fontFamily,
          lineHeight: style.lineHeight,
          headingFamilies: headings.map((node) => getComputedStyle(node).fontFamily),
          codeFamilies: code.map((node) => getComputedStyle(node).fontFamily),
        };
      }),
    };
  });
  aiBlocks += result.count;
  for (const block of result.blocks) {
    if (!block.family.includes('Times New Roman') || !block.family.includes('SimSun')) {
      failures.push(`${path.relative(uiRoot, file)}: AI 正文字体栈错误`);
    }
    if (block.headingFamilies.some((family) => !family.includes('SimHei'))) {
      failures.push(`${path.relative(uiRoot, file)}: AI 标题未使用 SimHei`);
    }
    if (block.codeFamilies.some((family) => /Times New Roman|SimSun/.test(family))) {
      failures.push(`${path.relative(uiRoot, file)}: 代码错误继承正文衬线字体`);
    }
  }
}

await browser.close();
if (aiBlocks === 0) failures.push('未找到任何 .lm-ai-content');
if (failures.length > 0) {
  failures.forEach((failure) => console.error(failure));
  process.exit(1);
}
console.log(`AI typography passed: ${aiBlocks} blocks`);
```

- [ ] **Step 2: 运行检查器并确认缺少语义类时失败**

Run: `node docs/UI视觉预览/00-设计系统/tests/run-ai-typography.mjs`

Expected: FAIL，报告“未找到任何 `.lm-ai-content`”或具体字体不符。

- [ ] **Step 3: 在共享样稿 CSS 中定义获批 token 与排版节奏**

在 `base.css` 的 `:root` 增加并统一引用：

```css
--lm-font-ai-heading: SimHei, "黑体", "Microsoft YaHei", sans-serif;
--lm-font-ai-serif: "Times New Roman", SimSun, "宋体", serif;
--lm-font-code: Consolas, "Cascadia Mono", monospace;
--lm-ai-prose-size: 16px;
--lm-ai-prose-line-height: 1.8;
--lm-ai-block-gap: 0.75em;
--lm-ai-section-gap: 1.5em;
```

在 `learning.css` 增加：

```css
.lm-ai-content {
  font-family: var(--lm-font-ai-serif);
  font-size: var(--lm-ai-prose-size);
  line-height: var(--lm-ai-prose-line-height);
  font-kerning: normal;
  letter-spacing: normal;
  overflow-wrap: anywhere;
  text-rendering: optimizeLegibility;
}

.lm-ai-content :where(h1, h2, h3, h4, h5, h6) {
  margin: var(--lm-ai-section-gap) 0 var(--lm-ai-block-gap);
  font-family: var(--lm-font-ai-heading);
}

.lm-ai-content > :first-child { margin-top: 0; }
.lm-ai-content > :last-child { margin-bottom: 0; }
.lm-ai-content :where(p, ul, ol, blockquote, table, pre) { margin-block: 0; }
.lm-ai-content :where(p, ul, ol, blockquote, table, pre) + :where(p, ul, ol, blockquote, table, pre) {
  margin-top: var(--lm-ai-block-gap);
}
.lm-ai-content :where(code, pre, kbd, samp) { font-family: var(--lm-font-code); }
```

- [ ] **Step 4: 给现有 AI 输出根节点添加语义类**

只在下列现有根节点的 `class` 中追加 `lm-ai-content`，不改变文本、状态或交互：

```text
九个建档页：.ow-ai、AI 生成的 .ow-outline
修改大纲.html：AI 调整建议与 AI 大纲正文根节点
正式课程大纲.html：AI 生成的大纲正文根节点
计划流向导与管理.html：AI 计划说明根节点
正式课程学习会话.html：AI 消息流与 Review 根节点
课时Review弹窗.html：article.review-markdown
课节记录.html：article.review-markdown
上周学习回顾.html：AI 周回顾正文根节点
课程主题总Review.html：article.review-markdown
学习画像.html：画像标题、摘要、洞察与证据说明的共同内容根节点
```

例如：

```html
<article class="review-markdown lm-ai-content">…</article>
```

用户气泡、按钮、标签、Toast、统计数字和运行诊断不得添加该类。

- [ ] **Step 5: 将字体检查纳入统一审计并修复既有 9 个失败**

在 `run-all-audits.mjs` 的 `run-typography-spacing.mjs` 后加入：

```js
'run-ai-typography.mjs',
```

运行 `pnpm ui-samples:verify`。对于课程规划三视口 `.lm-pill` 的既有 9 个失败，把造成裁切的固定行高改为不小于控件字体实际行盒的共享 token；不得放宽审计阈值或隐藏内容。

Expected: 全部样稿审计退出码为 0，AI typography 报告至少一个内容块且无字体错误。

- [ ] **Step 6: 提交样稿最后一次排版收口**

```bash
git add docs/UI视觉预览
git commit -m "style: finalize frozen sample typography"
```

### Task 3: 修正 75 条等价断言并更新冻结文档

**Files:**
- Modify: `tools/architecture/src/check-equivalence.ts`
- Modify: `tools/architecture/src/check-equivalence.test.ts`
- Modify: `docs/架构方案/equivalence-matrix.yaml`
- Modify: `docs/基础模块功能等价清单与回归基线.md`
- Modify: `docs/架构方案/Learning MORE 程序架构设计.md`
- Modify: `docs/架构方案/Learning MORE 详细实施计划.md`
- Modify: `docs/架构方案/实施计划-01-工程基座与共享合同.md`
- Modify: `docs/架构方案/实施计划-08-备份发布与全量验收.md`
- Modify: `docs/UI视觉预览/README.md`
- Modify: `docs/设计文档/UI全页面控件交互验收矩阵.md`
- Modify: `PROJECT_CONTEXT.md`
- Create: `docs/UI视觉预览/FROZEN.md`

**Interfaces:**
- Consumes: 已实现的课程永久删除自动化测试。
- Produces: 唯一的 `EQ-COURSE-06`、固定总数 75、明确的 HTML 冻结边界。

- [ ] **Step 1: 先把数量契约测试改成 75 并确认当前实现失败**

```ts
it('rejects a matrix whose assertion count is not the expected count', () => {
  expect(checkEquivalence([entry()], 75, () => true)).toContainEqual({
    actual: 1,
    code: 'COUNT_MISMATCH',
    expected: 75,
  });
});
```

Run: `pnpm exec vitest run tools/architecture/src/check-equivalence.test.ts`

Expected: PASS for helper test；随后运行 `pnpm equivalence:check` 应因实际矩阵仍为 74 或重复编号而 FAIL。

- [ ] **Step 2: 把检查器默认值与正式入口改成 75**

```ts
export function checkEquivalence(
  entries: readonly unknown[],
  expectedCount = 75,
  fileExists: (filePath: string) => boolean = existsSync,
): EquivalenceIssue[] {
```

并把 `runEquivalenceCheck` 中的显式 `74` 改为 `75`。

- [ ] **Step 3: 保留原总 Review 编号并新增删除编号**

在权威 Markdown 表中保持 `EQ-COURSE-04` 为“总 Review 失败隔离”、`EQ-COURSE-05` 为“总 Review 固定输入”，把删除行改为：

```markdown
| EQ-COURSE-06 | 课程永久删除 | 风险弹窗仅提供取消与永久删除，不要求输入课程名称；成功后级联删除课程档案、会话、Review、排期和材料引用，并撤销历史统计事实、日历条目和画像证据；统计重建、画像重算且不再显示被删课程贡献 |
```

在 `equivalence-matrix.yaml` 增加同文条目：

```yaml
- { id: EQ-COURSE-06, sourceHeading: 课程永久删除, assertion: 风险弹窗仅提供取消与永久删除，不要求输入课程名称；成功后级联删除课程档案、会话、Review、排期和材料引用，并撤销历史统计事实、日历条目和画像证据；统计重建、画像重算且不再显示被删课程贡献, ownerModule: CourseAuthoring, testLevel: recovery, automatedTest: apps/server/src/modules/course-authoring/tests/course-archive-deletion.test.ts, status: passing }
```

- [ ] **Step 4: 同步所有固定数字与阶段描述**

把上方 Files 中架构文档里的“74 条”统一为“75 条”；把当前 UI 状态中的“27 页/81 次渲染/25 个产品页”更新为“28 页/84 次渲染/26 个产品页”。历史结论改写为“冻结前最终状态”，不伪造尚未执行的测试结果。

新增 `FROZEN.md`：

```markdown
# UI 样稿冻结规则

自 2026-07-13 起，`docs/UI视觉预览` 的 28 个 HTML 仅作为 React 迁移的视觉与交互参考。

- 不新增页面、状态、路径或模拟数据模型。
- 不把 React 新功能反向实现到 HTML。
- 只允许修复阻断基线复现的确定性问题或断链。
- 任何修复必须同时更新影响说明、HTML 基线与对应 React 映射。
- `apps/web` 是唯一正式产品 UI。
```

- [ ] **Step 5: 运行等价、架构和样稿门禁**

Run: `pnpm equivalence:check`

Expected: `75 assertions verified`，无重复 ID。

Run: `pnpm exec vitest run tools/architecture`

Expected: PASS。

Run: `pnpm ui-samples:verify`

Expected: 28 页审计全部通过。

- [ ] **Step 6: 提交编号与冻结文档**

```bash
git add tools/architecture docs/架构方案 docs/基础模块功能等价清单与回归基线.md docs/UI视觉预览/README.md docs/UI视觉预览/FROZEN.md docs/设计文档/UI全页面控件交互验收矩阵.md PROJECT_CONTEXT.md
git commit -m "docs: freeze UI samples and extend equivalence matrix"
```

### Task 4: 建立 HTML 视觉基线配置与 28 状态映射

**Files:**
- Create: `playwright.visual.config.ts`
- Create: `tests/visual/ui-state-map.ts`
- Create: `tests/visual/html-baselines.spec.ts`
- Create: `tests/visual/baselines/html/` (84 PNG files generated by Playwright)
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: 冻结的 28 个 HTML、三视口与字体契约。
- Produces: `UI_STATE_MAP`、`pnpm visual:html`、84 张版本化 HTML 权威基线。

- [ ] **Step 1: 写出 28 状态映射的数量和唯一性测试**

在 `tests/visual/ui-state-map.ts` 先导出下列类型和完整清单；九个建档状态分别使用 `standard`、`brainstorm`、`argument-clash`、`case-study`、`business-insight`、`process-decomposition`、`decision-analysis`、`cross-explore`、`reading-seminar` 作为 id 后缀。

```ts
export type UiStateMapEntry = Readonly<{
  id: string;
  htmlPath: string;
  reactRoute: string;
  fixture: string;
  stableWhen: string;
}>;

export const UI_VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
} as const;

export const UI_STATE_MAP: readonly UiStateMapEntry[] = [
  { id: 'design-modes', htmlPath: '00-设计系统/九模式视觉身份.html', reactRoute: '/visual/design-modes', fixture: 'design-modes', stableWhen: 'body' },
  { id: 'design-components', htmlPath: '00-设计系统/共享组件与状态色.html', reactRoute: '/visual/design-components', fixture: 'design-components', stableWhen: 'body' },
  { id: 'home', htmlPath: '01-主页与全局导航/主页.html', reactRoute: '/', fixture: 'home-default', stableWhen: 'main' },
  { id: 'authoring-standard', htmlPath: '02-课程创建与大纲/标准模式建档.html', reactRoute: '/courses/new', fixture: 'authoring-standard', stableWhen: '.ow-workbench' },
  { id: 'authoring-brainstorm', htmlPath: '02-课程创建与大纲/八大玩法建档/头脑风暴.html', reactRoute: '/courses/new', fixture: 'authoring-brainstorm', stableWhen: '.ow-workbench' },
  { id: 'authoring-argument-clash', htmlPath: '02-课程创建与大纲/八大玩法建档/论证交锋.html', reactRoute: '/courses/new', fixture: 'authoring-argument-clash', stableWhen: '.ow-workbench' },
  { id: 'authoring-case-study', htmlPath: '02-课程创建与大纲/八大玩法建档/案例研习.html', reactRoute: '/courses/new', fixture: 'authoring-case-study', stableWhen: '.ow-workbench' },
  { id: 'authoring-business-insight', htmlPath: '02-课程创建与大纲/八大玩法建档/商业洞察.html', reactRoute: '/courses/new', fixture: 'authoring-business-insight', stableWhen: '.ow-workbench' },
  { id: 'authoring-process-decomposition', htmlPath: '02-课程创建与大纲/八大玩法建档/流程拆解.html', reactRoute: '/courses/new', fixture: 'authoring-process-decomposition', stableWhen: '.ow-workbench' },
  { id: 'authoring-decision-analysis', htmlPath: '02-课程创建与大纲/八大玩法建档/决策分析.html', reactRoute: '/courses/new', fixture: 'authoring-decision-analysis', stableWhen: '.ow-workbench' },
  { id: 'authoring-cross-explore', htmlPath: '02-课程创建与大纲/八大玩法建档/交叉探索.html', reactRoute: '/courses/new', fixture: 'authoring-cross-explore', stableWhen: '.ow-workbench' },
  { id: 'authoring-reading-seminar', htmlPath: '02-课程创建与大纲/八大玩法建档/阅读研讨.html', reactRoute: '/courses/new', fixture: 'authoring-reading-seminar', stableWhen: '.ow-workbench' },
  { id: 'course-outline', htmlPath: '02-课程创建与大纲/正式课程大纲.html', reactRoute: '/courses/course_visual', fixture: 'course-outline', stableWhen: 'main' },
  { id: 'course-outline-edit', htmlPath: '02-课程创建与大纲/修改大纲.html', reactRoute: '/courses/course_visual', fixture: 'course-outline-edit', stableWhen: 'main' },
  { id: 'course-delete-confirm', htmlPath: '02-课程创建与大纲/课程永久删除确认.html', reactRoute: '/courses/course_visual', fixture: 'course-delete-confirm', stableWhen: '[role="dialog"]' },
  { id: 'planning', htmlPath: '03-课程规划与排期/课程规划.html', reactRoute: '/planning', fixture: 'planning-default', stableWhen: 'main' },
  { id: 'plan-flow', htmlPath: '03-课程规划与排期/计划流向导与管理.html', reactRoute: '/planning', fixture: 'plan-flow', stableWhen: 'main' },
  { id: 'lesson-preview', htmlPath: '04-课节学习/未开始课节导航.html', reactRoute: '/courses/course_visual/lessons/lesson_visual', fixture: 'lesson-preview', stableWhen: 'main' },
  { id: 'lesson-abandoned', htmlPath: '04-课节学习/已放弃课节恢复导航.html', reactRoute: '/courses/course_visual/lessons/lesson_visual', fixture: 'lesson-abandoned', stableWhen: 'main' },
  { id: 'lesson-session', htmlPath: '04-课节学习/正式课程学习会话.html', reactRoute: '/courses/course_visual/lessons/lesson_visual', fixture: 'lesson-session', stableWhen: 'main' },
  { id: 'lesson-review', htmlPath: '05-Review与学习档案/课时Review弹窗.html', reactRoute: '/courses/course_visual/lessons/lesson_visual', fixture: 'lesson-review', stableWhen: '[role="dialog"]' },
  { id: 'lesson-record', htmlPath: '05-Review与学习档案/课节记录.html', reactRoute: '/history', fixture: 'lesson-record', stableWhen: 'main' },
  { id: 'weekly-report', htmlPath: '05-Review与学习档案/上周学习回顾.html', reactRoute: '/history', fixture: 'weekly-report', stableWhen: 'main' },
  { id: 'course-review', htmlPath: '05-Review与学习档案/课程主题总Review.html', reactRoute: '/courses/course_visual', fixture: 'course-review', stableWhen: 'main' },
  { id: 'history', htmlPath: '06-历史统计与学习画像/历史统计.html', reactRoute: '/history', fixture: 'history', stableWhen: 'main' },
  { id: 'calendar', htmlPath: '06-历史统计与学习画像/学习日历.html', reactRoute: '/history', fixture: 'calendar', stableWhen: 'main' },
  { id: 'profile', htmlPath: '06-历史统计与学习画像/学习画像.html', reactRoute: '/profile', fixture: 'profile', stableWhen: 'main' },
  { id: 'runtime', htmlPath: '07-系统运行与自愈/接口状态与本地服务自愈.html', reactRoute: '/runtime', fixture: 'runtime', stableWhen: 'main' },
];

if (UI_STATE_MAP.length !== 28 || new Set(UI_STATE_MAP.map(({ id }) => id)).size !== 28) {
  throw new Error('UI state map must contain 28 unique states');
}
```

- [ ] **Step 2: 新增独立视觉配置**

```ts
// playwright.visual.config.ts
import path from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  outputDir: './artifacts/visual/test-results',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/visual/report', open: 'never' }]],
  use: {
    browserName: 'chromium',
    channel: 'msedge',
    colorScheme: 'light',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: { animations: 'disabled', threshold: 0.15, maxDiffPixelRatio: 0.003 },
  },
});
```

- [ ] **Step 3: 新增 HTML 全页基线测试**

```ts
// tests/visual/html-baselines.spec.ts
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { UI_STATE_MAP, UI_VIEWPORTS } from './ui-state-map.js';

const uiRoot = path.resolve(process.cwd(), 'docs/UI视觉预览');

for (const state of UI_STATE_MAP) {
  for (const [viewportName, viewport] of Object.entries(UI_VIEWPORTS)) {
    test(`${state.id} ${viewportName}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(pathToFileURL(path.join(uiRoot, state.htmlPath)).href);
      await page.locator(state.stableWhen).first().waitFor({ state: 'visible' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const required = ['16px "Times New Roman"', '16px SimSun', '18px SimHei'];
        for (const font of required) if (!document.fonts.check(font)) throw new Error(`Missing font: ${font}`);
      });
      await expect(page).toHaveScreenshot(['html', state.id, `${viewportName}.png`], { fullPage: true });
    });
  }
}
```

- [ ] **Step 4: 暴露脚本并隔离运行产物**

在 `package.json` 增加：

```json
"visual:html": "playwright test --config playwright.visual.config.ts tests/visual/html-baselines.spec.ts",
"visual:html:update": "playwright test --config playwright.visual.config.ts tests/visual/html-baselines.spec.ts --update-snapshots"
```

在 `.gitignore` 确保包含：

```gitignore
artifacts/visual/
```

- [ ] **Step 5: 生成并复验 84 张基线**

Run: `pnpm visual:html:update`

Expected: `84 passed`，生成 84 个 PNG。

Run: `pnpm visual:html`

Expected: `84 passed`，无 diff。

- [ ] **Step 6: 提交配置、映射与权威基线**

```bash
git add playwright.visual.config.ts package.json .gitignore tests/visual/ui-state-map.ts tests/visual/html-baselines.spec.ts tests/visual/baselines/html
git commit -m "test: add frozen HTML visual baselines"
```

### Task 5: 交付 `packages/ui` 样式包与 `AiContent`

**Files:**
- Create: `packages/ui/src/styles.css`
- Create: `packages/ui/src/ai-content.tsx`
- Create: `packages/ui/src/ai-content.test.tsx`
- Create: `packages/ui/src/styles.test.ts`
- Create: `packages/ui/scripts/copy-styles.mjs`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/package.json`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: 获批字体、字号、行高与间距 token。
- Produces: `AiContent(props)`、`.lm-ai-content`、`@learning-more/ui/styles.css`。

- [ ] **Step 1: 先写组件和 CSS 契约测试**

```tsx
// packages/ui/src/ai-content.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiContent } from './ai-content.js';

describe('AiContent', () => {
  it('marks AI generated prose without changing content semantics', () => {
    render(<AiContent as="article"><h2>标题</h2><p>正文 feedback</p></AiContent>);
    expect(screen.getByRole('article')).toHaveClass('lm-ai-content');
    expect(screen.getByRole('heading', { name: '标题' })).toBeVisible();
  });

  it('preserves caller attributes and class names', () => {
    render(<AiContent aria-label="AI 回答" className="message">回答</AiContent>);
    expect(screen.getByLabelText('AI 回答')).toHaveClass('lm-ai-content', 'message');
  });
});
```

```ts
// packages/ui/src/styles.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/ui/src/styles.css', 'utf8');
describe('UI style contract', () => {
  it('locks AI body, heading and code font families', () => {
    expect(css).toContain('--lm-font-ai-heading: SimHei');
    expect(css).toContain('--lm-font-ai-serif: "Times New Roman", SimSun');
    expect(css).toMatch(/\.lm-ai-content[^}]+font-family: var\(--lm-font-ai-serif\)/s);
    expect(css).toMatch(/h1, h2, h3, h4, h5, h6[^}]+var\(--lm-font-ai-heading\)/s);
    expect(css).toMatch(/code, pre, kbd, samp[^}]+var\(--lm-font-code\)/s);
  });
});
```

- [ ] **Step 2: 运行测试并确认缺少文件时失败**

Run: `pnpm exec vitest run packages/ui/src/ai-content.test.tsx packages/ui/src/styles.test.ts`

Expected: FAIL，报告模块或 CSS 文件不存在。

- [ ] **Step 3: 实现语义组件**

```tsx
// packages/ui/src/ai-content.tsx
import type { HTMLAttributes, ReactNode } from 'react';

export interface AiContentProps extends HTMLAttributes<HTMLElement> {
  readonly as?: 'article' | 'div' | 'section';
  readonly children: ReactNode;
}

export function AiContent({ as: Tag = 'div', className, children, ...rest }: AiContentProps) {
  return (
    <Tag className={['lm-ai-content', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Tag>
  );
}
```

在 `index.ts` 增加：

```ts
export * from './ai-content.js';
```

- [ ] **Step 4: 实现共享样式与跨平台复制脚本**

`styles.css` 完整复制 Task 2 的 token 和 `.lm-ai-content` 规则，并补充以下标题层级：

```css
.lm-ai-content h1 { font-size: 28px; line-height: 1.35; }
.lm-ai-content h2 { font-size: 22px; line-height: 1.4; }
.lm-ai-content h3 { font-size: 18px; line-height: 1.45; }
.lm-ai-content :where(ul, ol) { padding-inline-start: 1.5em; }
.lm-ai-content :where(th, td) { padding: 10px 12px; }
```

```js
// packages/ui/scripts/copy-styles.mjs
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await copyFile(new URL('../src/styles.css', import.meta.url), new URL('../dist/styles.css', import.meta.url));
```

把 `packages/ui/package.json` 的 build 与 exports 改为：

```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./styles.css": "./dist/styles.css"
},
"scripts": {
  "build": "tsc -p tsconfig.json && node scripts/copy-styles.mjs",
  "test": "vitest run --root ../.. packages/ui",
  "typecheck": "tsc -p tsconfig.json --noEmit"
}
```

在 `apps/web/src/main.tsx` 的本地样式前导入：

```ts
import '@learning-more/ui/styles.css';
import './styles.css';
```

- [ ] **Step 5: 运行组件、类型与构建测试**

Run: `pnpm exec vitest run packages/ui`

Expected: PASS。

Run: `pnpm --filter @learning-more/ui typecheck && pnpm --filter @learning-more/ui build`

Expected: PASS，且 `packages/ui/dist/styles.css` 存在。

- [ ] **Step 6: 提交 AI 内容基础**

```bash
git add packages/ui apps/web/src/main.tsx
git commit -m "feat: add shared AI content typography"
```

### Task 6: 建立静态布局与表单原语

**Files:**
- Create: `packages/ui/src/primitives.tsx`
- Create: `packages/ui/src/primitives.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: 共享 CSS token。
- Produces: `Button`、`Card`、`Badge`、`Page`、`Stack`、`Grid`、`Sidebar`、`Panel`、`Toolbar`、`Field`、`Select`、`EmptyState`，以及九种课程模式的共享视觉变量。

- [ ] **Step 1: 写行为和语义测试**

```tsx
// packages/ui/src/primitives.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge, Button, EmptyState, Field, Page, Stack } from './primitives.js';

describe('UI primitives', () => {
  it('preserves native button and input behavior', () => {
    render(<><Button variant="danger">删除</Button><Field label="主题" name="topic" /></>);
    expect(screen.getByRole('button', { name: '删除' })).toHaveAttribute('data-variant', 'danger');
    expect(screen.getByRole('textbox', { name: '主题' })).toHaveAttribute('name', 'topic');
  });

  it('provides layout and status semantics without business knowledge', () => {
    render(<Page><Stack><Badge tone="warning">等待</Badge><EmptyState title="暂无内容" /></Stack></Page>);
    expect(screen.getByText('等待')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByRole('heading', { name: '暂无内容' })).toBeVisible();
  });
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `pnpm exec vitest run packages/ui/src/primitives.test.tsx`

Expected: FAIL，报告 `primitives.js` 不存在。

- [ ] **Step 3: 实现无业务依赖的原语**

```tsx
// packages/ui/src/primitives.tsx
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

function classes(...values: Array<string | undefined>) { return values.filter(Boolean).join(' '); }
export function Page(props: HTMLAttributes<HTMLElement>) { return <main {...props} className={classes('lm-page', props.className)} />; }
export function Stack(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={classes('lm-stack', props.className)} />; }
export function Grid(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={classes('lm-grid', props.className)} />; }
export function Sidebar(props: HTMLAttributes<HTMLElement>) { return <aside {...props} className={classes('lm-sidebar', props.className)} />; }
export function Card(props: HTMLAttributes<HTMLElement>) { return <section {...props} className={classes('lm-card', props.className)} />; }
export function Panel(props: HTMLAttributes<HTMLElement>) { return <section {...props} className={classes('lm-panel', props.className)} />; }
export function Toolbar(props: HTMLAttributes<HTMLDivElement>) { return <div role="toolbar" {...props} className={classes('lm-toolbar', props.className)} />; }
export function Badge({ tone = 'neutral', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'success' | 'warning' | 'error' | 'readonly' }) { return <span {...props} data-tone={tone} className={classes('lm-badge', props.className)} />; }
export function Button({ variant = 'default', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost' }) { return <button type="button" {...props} data-variant={variant} className={classes('lm-button', props.className)} />; }
export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { readonly label: ReactNode }) { return <label className="lm-field"><span>{label}</span><input {...props} /></label>; }
export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { readonly label: ReactNode }) { return <label className="lm-field"><span>{label}</span><select {...props}>{children}</select></label>; }
export function EmptyState({ title, children }: { readonly title: string; readonly children?: ReactNode }) { return <section className="lm-empty"><h2>{title}</h2>{children}</section>; }
```

在 `index.ts` 增加 `export * from './primitives.js';`，并在 `styles.css` 为每个 `.lm-*` 类定义只依赖 token 的布局、边框、圆角、焦点和响应式规则。课程模式只通过下列身份变量表达，不覆盖全局成功、警告、错误、放弃和只读语义色：

```css
[data-course-mode="standard"] { --lm-course-accent:#af6942; --lm-course-accent-dark:#78452b; --lm-course-tint:#f7ece5; }
[data-course-mode="brainstorm"] { --lm-course-accent:#d2a526; --lm-course-accent-dark:#7c6216; --lm-course-tint:#fff9e4; }
[data-course-mode="argument_clash"] { --lm-course-accent:#58a38f; --lm-course-accent-dark:#326b5d; --lm-course-tint:#edf8f4; }
[data-course-mode="case_study"] { --lm-course-accent:#cb8181; --lm-course-accent-dark:#865151; --lm-course-tint:#fff1f1; }
[data-course-mode="business_insight"] { --lm-course-accent:#9b7650; --lm-course-accent-dark:#694b31; --lm-course-tint:#f7f0e7; }
[data-course-mode="process_decomposition"] { --lm-course-accent:#6f9fa6; --lm-course-accent-dark:#466d73; --lm-course-tint:#edf6f7; }
[data-course-mode="decision_analysis"] { --lm-course-accent:#65a07d; --lm-course-accent-dark:#416d55; --lm-course-tint:#eef7f1; }
[data-course-mode="cross_explore"] { --lm-course-accent:#78a2e5; --lm-course-accent-dark:#4b6fa9; --lm-course-tint:#eff5ff; }
[data-course-mode="reading_seminar"] { --lm-course-accent:#9079c1; --lm-course-accent-dark:#5f4d8b; --lm-course-tint:#f5f1fd; }
```

- [ ] **Step 4: 运行测试、类型和构建**

Run: `pnpm exec vitest run packages/ui/src/primitives.test.tsx && pnpm --filter @learning-more/ui typecheck && pnpm --filter @learning-more/ui build`

Expected: PASS。

- [ ] **Step 5: 提交静态原语**

```bash
git add packages/ui
git commit -m "feat: add shared UI primitives"
```

### Task 7: 建立可访问 Dialog、Toast 与 Tabs

**Files:**
- Create: `packages/ui/src/dialog.tsx`
- Create: `packages/ui/src/dialog.test.tsx`
- Create: `packages/ui/src/toast.tsx`
- Create: `packages/ui/src/tabs.tsx`
- Create: `packages/ui/src/interactive-primitives.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/styles.css`

**Interfaces:**
- Consumes: `Button` 与共享 token。
- Produces: `Dialog` 的焦点进入/陷阱/恢复、`Toast` 的 live region、键盘可用的 `Tabs`。

- [ ] **Step 1: 写焦点、Escape、通知和键盘切换测试**

```tsx
// packages/ui/src/interactive-primitives.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './dialog.js';
import { Tabs } from './tabs.js';
import { Toast } from './toast.js';

describe('interactive primitives', () => {
  it('moves focus into a dialog and closes with Escape', () => {
    const close = vi.fn();
    render(<Dialog open title="确认删除" onClose={close}><button>永久删除</button></Dialog>);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('announces status and error toasts', () => {
    const { rerender } = render(<Toast tone="success">已保存</Toast>);
    expect(screen.getByRole('status')).toHaveTextContent('已保存');
    rerender(<Toast tone="error">保存失败</Toast>);
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
  });

  it('switches tabs with arrow keys', () => {
    render(<Tabs value="history" onChange={() => undefined} items={[{ value: 'history', label: '历史' }, { value: 'calendar', label: '日历' }]} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: '历史' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '日历' })).toHaveFocus();
  });
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `pnpm exec vitest run packages/ui/src/interactive-primitives.test.tsx`

Expected: FAIL，报告三个模块不存在。

- [ ] **Step 3: 实现三个组件并集中样式**

```tsx
// packages/ui/src/dialog.tsx
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function Dialog(props: { readonly open: boolean; readonly title: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    rootRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    return () => previous?.focus();
  }, [props.open]);
  if (!props.open) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); props.onClose(); return; }
    if (event.key !== 'Tab' || rootRef.current === null) return;
    const items = [...rootRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0]!;
    const last = items.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="lm-dialog-backdrop">
      <section ref={rootRef} className="lm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId}>{props.title}</h2>
        {props.children}
      </section>
    </div>
  );
}
```

```tsx
// packages/ui/src/toast.tsx
import type { ReactNode } from 'react';
export function Toast(props: { readonly tone: 'success' | 'warning' | 'error'; readonly children: ReactNode }) {
  return <div className="lm-toast" data-tone={props.tone} role={props.tone === 'error' ? 'alert' : 'status'}>{props.children}</div>;
}
```

```tsx
// packages/ui/src/tabs.tsx
import type { KeyboardEvent } from 'react';
export type TabItem = Readonly<{ value: string; label: string }>;
export function Tabs(props: { readonly value: string; readonly items: readonly TabItem[]; readonly onChange: (value: string) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = props.items.length - 1;
    const targetIndex = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : undefined;
    if (targetIndex !== undefined) {
      event.preventDefault();
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[targetIndex]?.focus();
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onChange(props.items[index]!.value); }
  };
  return (
    <div className="lm-tabs" role="tablist">
      {props.items.map((item, index) => (
        <button key={item.value} type="button" role="tab" aria-selected={item.value === props.value} tabIndex={item.value === props.value ? 0 : -1} onClick={() => props.onChange(item.value)} onKeyDown={(event) => onKeyDown(event, index)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

三个实现不得包含课程、Review、画像或 Provider 文案。在 `index.ts` 增加：

```ts
export * from './dialog.js';
export * from './toast.js';
export * from './tabs.js';
```

样式只写 `.lm-dialog`、`.lm-dialog-backdrop`、`.lm-toast`、`.lm-tabs` 及其子元素。

- [ ] **Step 4: 运行交互、类型和构建测试**

Run: `pnpm exec vitest run packages/ui && pnpm --filter @learning-more/ui typecheck && pnpm --filter @learning-more/ui build`

Expected: PASS，Dialog 测试覆盖焦点进入、Tab 循环、Escape 与焦点恢复。

- [ ] **Step 5: 提交交互原语**

```bash
git add packages/ui
git commit -m "feat: add accessible interactive primitives"
```

### Task 8: 把全部现有 AI 输出入口接入 `AiContent`

**Files:**
- Create: `tools/architecture/src/ai-content-boundaries.test.ts`
- Modify: `apps/web/src/features/course-authoring/candidate-panel.tsx`
- Modify: `apps/web/src/features/learning/message-stream.tsx`
- Modify: `apps/web/src/features/review/review-dialog.tsx`
- Modify: `apps/web/src/features/history/weekly-report-view.tsx`
- Modify: `apps/web/src/features/profile/portrait-view.tsx`
- Modify: `apps/web/src/features/planning/plan-flow-panel.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `AiContent` 与现有 `react-markdown`/`rehype-sanitize` 渲染链。
- Produces: 所有已知 AI 字段通过语义边界渲染；用户输入和诊断信息不受影响。

- [ ] **Step 1: 写静态边界测试**

```ts
// tools/architecture/src/ai-content-boundaries.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  'apps/web/src/features/course-authoring/candidate-panel.tsx',
  'apps/web/src/features/learning/message-stream.tsx',
  'apps/web/src/features/review/review-dialog.tsx',
  'apps/web/src/features/history/weekly-report-view.tsx',
  'apps/web/src/features/profile/portrait-view.tsx',
  'apps/web/src/features/planning/plan-flow-panel.tsx',
];

describe('AI content boundaries', () => {
  it.each(files)('%s imports and renders AiContent', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toMatch(/import .*AiContent.* from '@learning-more\/ui'/s);
    expect(source).toContain('<AiContent');
  });
});
```

- [ ] **Step 2: 运行边界测试并确认入口尚未包裹**

Run: `pnpm exec vitest run tools/architecture/src/ai-content-boundaries.test.ts`

Expected: FAIL，列出缺少 `AiContent` 的入口。

- [ ] **Step 3: 包裹真实 AI 字段而不猜测文本**

每个文件增加：

```ts
import { AiContent } from '@learning-more/ui';
```

把 Markdown/AI 字段的现有渲染器包裹，例如：

```tsx
<AiContent as="article">
  <Markdown rehypePlugins={[rehypeSanitize]}>{props.markdown}</Markdown>
</AiContent>
```

`weekly-report-view.tsx` 不再用 `<pre>` 展示整篇报告，改用已净化 Markdown；`portrait-view.tsx` 的 `portrait.title`、`portrait.summary` 和 `claim.markdown` 进入一个 `AiContent` 根节点，但“最近成功更新”、按钮和证据计数留在产品无衬线区域。`plan-flow-panel.tsx` 只包裹 Provider 返回的计划说明，不包裹日期、按钮和状态。

删除 `apps/web/src/styles.css` 中 `.candidate-markdown` 的独立行高，让共享 token 成为唯一来源。

- [ ] **Step 4: 运行架构和 Feature 测试**

Run: `pnpm exec vitest run tools/architecture/src/ai-content-boundaries.test.ts apps/web/src/features/course-authoring apps/web/src/features/learning apps/web/src/features/review apps/web/src/features/history apps/web/src/features/profile apps/web/src/features/planning`

Expected: PASS。

Run: `pnpm --filter @learning-more/web typecheck`

Expected: PASS。

- [ ] **Step 5: 提交 AI 边界迁移**

```bash
git add tools/architecture/src/ai-content-boundaries.test.ts apps/web/src/features apps/web/src/styles.css
git commit -m "feat: standardize AI generated content rendering"
```

### Task 9: 迁移正式 App Shell 与共享页面状态

**Files:**
- Create: `apps/web/src/layouts/app-shell.test.tsx`
- Create: `apps/web/src/layouts/page-state.tsx`
- Create: `apps/web/src/layouts/page-state.test.tsx`
- Modify: `apps/web/src/layouts/app-shell.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `Page`、`Toolbar`、`StatusBanner`、`Button`、`EmptyState` 和现有 RuntimeStateContext。
- Produces: 正式导航壳；`loading|empty|error|degraded|rebuilding|version-mismatch` 的共享展示组件。

- [ ] **Step 1: 写 App Shell 与共享状态测试**

```tsx
// apps/web/src/layouts/page-state.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageState } from './page-state.js';

describe('PageState', () => {
  it.each([
    ['loading', '正在加载'], ['empty', '暂无内容'], ['error', '加载失败'],
    ['degraded', '数据需要修复'], ['rebuilding', '数据正在重建'], ['version-mismatch', '版本不兼容'],
  ] as const)('renders %s', (state, message) => {
    render(<PageState state={state} />);
    expect(screen.getByText(message)).toBeVisible();
  });
});
```

`app-shell.test.tsx` 使用 `MemoryRouter` 和 stubbed `fetchRuntimeReadiness` 验证五个主导航链接、离线重试按钮、版本不兼容时写入区域 disabled，以及 runtime 路由保持可操作。

- [ ] **Step 2: 运行测试并确认 PageState 尚不存在**

Run: `pnpm exec vitest run apps/web/src/layouts/page-state.test.tsx apps/web/src/layouts/app-shell.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 实现共享页面状态并重组现有 App Shell JSX**

```tsx
// apps/web/src/layouts/page-state.tsx
import { EmptyState, StatusBanner } from '@learning-more/ui';

export type PageStateKind = 'loading' | 'empty' | 'error' | 'degraded' | 'rebuilding' | 'version-mismatch';
const messages: Record<PageStateKind, string> = {
  loading: '正在加载', empty: '暂无内容', error: '加载失败', degraded: '数据需要修复',
  rebuilding: '数据正在重建', 'version-mismatch': '版本不兼容',
};
export function PageState({ state }: { readonly state: PageStateKind }) {
  if (state === 'empty') return <EmptyState title={messages[state]} />;
  const status = state === 'loading' || state === 'rebuilding' ? 'rebuilding' : 'degraded';
  return <StatusBanner status={status} message={messages[state]} />;
}
```

在 `AppShell` 保留现有 readiness 拉取、2 秒轮询、版本判断与 `fieldset` 写保护，只把结构替换为共享 `Page`/`Toolbar`/`Button` 和稳定类名；不得把 RuntimeStateContext 移入 `packages/ui`。本地 `styles.css` 只保留 App Shell 布局和 Feature 样式，按钮、卡片、状态色由共享 CSS 提供。

- [ ] **Step 4: 运行布局、路由、类型和构建测试**

Run: `pnpm exec vitest run apps/web/src/layouts apps/web/src/router.test.tsx apps/web/src/app.test.tsx`

Expected: PASS。

Run: `pnpm --filter @learning-more/web typecheck && pnpm --filter @learning-more/web build`

Expected: PASS。

- [ ] **Step 5: 提交 App Shell**

```bash
git add apps/web/src/layouts apps/web/src/styles.css
git commit -m "feat: migrate shared application shell"
```

### Task 10: 建立 React 视觉 Fixture 与 15 张删除关键状态基线

**Files:**
- Create: `apps/web/visual.html`
- Create: `apps/web/src/visual/visual-main.tsx`
- Create: `apps/web/src/visual/visual-fixture-app.tsx`
- Create: `tests/visual/react-critical-states.spec.ts`
- Create: `tests/visual/baselines/react-critical-states/` (15 PNG files)
- Modify: `playwright.visual.config.ts`

**Interfaces:**
- Consumes: 真实 `HomePage`、课程删除 Feature 视图、`PortraitView`、共享 Dialog/Toast/StatusBanner。
- Produces: 五个状态 × 三视口的关键组件长期基线；Fixture 只存在于独立 Vite 入口。

- [ ] **Step 1: 写关键状态测试并确认视觉入口不存在**

```ts
// tests/visual/react-critical-states.spec.ts
import { expect, test } from '@playwright/test';
import { UI_VIEWPORTS } from './ui-state-map.js';

const states = ['delete-submitting', 'delete-failure', 'delete-success', 'portrait-rebuilding', 'portrait-failure'] as const;
for (const state of states) {
  for (const [viewportName, viewport] of Object.entries(UI_VIEWPORTS)) {
    test(`${state} ${viewportName}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/visual.html?state=${state}`);
      await page.locator('[data-visual-ready="true"]').waitFor();
      if (state === 'delete-submitting' || state === 'delete-failure') {
        await page.getByRole('button', { name: '删除课程' }).click();
        await page.getByRole('button', { name: '永久删除' }).click();
      }
      if (state === 'delete-failure') {
        await page.getByRole('alert').waitFor();
      }
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('[data-visual-subject]')).toHaveScreenshot(
        ['react-critical-states', state, `${viewportName}.png`],
        { animations: 'disabled', threshold: 0.15, maxDiffPixelRatio: 0.001 },
      );
    });
  }
}
```

Run: `pnpm exec playwright test --config playwright.visual.config.ts tests/visual/react-critical-states.spec.ts`

Expected: FAIL，`/visual.html` 不存在。

- [ ] **Step 2: 新增独立视觉入口**

```html
<!-- apps/web/visual.html -->
<div id="root"></div><script type="module" src="/src/visual/visual-main.tsx"></script>
```

```tsx
// apps/web/src/visual/visual-main.tsx
import { createRoot } from 'react-dom/client';
import '@learning-more/ui/styles.css';
import '../styles.css';
import { VisualFixtureApp } from './visual-fixture-app.js';
const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');
createRoot(root).render(<VisualFixtureApp state={new URLSearchParams(location.search).get('state') ?? ''} />);
```

`VisualFixtureApp` 使用真实组件表达五个状态：

```tsx
// apps/web/src/visual/visual-fixture-app.tsx
import { HomePage } from '../features/home/home-page.js';
import { PortraitView } from '../features/profile/portrait-view.js';
import { CourseArchiveDangerZone } from '../features/review/course-archive-danger-zone.js';

const neverCompletes = new Promise<void>(() => undefined);
const portrait = (state: 'generating' | 'failed') => ({
  versionId: `portrait_${state}`,
  state,
  title: '学习画像正在更新',
  summary: '',
  claims: [],
  updatedAt: '2026-07-13T10:00:00.000Z',
  resourceVersion: 1,
} as const);

export function VisualFixtureApp({ state }: { readonly state: string }) {
  let content;
  switch (state) {
    case 'delete-submitting':
      content = <CourseArchiveDangerZone onDelete={() => neverCompletes} />;
      break;
    case 'delete-failure':
      content = <CourseArchiveDangerZone onDelete={() => Promise.reject(new Error('fixture'))} />;
      break;
    case 'delete-success':
      content = (
        <HomePage
          notice="课程及关联记录已永久删除"
          onNavigate={() => undefined}
          lessons={[]}
          draftSessions={[]}
          courses={[]}
        />
      );
      break;
    case 'portrait-rebuilding':
      content = <PortraitView portrait={portrait('generating')} evidence={[]} />;
      break;
    case 'portrait-failure':
      content = <PortraitView portrait={portrait('failed')} evidence={[]} />;
      break;
    default:
      throw new Error(`Unknown visual fixture state: ${state}`);
  }
  return (
    <main data-visual-ready="true">
      <section data-visual-subject>{content}</section>
    </main>
  );
}
```

禁止在生产 `AppRoutes` 中注册 `/visual.html` 或读取 `state` 查询参数。

- [ ] **Step 3: 为视觉配置增加独立 webServer**

在 `playwright.visual.config.ts` 增加：

```ts
webServer: {
  command: 'pnpm --filter @learning-more/web dev',
  url: 'http://127.0.0.1:5173/visual.html',
  reuseExistingServer: true,
  timeout: 60_000,
},
use: { baseURL: 'http://127.0.0.1:5173', /* 保留既有锁定项 */ },
```

- [ ] **Step 4: 生成并复验 15 张关键状态基线**

Run: `pnpm exec playwright test --config playwright.visual.config.ts tests/visual/react-critical-states.spec.ts --update-snapshots`

Expected: `15 passed`。

Run: `pnpm exec playwright test --config playwright.visual.config.ts tests/visual/react-critical-states.spec.ts`

Expected: `15 passed`，无 diff。

- [ ] **Step 5: 提交 Fixture 与基线**

```bash
git add apps/web/visual.html apps/web/src/visual tests/visual/react-critical-states.spec.ts tests/visual/baselines/react-critical-states playwright.visual.config.ts
git commit -m "test: add React critical visual states"
```

### Task 11: 冻结清单、全量门禁与阶段移交

**Files:**
- Create: `docs/UI视觉预览/ui-freeze-manifest.json`
- Create: `tools/architecture/src/ui-freeze-manifest.test.ts`
- Modify: `CONTEXT.md`
- Modify: `PROJECT_CONTEXT.md`
- Modify: `docs/UI视觉预览/README.md`
- Modify: `docs/superpowers/specs/2026-07-13-react-ui-transition-design.md`

**Interfaces:**
- Consumes: 28 页、84 张 HTML 基线、15 张 React 状态基线和共享 UI 构建结果。
- Produces: 可审计冻结清单；进入“主页、课程创建、正式大纲与永久删除”下一子计划的绿色门禁。

- [ ] **Step 1: 写冻结清单一致性测试**

```ts
// tools/architecture/src/ui-freeze-manifest.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const uiRoot = path.join(root, 'docs/UI视觉预览');
function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return entry.isFile() && entry.name.endsWith('.html')
      ? [path.relative(uiRoot, target).replaceAll('\\', '/')]
      : [];
  });
}

describe('UI freeze manifest', () => {
  it('matches all and only the 28 frozen HTML pages', () => {
    const manifest = JSON.parse(readFileSync(path.join(uiRoot, 'ui-freeze-manifest.json'), 'utf8')) as { pages: string[] };
    expect(manifest.pages.toSorted()).toEqual(walk(uiRoot).toSorted());
    expect(manifest.pages).toHaveLength(28);
  });
});
```

- [ ] **Step 2: 运行测试并确认清单缺失**

Run: `pnpm exec vitest run tools/architecture/src/ui-freeze-manifest.test.ts`

Expected: FAIL，manifest 不存在。

- [ ] **Step 3: 写入确定性冻结清单并更新阶段文档**

`ui-freeze-manifest.json` 使用：

```json
{
  "version": 1,
  "frozenAt": "2026-07-13",
  "pageCount": 28,
  "viewports": ["1440x1000", "1024x768", "390x844"],
  "pages": [
    "00-设计系统/九模式视觉身份.html",
    "00-设计系统/共享组件与状态色.html",
    "01-主页与全局导航/主页.html",
    "02-课程创建与大纲/八大玩法建档/交叉探索.html",
    "02-课程创建与大纲/八大玩法建档/决策分析.html",
    "02-课程创建与大纲/八大玩法建档/商业洞察.html",
    "02-课程创建与大纲/八大玩法建档/头脑风暴.html",
    "02-课程创建与大纲/八大玩法建档/案例研习.html",
    "02-课程创建与大纲/八大玩法建档/流程拆解.html",
    "02-课程创建与大纲/八大玩法建档/论证交锋.html",
    "02-课程创建与大纲/八大玩法建档/阅读研讨.html",
    "02-课程创建与大纲/修改大纲.html",
    "02-课程创建与大纲/标准模式建档.html",
    "02-课程创建与大纲/正式课程大纲.html",
    "02-课程创建与大纲/课程永久删除确认.html",
    "03-课程规划与排期/计划流向导与管理.html",
    "03-课程规划与排期/课程规划.html",
    "04-课节学习/已放弃课节恢复导航.html",
    "04-课节学习/未开始课节导航.html",
    "04-课节学习/正式课程学习会话.html",
    "05-Review与学习档案/上周学习回顾.html",
    "05-Review与学习档案/课程主题总Review.html",
    "05-Review与学习档案/课时Review弹窗.html",
    "05-Review与学习档案/课节记录.html",
    "06-历史统计与学习画像/历史统计.html",
    "06-历史统计与学习画像/学习日历.html",
    "06-历史统计与学习画像/学习画像.html",
    "07-系统运行与自愈/接口状态与本地服务自愈.html"
  ]
}
```

`pages` 必须与 `UI_STATE_MAP.htmlPath` 一一对应。更新 `CONTEXT.md`、`PROJECT_CONTEXT.md` 与 UI README：HTML 已冻结，`apps/web` 是唯一正式 UI，84 张基线位置、0.3%/0.1% 阈值和运行命令清晰可查。把设计规格状态更新为“切片 0-1 已计划，等待执行证据”；不得把未通过的门禁写成已完成。

- [ ] **Step 4: 运行从局部到全仓的最终门禁**

Run: `pnpm exec vitest run tools/architecture/src/ui-freeze-manifest.test.ts tools/architecture/src/ui-sample-inventory.test.ts tools/architecture/src/ai-content-boundaries.test.ts`

Expected: PASS。

Run: `pnpm ui-samples:verify`

Expected: 28 页、三视口相关审计全部通过。

Run: `pnpm visual:html`

Expected: `84 passed`。

Run: `pnpm exec playwright test --config playwright.visual.config.ts tests/visual/react-critical-states.spec.ts`

Expected: `15 passed`。

Run: `pnpm verify`

Expected: format、lint、typecheck、schema、architecture、equivalence、unit、build 全绿。

- [ ] **Step 5: 提交阶段移交证据**

```bash
git add docs/UI视觉预览/ui-freeze-manifest.json tools/architecture/src/ui-freeze-manifest.test.ts CONTEXT.md PROJECT_CONTEXT.md docs/UI视觉预览/README.md docs/superpowers/specs/2026-07-13-react-ui-transition-design.md
git commit -m "docs: close React UI transition foundation"
```

完成本计划后，下一份计划只处理“主页、课程创建、正式大纲与课程永久删除”的真实 Route/Feature/API 闭环，并继承本计划的视觉、字体、可访问性和全仓门禁。
