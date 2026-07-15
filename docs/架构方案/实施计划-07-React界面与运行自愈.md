# React 全域界面与运行自愈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** 完成统一 React 信息架构、本地 Launcher、严格进程身份、一键重连、自愈、Provider 运行时切换和 Windows 密钥保护。

**Architecture:** Launcher 是唯一推荐启动入口，控制端口固定 43119，应用端口固定 43120。Server 写 `runtime-manifest.json` 并通过 health 返回完整身份；Web 只在身份与协议一致时连接。RuntimeControl 和 SecretStore 是独立 seam，业务模块不感知进程与密钥细节。

**Tech Stack:** Node.js 24.17.0、TypeScript 5.9.3、React 19.2.7、React Router 7.18.0、Fastify 5.10.0、Windows DPAPI、Vitest 4.1.9、Playwright 1.61.1。

## Global Constraints

- 先完成《实施计划-06》Phase Gate。
- 仅监听 `127.0.0.1`；不扫描端口、不静默换端口、不强杀未知进程。
- 健康身份必须同时匹配 instanceId、PID/端口所有者、executable、projectRoot、dataRootHash、configFingerprint、buildId、protocolVersion。
- 密钥不得进入环境快照、日志、manifest、错误响应、Prompt artifact 或备份。
- 旧 Web build 与新 Server protocol 不兼容时必须硬刷新或显示阻断页，不能继续写数据。

---

## Task 1：实现 RuntimeConfig、manifest 与严格健康身份

**Files:**

- Modify: `apps/server/package.json`
- Create: `apps/server/src/runtime/runtime-config.ts`
- Create: `apps/server/src/runtime/runtime-manifest.ts`
- Create: `apps/server/src/runtime/runtime-manifest-repository.ts`
- Create: `apps/server/src/runtime/process-identity.ts`
- Modify: `apps/server/src/http/routes/health.ts`
- Test: `apps/server/src/runtime/process-identity.test.ts`
- Test: `apps/server/src/http/routes/health.test.ts`

**Interface:** config 含 dataRoot、timezone、ports、providerId、并发限制和日志级别；manifest 含身份字段、startedAt、generation、healthUrl。dataRoot 只存 hash，不存于浏览器响应。

- [ ] 写失败测试：错 instanceId、PID 复用、端口所有者不符、错 executable/projectRoot/dataRootHash/configFingerprint/buildId/protocolVersion 任一项都不得判 healthy。
- [ ] 运行 runtime/server 测试，预期失败。
- [ ] 配置优先级固定为 CLI 明确参数 > 环境变量 > `runtime.json` > 内置默认，并由唯一 RuntimeConfigResolver 解析；未知 key 拒绝。manifest 使用原子写并仅允许拥有相同 instanceId+generation 的进程删除。
- [ ] health 分为 `starting|ready|degraded|rebuilding|stopping`，并提供可公开 reason code，不返回路径。
- [ ] 运行 identity 笛卡尔测试，预期所有单字段篡改均失败。
- [ ] 提交：`git add apps/server/src/runtime apps/server/src/http/routes && git commit -m "feat(runtime): verify strict local process identity"`。

## Task 2：实现 Launcher 启动、控制面和安全自愈

**Files:**

- Create: `apps/launcher/package.json`
- Create: `apps/launcher/src/main.ts`
- Create: `apps/launcher/src/control-server.ts`
- Create: `apps/launcher/src/server-process.ts`
- Create: `apps/launcher/src/recovery-policy.ts`
- Test: `apps/launcher/src/recovery-policy.test.ts`
- Test: `apps/launcher/src/control-server.test.ts`

**Interfaces:** 控制面仅在 43119 提供 `GET /control/v1/status`、`POST /control/v1/reconnect`、`POST /control/v1/sync-frontend`、`POST /control/v1/diagnose`；写操作使用 Launcher 短期 capability 和自定义 header。recovery policy 只重启自身已验证实例，控制面不提供任意 start/stop 参数或命令执行。

- [ ] 写失败测试：无 manifest 启动；健康实例复用；陈旧 manifest 隔离；未知 43120 占用进入 `blocked_external_port`；错身份进程不终止；10 分钟内第 6 次崩溃进入 `blocked_restart_storm`；非法配置和数据恢复分别进入对应 blocked 状态。
- [ ] 运行 launcher 测试，预期失败。
- [ ] 启动顺序：加 launcher lease、校验 manifest/进程/端口、恢复 store、启动 server、轮询 identity health、进入无界面监督循环。Launcher 永不打开浏览器；仅显式交互包装器在 ready 后打开一次主页。用 `spawn` 参数数组并 `shell:false`，生产窗口隐藏。
- [ ] Launcher 状态固定为 `stopped -> starting -> healthy -> degraded -> restarting -> backoff -> healthy`；意外退出退避为 0.5s/1s/2s/4s/8s，10 分钟最多自动重启 5 次。配置变化 750ms debounce，同批只重启一次；store corrupted、migration failed、外部端口占用不自动重启循环。
- [ ] 控制面校验 loopback、Host、精确 Origin、自定义 header 和短期 capability；reconnect 的受控重启停止新命令/任务、持久化游标、关闭计时区间、等待最多 10 秒，超时后只终止匹配完整身份的 child process。浏览器固定展示核验实例、重连服务、等待健康、刷新 AI 四阶段。
- [ ] 运行测试和真实子进程 smoke，预期通过。
- [ ] 提交：`git add apps/launcher && git commit -m "feat(launcher): start and heal verified local runtime"`。

## Task 3：实现 DPAPI SecretStore 与 Provider 运行时切换

**Files:**

- Create: `apps/server/src/runtime/secret-store.ts`
- Create: `apps/server/src/runtime/windows-dpapi-secret-store.ts`
- Create: `apps/server/src/runtime/environment-secret-store.ts`
- Create: `apps/server/src/runtime/memory-secret-store.ts`
- Create: `apps/server/src/runtime/provider-config-service.ts`
- Create: `apps/server/src/http/routes/runtime.ts`
- Test: `apps/server/src/runtime/secret-store.contract.test.ts`
- Test: `apps/server/src/runtime/provider-config-service.test.ts`

**Interfaces:**

~~~ts
export interface SecretStore {
  put(handle: string, secret: Uint8Array): Promise<void>;
  get(handle: string): Promise<Uint8Array>;
  delete(handle: string): Promise<void>;
  describe(handle: string): Promise<{
    configured: boolean;
    updatedAt?: string;
    fingerprint?: string;
  }>;
}
~~~

- [ ] 写共用合同：Uint8Array round-trip、覆盖、删除、Unicode handle、空 secret 拒绝和不泄露 fingerprint；磁盘搜索不能发现明文。写 provider switch 测试：新任务使用新 provider，运行中任务保持原 providerId，失败切换不改变 active config。
- [ ] 运行 runtime 测试，预期失败。
- [ ] Windows 正式 adapter 使用当前用户 DPAPI，密文文件权限收紧；开发/CI 使用只读 EnvironmentSecretStore，纯单元测试才使用 Memory adapter。日志一律只写 secret name/存在性；生产在 DPAPI 不可用时阻断 Provider 配置而非降级明文。
- [ ] `POST /api/v1/ai-runtime/provider-switches` 先校验 config、secret presence 和 health，再原子切 config fingerprint；响应只含 providerId、capabilities、health。
- [ ] 运行合同、安全扫描和并发任务测试，预期通过。
- [ ] 提交：`git add apps/server/src/runtime apps/server/src/http/routes && git commit -m "feat(runtime): protect secrets and switch providers safely"`。

## Task 4：完成 React 路由、统一状态与版本同步

**Files:**

- Modify: `apps/web/src/app.tsx`
- Create: `apps/web/src/router.tsx`
- Create: `apps/web/src/layouts/app-shell.tsx`
- Create: `apps/web/src/features/runtime/runtime-center.tsx`
- Create: `apps/web/src/client/sse-client.ts`
- Create: `apps/web/src/state/page-instance.ts`
- Create: `apps/web/src/state/version-guard.ts`
- Test: `apps/web/src/router.test.tsx`
- Test: `apps/web/src/features/runtime/runtime-center.test.tsx`

**Interface:** 路由固定为 `/`、`/courses/new`、`/courses/:courseId`、`/courses/:courseId/lessons/:lessonId`、`/planning`、`/history`、`/profile`、`/runtime`。所有页面统一支持 loading/empty/error/degraded/rebuilding/version-mismatch。

- [ ] 写失败测试：每条路由可深链刷新；服务退出显示重连且保留输入；protocol mismatch 阻止写操作；buildId 变化提示刷新；SSE reset 拉取任务快照；未知路由提供回首页。
- [ ] 运行 web 测试，预期失败。
- [ ] 实现单一 typed API client 和 SSE client；每个 tab 生成稳定 pageInstanceId；ETag/If-Match 和 idempotency key 由 command hook 管理但可在重试中复用。
- [ ] Runtime Center 显示公开身份、store/projection/provider/task 状态、重连/安全重启动作；绝不显示 dataRoot 绝对路径或 secret。
- [ ] 运行键盘导航、焦点恢复和 sanitizer 测试，预期通过。
- [ ] 提交：`git add apps/web && git commit -m "feat(web): unify routes runtime states and version guards"`。

## Task 5：实现日志、诊断包与非功能基准

**Files:**

- Create: `apps/server/src/runtime/logger.ts`
- Create: `apps/server/src/runtime/redaction.ts`
- Create: `apps/server/src/runtime/diagnostics.ts`
- Create: `tools/benchmarks/package.json`
- Create: `tools/benchmarks/src/startup.ts`
- Create: `tools/benchmarks/src/query-latency.ts`
- Create: `tools/benchmarks/src/sse-latency.ts`
- Test: `apps/server/src/runtime/redaction.test.ts`

**Interfaces:** 结构日志含 timestamp、level、component、instanceId、correlationId、event code；禁止 message 正文、Prompt、secret、绝对 data path。诊断包仅含 redacted logs、公开 config、manifest 摘要和 checksum 报告。

- [ ] 写失败测试，把 API key、Bearer token、Windows 路径、Prompt 和消息正文放入嵌套错误，断言序列化输出均被替换。
- [ ] 运行 runtime 测试，预期失败。
- [ ] 实现 key-based + pattern-based redaction，Error 仅输出 name/code/public message。runtime、application、generation、projection、security 分流 JSONL，滚动文件合计最多 200 MiB、保留最多 30 天，不进入业务备份。
- [ ] 代表性基准数据集生成 100 courses、10,000 sessions/messages refs、100,000 events；测强一致查询 p95 ≤200ms、非 AI 写 p95 ≤350ms、Provider delta→SSE p95 ≤100ms、outbox p95 ≤2s、空闲投影延迟 p95 ≤5s、冷启动 p95 ≤5s、单事务恢复 p95 ≤15s、Server 自动恢复 ≤15s、Server 空闲 RSS ≤300MiB、Launcher 空闲 RSS ≤80MiB。阶段 08 再以完整容量目标执行 release gate。
- [ ] 连续运行 5 次，取中位数；门槛失败输出指标而非自动放宽。
- [ ] 提交：`git add apps/server/src/runtime tools/benchmarks && git commit -m "test(runtime): add redaction and performance budgets"`。

## Task 6：运行自愈系统 E2E

**Files:**

- Create: `tests/e2e/runtime-self-heal.spec.ts`
- Create: `tests/e2e/runtime-version-sync.spec.ts`
- Create: `tests/e2e/runtime-provider-switch.spec.ts`
- Create: `tools/test-processes/foreign-port-owner.ts`

- [ ] 写 Playwright/子进程测试：正常启动复用、server 意外退出后自愈、外部占用 43120 不被杀、错误 manifest、错误 dataRootHash、旧 Web build、控制 token 错误、Provider 切换和 secret 重启可用。
- [ ] 先运行 `pnpm playwright test tests/e2e/runtime-*.spec.ts`，预期因场景未实现失败。
- [ ] 为每个测试分配临时用户 config/data root，但端口行为按生产固定端口串行执行；foreign owner 子进程写唯一 marker，测试结束验证仍存活后再正常关闭。
- [ ] 运行全部 runtime E2E 两次，预期无悬挂 node 进程、无明文 secret、无端口泄漏。
- [ ] 运行 `pnpm verify` 和 benchmark；更新对应 equivalence matrix 并验证。
- [ ] 提交：`git add tests/e2e tools/test-processes docs/架构方案/equivalence-matrix.yaml && git commit -m "test: verify local runtime identity and self healing"`。

## Phase Gate

- 所有健康身份字段都参与验证，PID 复用与外部端口所有者不会被误杀。
- Launcher 启停、自愈、退避、manual-action 和控制 token 测试通过。
- DPAPI 密钥不以明文出现在数据根、日志、诊断、HTTP 或备份输入。
- 全部路由可深链刷新并统一处理 degraded/rebuilding/version mismatch。
- 冷启动、查询和 SSE 延迟达到架构量化目标。
- runtime E2E、`pnpm verify` 与矩阵检查通过。
