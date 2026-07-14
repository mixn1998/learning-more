# Week Calendar Lesson Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute this single task inline and preserve the existing responsive layout.

**Goal:** 将主页周历与学习日历日期卡中的课节名称改为无背景、无边框的紧凑文字行；主页周历使用 `9px` 字号、`1` 行高和 `6px` 内边距，不改变星期与日期层级。

**Architecture:** 修改主页 `.mini` 与学习日历 `.date-course` 两类课节文字行，并修复今日学习标题与列表间距；在严格视觉完整性测试中增加计算样式和模块间距断言，防止共享规则覆盖该规格。

**Tech Stack:** HTML、CSS、Playwright 视觉回归。

## Global Constraints

- 课节名称字号必须为 `9px`。
- 行高必须为 `1`，对应计算值 `9px`。
- 四边内边距必须为 `6px`。
- `.day small` 与 `.day strong` 的星期、日期样式不得修改。
- `.mini` 与 `.date-course` 不得出现自身背景或边框；日期卡外层选中态保持不变。
- 今日学习标题与首条课节之间至少保留 `8px` 间距。

---

### Task 1: 周历课节名称紧凑排版

**Files:**
- Modify: `docs/UI视觉预览/01-主页与全局导航/主页.html`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-visual-integrity.mjs`

**Interfaces:**
- Consumes: 主页运行时生成的 `.mini` 课节块。
- Produces: 稳定的 `9px / 1 / 6px` 视觉规格。

- [x] **Step 1: 增加移动端计算样式断言**
- [x] **Step 2: 运行严格视觉测试并确认旧样式失败**
- [x] **Step 3: 修改 `.mini` 的字号、行高和内边距**
- [x] **Step 4: 运行控件几何、文字间距和严格视觉测试**

### Task 2: 周历与学习日历纯文字课节行

**Files:**
- Modify: `docs/UI视觉预览/01-主页与全局导航/主页.html`
- Modify: `docs/UI视觉预览/06-历史统计与学习画像/学习日历.html`
- Test: `docs/UI视觉预览/00-设计系统/tests/run-visual-integrity.mjs`

**Interfaces:**
- Consumes: `.mini`、`.date-course` 和 `.agenda h3 + .agenda-list`。
- Produces: 无底纹、无边框、紧凑行距的统一课节展示。

- [x] **Step 1: 增加背景、边框、行高和标题间距断言**
- [x] **Step 2: 运行严格视觉测试并确认旧样式失败**
- [x] **Step 3: 修改两类课节行及今日学习标题间距**
- [x] **Step 4: 运行三视口视觉回归**
