# Plan Flow Daily Target Soft Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让默认 45 分钟每日目标能够为预计 50 分钟的原子课节生成并确认计划预览。

**Architecture:** 在计划流领域服务中把每日时长解释为提示模型排期的软目标，不再作为单条建议的硬校验上限。日期、学习日、时间区间、课节覆盖、重叠和依赖顺序仍由现有确定性校验器强制执行。

**Tech Stack:** TypeScript 5.9、Vitest、Fastify、本地 Generation Runtime、Codex CLI

## Global Constraints

- 每日目标时长是软目标，不自动缩短、拆分课节或修改用户设置。
- 保留课节、日期、学习日、重叠和依赖顺序的现有严格校验。
- 不扩大 `PlanningClient` 或计划流公共契约。
- 使用真实 `gpt-5.6-sol` Codex CLI 运行时复测原始五课节请求。

---

### Task 1: 锁定每日目标与长课节的回归行为

**Files:**
- Modify: `apps/server/src/modules/planning/tests/plan-flow-service.test.ts`

**Interfaces:**
- Consumes: `createPlanFlowService(...).requestPreview(input, commandId)` 与 `markPreviewReady(id, suggestions)`
- Produces: 服务级回归测试 `accepts an atomic lesson longer than the daily target`

- [ ] **Step 1: 写入失败测试**

在 `PlanFlowService` 测试组中新增：

```ts
it('accepts an atomic lesson longer than the daily target', async () => {
  const { service } = fixture();
  const requested = await service.requestPreview(
    {
      ...previewInput,
      timeWindowRefs: ['start:2026-07-14', 'daily:45', 'days:周二,周三'],
    },
    'preview_soft_daily_target',
  );
  const ready = await service.markPreviewReady(requested.id, suggestions);

  expect(ready).toMatchObject({ state: 'preview-ready', suggestions });
});
```

- [ ] **Step 2: 运行测试并确认当前失败**

Run: `node .\node_modules\vitest\vitest.mjs run apps/server/src/modules/planning/tests/plan-flow-service.test.ts`

Expected: 新测试以 `plan_preview_invalid` 失败，因为 `lesson_01` 的 60 分钟建议超过 45 分钟目标。

- [ ] **Step 3: 保留失败输出作为回归证据**

确认同文件原有日期、学习日、重复建议、重叠与依赖测试仍执行，避免后续通过删掉整个校验器获得假绿。

### Task 2: 将每日目标改为软约束

**Files:**
- Modify: `apps/server/src/modules/planning/implementation/plan-flow-service.ts`
- Test: `apps/server/src/modules/planning/tests/plan-flow-service.test.ts`

**Interfaces:**
- Consumes: `flow.timeWindowRefs` 中的 `daily:<minutes>` 与 `PlanPreviewContext.availability.dailyTargetMinutes`
- Produces: `validateSuggestions(...)` 不再按单条建议时长拒绝预览；`renderPlanPreviewPrompt(...)` 明确软目标语义

- [ ] **Step 1: 修改提示词语义**

把可用时间段中的每日时长提示改为：

```ts
`单日目标时长（软目标；课节不可拆分时可略超）：${context.availability.dailyTargetMinutes} 分钟`
```

- [ ] **Step 2: 删除错误的单建议硬上限校验**

从 `validateSuggestions` 删除 `dailyMinutesText`、`dailyMinutes` 及以下分支：

```ts
if (
  dailyMinutes !== undefined &&
  Number.isFinite(dailyMinutes) &&
  Date.parse(suggestion.endAt) - Date.parse(suggestion.startAt) > dailyMinutes * 60_000
) {
  throw new PlanFlowError('plan_preview_invalid');
}
```

不修改开始日期、学习日、标识覆盖、时间区间、重叠和依赖校验。

- [ ] **Step 3: 运行服务回归测试**

Run: `node .\node_modules\vitest\vitest.mjs run apps/server/src/modules/planning/tests/plan-flow-service.test.ts`

Expected: 全部通过，新测试状态为 `preview-ready`。

- [ ] **Step 4: 运行静态检查**

Run: `corepack pnpm --filter @learning-more/server typecheck`

Expected: 退出码 0。

Run: `node .\node_modules\eslint\bin\eslint.js apps/server/src/modules/planning/implementation/plan-flow-service.ts apps/server/src/modules/planning/tests/plan-flow-service.test.ts`

Expected: 退出码 0。

### Task 3: 真实运行时验证

**Files:**
- Verify only: `.learning-more-data/entities/plan-flows/**`
- Verify only: `.learning-more-data/entities/tasks/**`

**Interfaces:**
- Consumes: 当前课程 `course_175c2129-151b-4c00-99c2-0323a311ef8a` 的五个未完成课节、45 分钟目标、工作日约束
- Produces: HTTP 202/成功响应且计划流状态为 `preview-ready`

- [ ] **Step 1: 构建并重启当前本地运行时**

使用项目现有启动/重连入口加载修改后的 server build，随后请求 `/api/v1/runtime/ready`，确认 `status` 与 `providerStatus` 均为 `ready`。

- [ ] **Step 2: 重跑原始五课节 HTTP 请求**

向 `/api/v1/plan-flow-previews` POST：

```json
{
  "constraintsArtifactRef": "constraints_manual",
  "courseRefs": ["course_175c2129-151b-4c00-99c2-0323a311ef8a"],
  "lessonRefs": [
    "lesson_911f993758da0e6925fe2052a690ee4f",
    "lesson_bccfe5987286877af907d37b48d63daf",
    "lesson_288af835a84ca59e12558f0e5d4f1730",
    "lesson_ee9c2d67b73c88cc7d9e9581ddbecead",
    "lesson_730bfc1300c8eae56fb7e9be5f19071a"
  ],
  "timeWindowRefs": [
    "start:2026-07-15",
    "daily:45",
    "days:周一,周二,周三,周四,周五",
    "preserve:true",
    "overdue:false",
    "strategy:balanced"
  ],
  "existingScheduleSnapshotRef": "schedule_0"
}
```

Expected: 不再返回 `409 plan_preview_invalid`；响应状态为 `preview-ready`，包含五条建议，50 分钟课节保留原时长且全部落在工作日。

- [ ] **Step 3: 运行计划流端到端测试**

Run: `node .\node_modules\@playwright\test\cli.js test tests/e2e/planning-history.spec.ts --grep "EQ-SCH-02" --reporter=line`

Expected: 1 passed。

- [ ] **Step 4: 核对无调试残留**

Run: `rg -n "DEBUG-" apps/server/src/modules/planning apps/web/src/features/planning`

Expected: 无本次新增调试标记。
