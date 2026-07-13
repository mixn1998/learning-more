# Learning MORE 正式前端全阶段实施计划

> **执行说明：** 按任务顺序实施；每完成一个复选项即在本文件更新证据。业务逻辑已有测试保护的部分只做迁移和补接，不重新实现。
> **设计规格：** `docs/superpowers/specs/2026-07-13-frontend-full-build-design.md`
> **现状报告：** `docs/superpowers/reports/2026-07-13-frontend-foundation-report.md`

**目标：** 在现有 React 工程中交付与 29 个现行样稿视觉绝对一致、与当前后端形成完整业务闭环、三视口全量可回归的正式产品前端。

**架构：** 保留 `apps/web` 已通过测试的 Route、Feature 状态机、Client、SSE、幂等和版本保护；扩建 `packages/ui`；按“共享基础 + 纵向切片”补齐页面、数据流和跨层接口。

**技术栈：** React 19、React Router 7、TypeScript 5.9、Vite 8、pnpm 10、Vitest 4、Testing Library、Playwright 1.61、Zod/OpenAPI、CSS Custom Properties。

## 1. 状态标记规则

- `[x]`：当前代码和自动化证据已证明，无需重新施工；后续只允许保护性迁移；
- `[ ]`：尚未完成，或虽有部分逻辑但未达到正式页面/真实闭环/视觉门禁；
- 每个未完成任务必须同时满足“功能、失败恢复、三视口、无障碍、视觉差异、全仓门禁”才可勾选；
- 75 条功能等价断言当前全部通过，视为领域语义基线。后续任务补正式 UI 和跨层接线，不重写这些领域规则；
- 任一任务使既有 461 个测试、4 条核心 E2E、5 条 Runtime E2E 或 75 条等价断言回退，不得标记完成。

## 2. 当前完成基线

### 2.1 工程与质量门禁

- [x] pnpm monorepo、React/Vite/TypeScript 正式工程存在并可构建；
- [x] 主页、建档、课程、课节、课节记录、规划、历史、画像、运行中心和 404 路由存在；
- [x] API/SSE、page instance、version guard、command attempt 基础存在；
- [x] OpenAPI 与共享 Zod Schema 一致；
- [x] 架构检查 191 个 data key 通过，无禁止依赖；
- [x] 75 条等价断言全部实现并通过；
- [x] 133 个测试文件、461 个测试全部通过；
- [x] `corepack pnpm verify` 全绿；
- [x] 4 条核心业务浏览器 E2E 全部通过；
- [x] 5 条运行时浏览器 E2E 全部通过。

### 2.2 可复用业务程序

- [x] 主页九模式选择、创建会话和继续学习目标算法；
- [x] 建档评估、候选生成、SSE、失败恢复、重生成、冲突和确认状态机；
- [x] 课程读取、关闭、课程 Review 和课程生命周期命令；
- [x] 未开始课节预览与按需创建会话；
- [x] 学习消息生成、停止、暂停/恢复、租约转移、窗口生命周期和刷新恢复；
- [x] 课节放弃/恢复、结课、Review 和补充会话的核心命令编排；
- [x] 课节记录双页签和补充会话切换基础；
- [x] 手工排期、计划流预览/确认和冲突保留；
- [x] 历史分页、统计/日历/画像三入口、日期过滤和周数据读取；
- [x] 画像、证据链和刷新主路径；
- [x] Provider 切换、Launcher 重连、自愈、实例身份和版本阻断。

### 2.3 样稿审计基础

- [x] 当前 29 个 HTML 页面可枚举；
- [x] 29/29 页面加载检查通过；
- [x] 29/29 控件接线检查通过；
- [x] 29×3 控件几何检查通过；
- [x] 29×3 模块几何检查通过；
- [ ] 交互回归剩余 2 个过期断言；
- [ ] 排版/间距剩余 9 个失败；
- [ ] 视觉完整性剩余 27 个失败；
- [ ] 统一、自包含的样稿审计命令；
- [ ] 87 张 HTML 权威截图基线；
- [ ] React 正式视觉回归基线。

---

## 3. 执行任务

### Task 1：收口当前样稿与建立 87 张权威基线

**Files**

- Modify: `docs/UI视觉预览/00-设计系统/assets/base.css`
- Modify: `docs/UI视觉预览/00-设计系统/assets/learning.css`
- Modify: `docs/UI视觉预览/00-设计系统/assets/workspace.css`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-interaction-regression.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-typography-spacing.mjs`
- Modify: `docs/UI视觉预览/00-设计系统/tests/run-visual-integrity.mjs`
- Create: `docs/UI视觉预览/00-设计系统/tests/run-all-audits.mjs`
- Create: `tests/visual/sample-state-map.ts`
- Create: `tests/visual/html-baseline.spec.ts`
- Create: `playwright.visual.config.ts`
- Modify: `package.json`
- Modify: `docs/UI视觉预览/README.md`

**Checklist**

- [ ] 以实际文件系统固定 29 个 HTML 清单，并建立测试防止数量和路径漂移；
- [ ] 修复课程规划 pill 的 9 个行高失败，不改变样稿信息架构；
- [ ] 修复移动端页面宽度/裁切问题；
- [ ] 修复周报日期标签的 14 个行高失败；
- [ ] 把交互测试中的导航等待改为目标 URL/稳定标记断言；
- [ ] 把计划流每日目标动作改为数值 input 的真实填写方式；
- [ ] `run-all-audits.mjs` 自行启动临时静态服务、探测端口、顺序执行全部审计并可靠退出；
- [ ] 在根 `package.json` 增加 `ui-samples:verify` 与 `visual:test`；
- [ ] 按设计规格中的 29 行映射建立稳定 state ID、Route/Fixture、准备步骤和关键组件区域；
- [ ] 生成桌面 1440×1000、平板 1024×768、移动端 390×844 共 87 张 HTML 基线；
- [ ] 固定 locale、时区、DPI、颜色方案、Mock 数据、时间、ID、动画和字体加载；
- [ ] 截图前验证 Times New Roman、SimSun 和 SimHei 可用；
- [ ] 基线写入 `tests/visual/baselines/html`，运行产物写入 `artifacts/visual`；
- [ ] README 记录权威命令、29 页/87 张口径和失败定位方式。

**Acceptance**

```powershell
corepack pnpm ui-samples:verify
corepack pnpm playwright test --config playwright.visual.config.ts tests/visual/html-baseline.spec.ts
corepack pnpm verify
```

预期：样稿加载、接线、交互、几何、排版和视觉完整性全部零失败；87 张基线可重复生成且无非确定差异。

---

### Task 2：扩建 React 设计系统与正式 App Shell

**Files**

- Create: `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/styles/course-modes.css`
- Create: `packages/ui/src/styles/typography.css`
- Create: `packages/ui/src/styles/components.css`
- Create: `packages/ui/src/layout.tsx`
- Create: `packages/ui/src/button.tsx`
- Create: `packages/ui/src/card.tsx`
- Create: `packages/ui/src/badge.tsx`
- Create: `packages/ui/src/tabs.tsx`
- Create: `packages/ui/src/dialog.tsx`
- Create: `packages/ui/src/toast.tsx`
- Create: `packages/ui/src/field.tsx`
- Create: `packages/ui/src/content-state.tsx`
- Create: `packages/ui/src/ai-content.tsx`
- Create: `packages/ui/src/*.test.tsx`
- Modify: `packages/ui/src/status-banner.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/package.json`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/layouts/app-shell.tsx`
- Modify: `apps/web/src/styles.css`
- Create: `apps/web/src/layouts/app-shell.test.tsx`

**Checklist**

- [ ] 将样稿颜色、间距、圆角、阴影、层级、断点迁入唯一 token；
- [ ] 将九模式 accent/accent-dark/tint/motif 与样稿完全统一；
- [ ] 模式色与 success/warning/danger/readonly/degraded 状态色解耦；
- [ ] 实现 Page、Stack、Inline、Grid、SidebarLayout、Panel、Card、Toolbar、SectionHeader；
- [ ] 实现 Button、Badge/Pill、Tabs、Dialog、Toast、Field、输入控件和统一内容状态；
- [ ] 保留并视觉升级 StatusBanner，不改变现有运行状态语义；
- [ ] Dialog 实现焦点陷阱、Escape、背景隔离和关闭后焦点恢复；
- [ ] Tabs 实现键盘、ARIA 关联和选中态；
- [ ] 实现 `AiContent` 与受净化 Markdown；
- [ ] AI 标题计算字体为 SimHei/黑体；
- [ ] AI 英文正文计算字体为 Times New Roman；
- [ ] AI 中文正文计算字体为 SimSun/宋体；
- [ ] 代码保持统一等宽字体；
- [ ] AI 正文、标题、列表、引用、表格和代码块使用统一行高与间距 token；
- [ ] App Shell 迁移顶栏、品牌、全局导航、Runtime 状态和写入阻断视觉；
- [ ] 1440、1024、390 三视口无溢出和遮挡；
- [ ] 不在 `packages/ui` 引入路由、API 或领域类型。

**Tests**

- [ ] `packages/ui` 覆盖 variants、disabled/loading、ARIA、键盘和焦点；
- [ ] `AiContent` 覆盖中文、英文、中英混排、标题、列表、引用、表格、行内代码和代码块；
- [ ] 建立设计系统两个 Visual Fixture，与样稿 1–2 对照；
- [ ] App Shell 建立主页/移动端/运行降级视觉状态。

**Acceptance**

```powershell
corepack pnpm --filter @learning-more/ui test
corepack pnpm --filter @learning-more/web test
corepack pnpm verify
corepack pnpm visual:test
```

---

### Task 3：统一 Client、合同和页面数据流

**Files**

- Modify: `apps/web/src/client/api-client.ts`
- Modify: `apps/web/src/client/course-authoring-client.ts`
- Modify: `apps/web/src/client/learning-client.ts`
- Modify: `apps/web/src/client/planning-client.ts`
- Modify: `apps/web/src/client/history-client.ts`
- Modify: `apps/web/src/client/profile-client.ts`
- Modify: `apps/web/src/client/runtime-client.ts`
- Modify: `apps/web/src/state/use-command-attempt.ts`
- Modify: `packages/contracts/src/http.ts`
- Modify: `packages/contracts/src/course-authoring.ts`
- Modify: `packages/contracts/src/learning-session.ts`
- Modify: `packages/contracts/src/learning-facts-http.ts`
- Modify: `packages/contracts/src/planning.ts`
- Modify: `packages/contracts/src/runtime.ts`
- Modify: `packages/contracts/src/index.ts`

**Checklist**

- [ ] 所有 Client 通过 `apiRequest` 统一解析 success/Problem/ETag；
- [ ] 所有 Response 使用共享 Schema，移除手写 `as ReturnType` 和未校验 JSON；
- [ ] 404、503、stale、rebuilding 使用显式 union，移除 `undefined as T`；
- [ ] CSRF、page instance、If-Match、correlation 和 content type 由 Client 统一注入；
- [ ] 每个可重试写操作从 `use-command-attempt` 获取稳定 idempotency key；
- [ ] 失败重试复用身份，成功或用户明确放弃后才旋转；
- [ ] 增加大纲修订 Client；
- [ ] 增加课程摘要 Client；
- [ ] 增加关闭事务读取和重试 Client；
- [ ] 增加 Runtime 诊断 Client；
- [ ] SSE 继续支持 Last-Event-ID、snapshot reset、取消和 transient reconnect；
- [ ] Client 单元测试覆盖重复命令、ETag 冲突、404/503 union、SSE 恢复和取消。

**Acceptance**

```powershell
corepack pnpm --filter @learning-more/contracts test
corepack pnpm --filter @learning-more/web test
corepack pnpm schema:check
corepack pnpm architecture:check
```

---

### Task 4：主页、九模式建档与正式课程纵向切片

**Files**

- Create: `packages/contracts/src/home.ts`
- Create: `apps/server/src/http/routes/home.ts`
- Create: `apps/web/src/client/home-client.ts`
- Modify: `apps/server/src/bootstrap/app.ts`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/features/home/home-page.tsx`
- Modify: `apps/web/src/routes/course-authoring-route.tsx`
- Modify: `apps/web/src/features/course-authoring/authoring-page.tsx`
- Modify: `apps/web/src/features/course-authoring/course-mode-selector.tsx`
- Modify: `apps/web/src/features/course-authoring/assessment-panel.tsx`
- Modify: `apps/web/src/features/course-authoring/candidate-panel.tsx`
- Modify: `apps/web/src/features/course-authoring/confirm-dialog.tsx`
- Create: `apps/web/src/features/course/outline-view.tsx`
- Create: `apps/web/src/features/course/outline-revision-workspace.tsx`
- Create: `apps/web/src/features/course/outline-version-history.tsx`
- Move/Refactor: `apps/web/src/features/review/course-page.tsx` → `apps/web/src/features/course/course-page.tsx`
- Modify: `apps/web/src/routes/course-route.tsx`
- Modify: `tests/e2e/course-authoring.spec.ts`
- Create: `tests/e2e/home-course.spec.ts`

**Checklist — 主页**

- [ ] 新增权威首页聚合读取，返回未确认大纲、正式课程、活动会话、推荐课节和周计划；
- [ ] `HomeRoute` 真实加载数据，不再依赖默认空 props；
- [ ] 保留当前 `selectContinueTarget` 优先级，不重新实现；
- [ ] 无课程时只显示创建入口，不显示伪继续操作；
- [ ] 草稿和正式课程分区且链接到真实路由；
- [ ] 九模式同规格入口、standard 第一且默认选中；
- [ ] 周历、课程切换、成功/错误提示与样稿一致；
- [ ] 加载、空态、错误、degraded 和 version mismatch 完整。

**Checklist — 建档**

- [ ] 保留当前 Authoring reducer 和 SSE 状态机；
- [ ] 主页选择模式不创建会话，提交后只创建一次；
- [ ] OutlineSession 工作台不重复显示模式选择和主题输入；
- [ ] 阅读研讨真正上传并摄取 PDF/TXT/MD，展示解析/失败/来源状态；
- [ ] 起点评估、候选、失败草稿、重生成、冲突、确认和刷新恢复全部迁入正式布局；
- [ ] 所有 AI 消息和候选大纲使用 `AiContent`；
- [ ] 九模式共享同一组件和状态机，只改变统一主题变量；
- [ ] 样稿 4–12 在三个视口逐一通过。

**Checklist — 正式课程**

- [ ] 展示正式大纲、课节顺序、版本、状态、课程模式和学习进度；
- [ ] 大纲修订接真实 `outline-revisions`，冲突后可加载权威版本；
- [ ] 版本记录和只读历史视图完成；
- [ ] 关闭态锁定编辑，保留查看大纲、课节记录和课程 Review；
- [ ] 课程 Review 使用最终大纲和课节 Review 的服务端权威结果；
- [ ] 课程生命周期确认和结果状态使用共享 Dialog/Toast；
- [ ] 正式大纲、修订说明和课程 Review 使用 `AiContent`；
- [ ] 样稿 13–16、25 在三个视口逐一通过。

**Tests**

- [ ] 保留并通过现有 Home/Authoring/Course 组件测试；
- [ ] 增加首页聚合空态、继续学习、草稿/课程分区和错误恢复测试；
- [ ] 增加材料摄取成功/失败、修订冲突和关闭态只读测试；
- [ ] E2E 覆盖首页 → 建档 → 确认 → 修订 → 课节导航 → 课程状态闭环；
- [ ] 全页视觉差异 ≤0.3%，关键组件 ≤0.1%。

---

### Task 5：规划与计划流完整跨层闭环

**Files**

- Modify: `packages/contracts/src/planning.ts`
- Modify: `apps/server/src/http/routes/planning.ts`
- Modify: `apps/server/src/modules/planning/interface.ts`
- Modify: `apps/server/src/modules/planning/implementation/planning-module.ts`
- Modify: `apps/server/src/modules/planning/implementation/plan-flow-service.ts`
- Modify: `apps/web/src/client/planning-client.ts`
- Modify: `apps/web/src/routes/planning-route.tsx`
- Modify: `apps/web/src/features/planning/planning-page.tsx`
- Modify: `apps/web/src/features/planning/planning-date-filter.tsx`
- Modify: `apps/web/src/features/planning/schedule-board.tsx`
- Modify: `apps/web/src/features/planning/plan-flow-panel.tsx`
- Create: `apps/web/src/features/planning/schedule-editor-dialog.tsx`
- Create: `apps/web/src/features/planning/plan-flow-wizard.tsx`
- Create: `apps/web/src/features/planning/plan-flow-management.tsx`
- Modify: `tests/e2e/planning-history.spec.ts`

**Checklist — 合同与接口**

- [ ] 新增 schedule move/resize/lock/remove 请求和响应 Schema；
- [ ] 新增计划流 pause/resume/reflow/end 请求和响应 Schema；
- [ ] HTTP 路由调用现有领域命令，不复制规划规则；
- [ ] 所有写操作支持 idempotency、page instance、If-Match 和 Problem；
- [ ] 增加成功、冲突、重复请求和恢复集成测试；
- [ ] OpenAPI 与 Schema 同步。

**Checklist — 正式页面**

- [ ] 七日栏、日期和待规划筛选互斥；
- [ ] 计划卡展示课程、课节、日期、时段、来源、锁定和派生状态；
- [ ] 手工排期、改期、调整时长、取消和锁定接真实命令；
- [ ] 完成/放弃课节不可重新排入活动计划；
- [ ] 放弃课节取消有效排期，恢复不自动恢复旧排期；
- [ ] 四步计划流向导保留约束、预览零写入、确认原子写入；
- [ ] 支持暂停、恢复、重排和结束管理；
- [ ] 手工锁定项不被重排；
- [ ] 冲突时保留草稿和约束，展示权威新日程；
- [ ] AI 计划说明使用 `AiContent`；
- [ ] 样稿 17–18 在三个视口逐一通过。

**Acceptance**

```powershell
corepack pnpm test -- apps/server/src/http/routes/planning.test.ts apps/server/src/modules/planning
corepack pnpm --filter @learning-more/web test
corepack pnpm playwright:test
corepack pnpm visual:test
```

---

### Task 6：正式学习、Review 与课节记录纵向切片

**Files**

- Modify: `packages/contracts/src/learning-session.ts`
- Modify: `packages/contracts/src/review-closure.ts`
- Modify: `apps/server/src/http/routes/learning-sessions.ts`
- Modify: `apps/server/src/http/routes/review-closure.ts`
- Modify: `apps/web/src/client/learning-client.ts`
- Modify: `apps/web/src/client/lesson-record-client.ts`
- Modify: `apps/web/src/features/learning/lesson-entry-page.tsx`
- Modify: `apps/web/src/features/learning/session-page.tsx`
- Modify: `apps/web/src/features/learning/message-stream.tsx`
- Modify: `apps/web/src/features/learning/session-controls.tsx`
- Modify: `apps/web/src/features/learning/abandoned-lesson-record.tsx`
- Modify: `apps/web/src/features/review/review-dialog.tsx`
- Modify: `apps/web/src/features/history/lesson-record-view.tsx`
- Modify: `apps/web/src/routes/lesson-record-route.tsx`
- Modify: `tests/e2e/learning-review-closure.spec.ts`

**Checklist — 入口与会话**

- [ ] 未开始页展示权威目标、核心知识点和预计时间，点击开始前零写入；
- [ ] 已放弃页展示已学/剩余、查看记录和恢复，不混入全局历史；
- [ ] 保留当前会话 reducer、租约、暂停/恢复和窗口生命周期；
- [ ] 服务端 Session View 返回完整消息序列、生成状态和关闭准备数据；
- [ ] 对话渲染完整用户/AI 消息，不只累积一次 assistant 文本；
- [ ] AI 消息、补充会话和流式 Markdown 统一使用 `AiContent`；
- [ ] SSE transient reconnect、恢复快照、终态和错误均有可见状态；
- [ ] 停止生成保留草稿引用和输入；
- [ ] 第二窗口只读、写入权转移后原窗口立即停止计时。

**Checklist — 结束与 Review**

- [ ] 移除固定 hash、固定 message ID 和固定 end intent；
- [ ] 关闭输入由服务端权威会话快照或 prepare endpoint 提供；
- [ ] 关闭事务展示 pending/completed/failed，并接真实 retry；
- [ ] 同一快照重试幂等，失败不产生完成事实；
- [ ] Review 后台完成不依赖页面存活；
- [ ] 在页完成时打开正文可滚动、头尾固定的 Review Dialog；
- [ ] 离页后完成时下次只提示一次并打开 Review Tab；
- [ ] Dialog 只提供查看课节记录和返回课程大纲；
- [ ] 阶段/最终 Review 使用 `AiContent` 且最终 Review 保持不可变。

**Checklist — 记录**

- [ ] 顶层“学习对话/课时 Review”双 Tab；
- [ ] 对话 Tab 内切换原始与补充会话；
- [ ] 历史记录只读，不出现修改和错误的补充学习入口；
- [ ] Calendar/History 深链打开正确课程、课节和 Review Tab；
- [ ] 长 Markdown、表格和代码在三个视口不裁切；
- [ ] 样稿 19–23 在三个视口逐一通过。

**Tests**

- [ ] 保留现有 Session、窗口生命周期、记录和 E2E 测试；
- [ ] 增加完整消息 hydration、SSE 恢复、关闭事务 retry、离页通知测试；
- [ ] 增加键盘/焦点/只读/双窗口测试；
- [ ] 全页视觉差异 ≤0.3%，Review Dialog ≤0.1%。

---

### Task 7：历史统计、学习日历与周报纵向切片

**Files**

- Modify: `packages/contracts/src/learning-facts-http.ts`
- Modify: `apps/web/src/client/history-client.ts`
- Modify: `apps/web/src/routes/history-route.tsx`
- Modify: `apps/web/src/features/history/history-page.tsx`
- Modify: `apps/web/src/features/history/history-section-tabs.tsx`
- Modify: `apps/web/src/features/history/statistics-panel.tsx`
- Modify: `apps/web/src/features/history/history-timeline.tsx`
- Modify: `apps/web/src/features/history/calendar-view.tsx`
- Modify: `apps/web/src/features/history/weekly-report-view.tsx`
- Create: `apps/web/src/features/history/history-filters.tsx`
- Create: `apps/web/src/features/history/course-summary-drawer.tsx`
- Modify: `tests/e2e/planning-history.spec.ts`

**Checklist**

- [ ] Route 对历史、统计、日历、周数据和周报分别处理 loading/error/stale/rebuilding；
- [ ] 单个读模型失败不令整个页面永久 loading；
- [ ] 三个顶层入口保持同级，不新增课程聚合式历史入口；
- [ ] 统计 ViewModel 展示总览、分布、互动、趋势、样本量、排除项和来源时间；
- [ ] 互动统计只使用结构化关键互动口径；
- [ ] 历史分页追加，不替换已加载事实；
- [ ] 筛选日期后不残留旧结果；
- [ ] 课程摘要抽屉接 `/courses/:courseId/summary`；
- [ ] 月历按本地日期聚合并支持上一月/下一月；
- [ ] 完成条目深链到课程和权威 Review；
- [ ] 周报默认折叠；
- [ ] 展开周报展示冻结状态、结构化周统计和 AI Markdown，不再输出 JSON/`pre`；
- [ ] 周报使用 `AiContent`；
- [ ] 样稿 24、26、27 在三个视口逐一通过。

**Tests**

- [ ] 404/503/stale/rebuilding、部分失败和重试测试；
- [ ] 月份切换、本地日期、空日期、分页和深链测试；
- [ ] 周报默认折叠、展开、无报告和冻结态测试；
- [ ] 数据定义变更同步相关文档和等价断言。

---

### Task 8：学习画像纵向切片

**Files**

- Modify: `apps/web/src/client/profile-client.ts`
- Modify: `apps/web/src/routes/profile-route.tsx`
- Modify: `apps/web/src/features/profile/profile-page.tsx`
- Modify: `apps/web/src/features/profile/global-profile-panel.tsx`
- Modify: `apps/web/src/features/profile/portrait-view.tsx`
- Modify: `apps/web/src/features/profile/evidence-drawer.tsx`
- Modify: `tests/e2e/profile-portrait.spec.ts`

**Checklist**

- [ ] Route 并行读取档案、证据和当前画像并分别处理错误；
- [ ] 刷新命令使用稳定 idempotency key；
- [ ] preparing/generating 按 versionId 轮询，完成/失败/卸载后停止；
- [ ] 刷新失败通过 `finally` 解除 busy，保留上一版画像；
- [ ] 样本不足不生成模板化人格洞察；
- [ ] 失败态显示可重试原因，不显示伪画像；
- [ ] 复合证据抽屉展示来源组、时间、限制和反向证据，不泄漏内部置信标签；
- [ ] 洞察维度和数量保持自由，不新增固定分类；
- [ ] 标题、摘要、洞察和证据说明使用 `AiContent`；
- [ ] 样稿 28 在三个视口通过。

**Tests**

- [ ] 保留现有画像状态和证据测试；
- [ ] 增加轮询完成、轮询失败、卸载取消、旧版保留和重试测试；
- [ ] E2E 覆盖首次画像、增量刷新、失败保留和证据展开；
- [ ] 全页视觉差异 ≤0.3%，证据抽屉 ≤0.1%。

---

### Task 9：运行中心纵向切片

**Files**

- Modify: `packages/contracts/src/runtime.ts`
- Modify: `apps/web/src/client/runtime-client.ts`
- Modify: `apps/web/src/features/runtime/runtime-center.tsx`
- Modify: `apps/web/src/features/runtime/runtime-center.test.tsx`
- Modify: `tests/e2e/runtime-provider-switch.spec.ts`
- Modify: `tests/e2e/runtime-self-heal.spec.ts`
- Modify: `tests/e2e/runtime-version-sync.spec.ts`

**Checklist**

- [ ] 正式展示实例、构建、协议、数据根、Provider、模型、健康和最后检查时间；
- [ ] 保留当前四阶段重连和 capability 安全边界；
- [ ] Provider 验证失败不改变当前值；
- [ ] API Key 不进入普通持久化、日志或 DOM 回显；
- [ ] 接入 `/api/v1/runtime/diagnostics`；
- [ ] 展示净化后的诊断结果、错误码和修复建议；
- [ ] 错端口/错数据根/错 instanceId 不显示为健康；
- [ ] 外部端口占用不提供强杀动作；
- [ ] 协议/构建不匹配与全局写入阻断保持同步；
- [ ] 诊断代码使用等宽字体，不套用 AI 字体；
- [ ] 样稿 29 在三个视口通过。

**Acceptance**

```powershell
corepack pnpm playwright:runtime
corepack pnpm --filter @learning-more/web test
corepack pnpm visual:test
```

---

### Task 10：全量视觉、响应式和无障碍收口

**Files**

- Create: `tests/visual/react-pages.spec.ts`
- Create: `tests/visual/ai-typography.spec.ts`
- Create: `tests/visual/layout-integrity.spec.ts`
- Create: `tests/visual/visual-fixtures.ts`
- Create: `tests/accessibility/keyboard-navigation.spec.ts`
- Modify: `playwright.visual.config.ts`
- Modify: `package.json`

**Checklist — 覆盖**

- [ ] 29 个样稿状态都有 React Route/Fixture、三视口和稳定断言；
- [ ] 87 张 HTML 基线全部可读取；
- [ ] 87 个对应 React 迁移状态全部建立长期基线；
- [ ] 业务动态的 loading、empty、error、conflict、rebuilding、readonly 和生成状态建立关键组件基线；
- [ ] 截图环境固定字体、时区、locale、时间、ID、DPI、动画和网络；
- [ ] 全页 `threshold: 0.15`、`maxDiffPixelRatio: 0.003`；
- [ ] 关键组件 `maxDiffPixelRatio: 0.001`；
- [ ] 失败输出 expected/actual/diff、比例、状态名和 trace；
- [ ] 禁止自动批量更新快照。

**Checklist — 视觉与字体**

- [ ] 三视口零横向溢出；
- [ ] 零正文裁切、控件遮挡、同组高度漂移和死按钮；
- [ ] 九模式身份贯穿建档、课程、学习、Review 和历史；
- [ ] 所有 AI 输出入口静态扫描为 `AiContent`；
- [ ] AI 标题、中文、英文和代码计算字体全部正确；
- [ ] 标题、正文、列表、引用、表格和代码块行距/间距统一；
- [ ] Feature 不覆盖共享字体、字号、行高和视觉 token。

**Checklist — 无障碍**

- [ ] 全局导航、Tabs、Dialog、Toast、表单和动态状态键盘可操作；
- [ ] 可见焦点完整；
- [ ] Dialog 焦点陷阱和关闭恢复完整；
- [ ] `aria-live`、`aria-busy` 和只读状态正确；
- [ ] 颜色不是唯一状态表达；
- [ ] 200% 缩放可用；
- [ ] reduced motion 生效；
- [ ] 浏览器控制台零未处理错误和 Promise rejection。

**Acceptance**

```powershell
corepack pnpm ui-samples:verify
corepack pnpm visual:test
corepack pnpm playwright:test
corepack pnpm playwright:runtime
corepack pnpm verify
```

---

### Task 11：发布级验收与文档同步

**Files**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `PROJECT_CONTEXT.md`
- Modify: `docs/UI视觉预览/README.md`
- Modify: `docs/基础模块功能等价清单与回归基线.md`（仅当可观察行为变化）
- Modify: 相关数据源定义文档（仅当字段/展示口径变化）
- Create: `docs/superpowers/reports/frontend-final-acceptance.md`

**Checklist**

- [ ] 逐项复核本计划所有复选项和证据；
- [ ] 确认 29 个状态、87 张 HTML 基线和全部 React 基线一致；
- [ ] 确认业务 E2E、Runtime E2E、75 条等价断言和全仓门禁为绿色；
- [ ] 确认不存在生产 `demoMode`、样稿 iframe、内联业务 Fixture 或第二套 token；
- [ ] 确认所有 Client 使用共享合同、稳定命令身份和统一错误模型；
- [ ] 确认所有 AI 生成内容使用统一字体和排版；
- [ ] 确认三视口和无障碍零阻断问题；
- [ ] 文档记录最终版本、命令、基线更新规则和维护责任；
- [ ] 生成最终验收报告，包含通过项、证据路径和已知非阻断限制；
- [ ] 正式将 `apps/web` 标记为唯一产品 UI，HTML 保留为视觉参考。

## 4. 全需求完成清单

### 已完成且只需持续保护

- [x] 75 条 HOME/PLAY/SCH/PF/HIS/LESSON/COURSE/CAL/POR/AI/SELF/GEN/DATA/I18N 等价语义；
- [x] 文件 Repository 合同和原子写入；
- [x] 生成任务并发、停止和刷新恢复基础；
- [x] 课程建档、学习、Review、关闭、规划确认、历史重建和画像主闭环；
- [x] Runtime Provider、凭据、Launcher、自愈、端口和版本安全闭环；
- [x] 当前 React 业务状态机和浏览器测试基础。

### 正式前端仍需补齐

- [ ] 29 个样稿状态的正式 React 页面；
- [ ] 87 张 HTML 权威基线和对应 React 长期基线；
- [ ] 共享 token、组件、布局、九模式视觉身份和 App Shell；
- [ ] 全 AI 内容标题黑体、中文宋体、英文 Times New Roman、代码等宽；
- [ ] 首页真实聚合数据；
- [ ] 材料上传/摄取、正式大纲修订和版本视图；
- [ ] 规划改期/时长/取消/锁定及计划流管理跨层接口；
- [ ] 完整会话消息、权威关闭输入、事务恢复和 Review 通知 UX；
- [ ] 课节记录完整只读导航；
- [ ] 历史统计信息架构、月历、课程摘要和折叠周报；
- [ ] 画像轮询、失败回收和旧版保留；
- [ ] Runtime 诊断页面；
- [ ] 三视口、键盘、焦点、200% 缩放和动态状态无障碍；
- [ ] 全页 ≤0.3%、关键组件 ≤0.1%、零溢出/裁切/死控件；
- [ ] 发布级全量验收和文档同步。

## 5. 阶段完成顺序

1. Task 1–3：固定参照、建设共享基础、统一数据流；
2. Task 4：首页—建档—正式课程闭环；
3. Task 5：规划与计划流闭环；
4. Task 6：学习—Review—课节记录闭环；
5. Task 7–8：历史—日历—周报—画像闭环；
6. Task 9：运行中心闭环；
7. Task 10–11：全量视觉、无障碍和发布验收。

每个阶段结束时都必须保持产品可运行；不得积累跨阶段的半迁移页面或长期双轨样式。
