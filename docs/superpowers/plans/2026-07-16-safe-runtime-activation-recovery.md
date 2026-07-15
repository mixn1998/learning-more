# Learning MORE 安全运行时激活与一键自愈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运行中心的“一键重连”和“同步前端版本”能够安全修复失败的工作区激活、切换到目标 release、验证 Server 与页面版本，并在本地恢复成功后刷新 AI Provider。

**Architecture:** Host 是候选构建和 release 切换的唯一写入者，并持久化可恢复的 schema v2 激活状态；Launcher 提交请求、等待 Host 接受、执行一次受限 Host 修复，并在旧 Launcher 被替换后继续从持久化文件向控制面投影终态；Web 同时轮询 Launcher 终态、Runtime readiness 和实际静态页面，只在三方 `buildId` 一致后宣告成功。服务端组合根保持不变，本功能只消费既有 `/api/v1/runtime/ready` 只读合同。

**Tech Stack:** TypeScript 5.9、Node.js 24、Fastify/Node HTTP、React 19、Zod、Vitest、Playwright、Windows Task Scheduler、pnpm portable release

## Global Constraints

- 新候选通过全部验证前，旧活动 release 保持可回滚；失败时旧 release 必须重新就绪。
- 只清理当前 `requestId` 和当前 attempt 创建的临时目录，不删除活动 release、上一可回滚 release、`.learning-more-data`、密钥目录或用户课程数据。
- 候选构建最多两次；首次失败后清理并自动重试一次，第二次失败立即发布终态。
- 只允许启动或停止身份与任务定义匹配的 Learning MORE Host、Launcher 和 Server；外部端口占用者绝不强杀或接管。
- 控制面只返回稳定错误码和阶段，不返回绝对路径、命令行、密钥、原始堆栈或用户数据。
- 页面仅在 Host active、Runtime ready 和 served web 三方 `buildId` 及 `protocolVersion` 一致后刷新。
- AI Provider 刷新失败不回滚已经成功的本地 release 激活，但必须单独显示失败。
- 不修改 `apps/server/src/bootstrap/local-application.ts`、`apps/server/src/bootstrap/local-application/**`、`apps/server/src/bootstrap/main.ts` 或任何课程/学习/画像业务 Module。
- 每个 Task 先写失败测试，再实现最小行为；每个提交只包含该 Task 文件。

---

## File Map

- `packages/contracts/src/runtime.ts`: 控制面公开的激活进度、错误码、served web build 元数据和 Launcher 状态合同。
- `packages/contracts/src/runtime.test.ts`: 严格合同的接受/拒绝测试。
- `apps/web/vite.config.ts`: 每次 Web build 生成不可变 `build-meta.json`。
- `tools/release/src/build-portable.ts`: 支持 request-scoped output/work root，允许候选构建延迟写工作区 build manifest。
- `tools/release/src/build-portable.test.ts`: 候选目录隔离、build meta 和 manifest 提交时机测试。
- `apps/host/src/workspace-activation-status.ts`: schema v1 兼容读取、schema v2 写入、原子发布和稳定错误映射。
- `apps/host/src/workspace-activation.ts`: 两次候选构建、request-scoped 清理、身份复核、Supervisor 激活和 manifest 提交。
- `apps/host/src/workspace-activation.test.ts`: Host 失败重试、清理、回滚和状态持久化测试。
- `apps/host/src/main.ts`: 将 ActivationRepository active build 和 manifest 提交能力注入 worker；不依赖 Server 组合根。
- `apps/host/src/launcher-process.ts`: 向 Launcher 传递受限 Host repair 所需的明确入口和工作区根。
- `apps/host/src/launcher-process.test.ts`: 环境变量与进程身份测试。
- `apps/launcher/src/workspace-activation.ts`: 提交请求、等待 Host 接受，并读取可跨 Launcher 重启恢复的同一请求终态。
- `apps/launcher/src/workspace-activation.test.ts`: 新建；覆盖请求接受、首次响应修复、终态恢复、错误投影和超时。
- `apps/launcher/src/local-runtime.ts`: 真实 `syncFrontend`、Host repair adapter 和激活请求接线。
- `apps/launcher/src/local-runtime.test.ts`: adapter 命令与统一激活路径测试。
- `apps/launcher/src/main.ts`: Launcher 状态保存激活详情，并让 reconnect/sync-frontend 复用同一入口。
- `apps/launcher/src/main.test.ts`: 状态收敛与无重复 Server 重启测试。
- `apps/launcher/src/control-server.ts`: 保留稳定 HTTP 路径并返回结构化失败。
- `apps/launcher/src/control-server.test.ts`: 控制接口终态和错误码测试。
- `apps/web/src/client/runtime-client.ts`: 获取 Launcher 状态、Runtime readiness 和 served web meta，并做三方验证。
- `apps/web/src/state/runtime-recovery-coordinator.ts`: 统一编排本地激活、版本验证、页面状态和 AI 刷新。
- `apps/web/src/state/runtime-recovery-coordinator.test.ts`: 三方一致、激活失败、页面旧版本和 AI 单独失败测试。
- `apps/web/src/layouts/app-shell.tsx`: 接入真实 verify，目标版本通过后才 reload。
- `apps/web/src/features/runtime/runtime-center.tsx`: 展示激活阶段、稳定错误、旧版本可用性和重试能力。
- `apps/web/src/features/runtime/runtime-center.test.tsx`: 运行中心状态和按钮行为测试。
- `tests/e2e/runtime-version-sync.spec.ts`: 真实旧页面/新 release 激活场景。
- `tests/recovery/full-fault-matrix.test.ts`: 连续构建失败、外部端口和身份不匹配安全场景。

### Task 1: 锁定公开激活与页面版本合同

**Files:**
- Modify: `packages/contracts/src/runtime.ts`
- Modify: `packages/contracts/src/runtime.test.ts`

**Interfaces:**
- Produces: `ActivationErrorCodeSchema`、`WorkspaceActivationProgressSchema`、`WebBuildMetaSchema`、扩展后的 `LauncherRuntimeStatusSchema`。
- Consumes: 现有 `RuntimeReadySchema` 和 `LauncherControlStatusSchema`。

- [ ] **Step 1: 写失败的严格 schema 测试**

在 `runtime.test.ts` 增加：

```ts
it('accepts terminal activation progress and served web identity', () => {
  const activation = WorkspaceActivationProgressSchema.parse({
    schemaVersion: 2,
    requestId: 'request_01',
    phase: 'failed',
    sourceBuildId: 'build_new',
    activeBuildId: 'build_old',
    targetBuildId: 'build_new',
    attempt: 2,
    errorCode: 'candidate_build_failed',
    errorStage: 'building',
    startedAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:01:00.000Z',
    completedAt: '2026-07-16T00:01:00.000Z',
  });
  expect(
    LauncherRuntimeStatusSchema.parse({
      state: 'activation_failed',
      crashCount: 0,
      targetBuildId: 'build_new',
      activation,
    }),
  ).toMatchObject({ state: 'activation_failed', activation: { attempt: 2 } });
  expect(
    WebBuildMetaSchema.parse({ schemaVersion: 1, buildId: 'build_new', protocolVersion: '1' }),
  ).toEqual({ schemaVersion: 1, buildId: 'build_new', protocolVersion: '1' });
});

it('rejects activation details and served web metadata with undeclared fields', () => {
  expect(() =>
    WebBuildMetaSchema.parse({
      schemaVersion: 1,
      buildId: 'build_new',
      protocolVersion: '1',
      absolutePath: 'D:/secret',
    }),
  ).toThrow();
});
```

- [ ] **Step 2: 运行合同测试并确认失败**

Run: `node node_modules/vitest/vitest.mjs run packages/contracts/src/runtime.test.ts --maxWorkers=1`

Expected: FAIL，因为三个 schema 尚未导出，`activation_failed` 尚未声明。

- [ ] **Step 3: 实现严格公开合同**

在 `runtime.ts` 增加：

```ts
export const ActivationErrorCodeSchema = z.enum([
  'source_identity_unavailable',
  'workspace_identity_changed',
  'candidate_build_failed',
  'candidate_stage_failed',
  'candidate_verification_failed',
  'activation_rolled_back',
  'host_unavailable',
  'host_identity_mismatch',
  'external_port_owner',
  'runtime_ready_timeout',
  'served_web_build_mismatch',
]);

export const WorkspaceActivationProgressSchema = z.strictObject({
  schemaVersion: z.literal(2),
  requestId: z.string().trim().min(1).max(200),
  phase: z.enum([
    'queued', 'verifying', 'building', 'cleaning', 'retrying', 'staging',
    'activating', 'verifying-runtime', 'activated', 'failed',
  ]),
  sourceBuildId: z.string().trim().min(1).max(200).optional(),
  activeBuildId: z.string().trim().min(1).max(200).optional(),
  targetBuildId: z.string().trim().min(1).max(200).optional(),
  attempt: z.union([z.literal(1), z.literal(2)]),
  errorCode: ActivationErrorCodeSchema.optional(),
  errorStage: z.string().regex(/^[a-z0-9_-]+$/).optional(),
  startedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).optional(),
});

export const WebBuildMetaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  buildId: z.string().trim().min(1).max(200),
  protocolVersion: z.string().trim().min(1).max(50),
});
```

把 `activation_failed` 加入 Launcher state enum，并给 `LauncherRuntimeStatusSchema` 增加 `activation: WorkspaceActivationProgressSchema.optional()`。

- [ ] **Step 4: 运行合同测试与 schema 检查**

Run: `node node_modules/vitest/vitest.mjs run packages/contracts/src/runtime.test.ts --maxWorkers=1`

Expected: PASS。

Run: `corepack pnpm schema:check`

Expected: 退出码 0；若生成物发生预期变化，运行 `corepack pnpm schema:generate` 后再次检查。

- [ ] **Step 5: 提交合同**

```powershell
git add packages/contracts/src/runtime.ts packages/contracts/src/runtime.test.ts packages/contracts/openapi
git commit -m "feat(runtime): define activation recovery contracts"
```

### Task 2: 隔离候选构建并生成 served web 身份

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `tools/release/src/build-portable.ts`
- Modify: `tools/release/src/build-portable.test.ts`

**Interfaces:**
- Produces: `buildPortableRelease(projectRoot, options?)` 和每个 Web dist 根目录的 `build-meta.json`。
- Consumes: `VITE_BUILD_ID`、固定 `protocolVersion: '1'`、现有 `PortableBuildResult`。

- [ ] **Step 1: 写失败测试，锁定 request-scoped 构建与 meta**

新增测试断言：

```ts
expect(JSON.parse(await readFile(path.join(result.expandedRoot, 'app/web/build-meta.json'), 'utf8')))
  .toEqual({ schemaVersion: 1, buildId: result.buildId, protocolVersion: '1' });
expect(await pathExists(path.join(projectRoot, '.learning-more-build.json'))).toBe(false);
expect(result.expandedRoot.startsWith(candidateOutputRoot)).toBe(true);
```

调用方式固定为：

```ts
await buildPortableRelease(projectRoot, {
  outputRoot: candidateOutputRoot,
  workRoot: candidateWorkRoot,
  writeWorkspaceManifest: false,
});
```

- [ ] **Step 2: 运行 release 测试并确认失败**

Run: `node node_modules/vitest/vitest.mjs run tools/release/src/build-portable.test.ts --maxWorkers=1`

Expected: FAIL，因为 options 与 `build-meta.json` 尚不存在。

- [ ] **Step 3: 实现 Vite build meta 插件**

在 `vite.config.ts` 定义并加入 plugins：

```ts
function buildMetaPlugin() {
  return {
    name: 'learning-more-build-meta',
    generateBundle() {
      this.emitFile({
        type: 'asset' as const,
        fileName: 'build-meta.json',
        source: `${JSON.stringify({
          schemaVersion: 1,
          buildId: process.env.VITE_BUILD_ID ?? 'development',
          protocolVersion: '1',
        })}\n`,
      });
    },
  };
}
```

`plugins` 改为 `[react(), buildMetaPlugin()]`。

- [ ] **Step 4: 为 portable builder 增加显式 options**

```ts
export type PortableBuildOptions = Readonly<{
  outputRoot?: string;
  workRoot?: string;
  writeWorkspaceManifest?: boolean;
}>;

export async function buildPortableRelease(
  projectRoot = path.resolve('.'),
  options: PortableBuildOptions = {},
): Promise<PortableBuildResult> {
  const outputRoot = options.outputRoot ?? path.join(projectRoot, 'release', 'dist');
  const workRoot = options.workRoot ?? path.join(projectRoot, 'release', '.work');
  // 其余构建保持现状。
  if (options.writeWorkspaceManifest ?? true) {
    await writeWorkspaceBuildManifest(projectRoot, sourceIdentity, buildId);
  }
}
```

只删除传入的 `outputRoot` 和 `workRoot`；不得向其父目录递归删除。

- [ ] **Step 5: 运行 release 测试与 Web build**

Run: `node node_modules/vitest/vitest.mjs run tools/release/src/build-portable.test.ts --maxWorkers=1`

Expected: PASS。

Run: `corepack pnpm --filter @learning-more/web build`

Expected: `apps/web/dist/build-meta.json` 存在，内容为当前 `VITE_BUILD_ID` 或 `development`。

- [ ] **Step 6: 提交构建隔离**

```powershell
git add apps/web/vite.config.ts tools/release/src/build-portable.ts tools/release/src/build-portable.test.ts
git commit -m "feat(release): isolate activation candidates"
```

### Task 3: Host 持久化终态、自动清理并重试一次

**Files:**
- Create: `apps/host/src/workspace-activation-status.ts`
- Modify: `apps/host/src/workspace-activation.ts`
- Modify: `apps/host/src/workspace-activation.test.ts`
- Modify: `apps/host/src/main.ts`

**Interfaces:**
- Produces: `WorkspaceActivationStatusStore`、schema v2 状态、最多两次的激活 worker。
- Consumes: Task 2 的 `buildPortableRelease(..., { writeWorkspaceManifest: false })`、`ActivationRepository.current()`、`HostSupervisor.activateCandidate()`。

- [ ] **Step 1: 写 Host 失败重试和旧 release 保留测试**

覆盖以下主测试：

```ts
it('cleans only request assets and succeeds on the second build attempt', async () => {
  buildCandidate.mockRejectedValueOnce(new Error('build_failed'))
    .mockResolvedValueOnce({ expandedRoot: candidateRoot, buildId: 'build_new' });
  await worker.processPending();
  expect(buildCandidate).toHaveBeenCalledTimes(2);
  expect(cleanAttempt).toHaveBeenCalledWith(requestId, 1);
  expect(supervisor.activateCandidate).toHaveBeenCalledWith('build_new');
  expect(await readStatus()).toMatchObject({ phase: 'activated', attempt: 2 });
});

it('publishes a stable failure after two attempts without changing the active build', async () => {
  buildCandidate.mockRejectedValue(new Error('build_failed'));
  await worker.processPending();
  expect(await readActiveBuildId()).toBe('build_old');
  expect(await readStatus()).toMatchObject({
    phase: 'failed', attempt: 2, errorCode: 'candidate_build_failed', activeBuildId: 'build_old',
  });
});
```

另加 v1 终态兼容读取、workspace identity 变化、stage 失败和 Supervisor rollback 测试。

- [ ] **Step 2: 运行 Host activation 测试并确认失败**

Run: `node node_modules/vitest/vitest.mjs run apps/host/src/workspace-activation.test.ts --maxWorkers=1`

Expected: FAIL，因为当前只写 schema v1、吞掉错误且没有重试。

- [ ] **Step 3: 创建状态深 Module**

`workspace-activation-status.ts` 对外只暴露：

```ts
export interface WorkspaceActivationStatusStore {
  read(): Promise<WorkspaceActivationProgress | undefined>;
  publish(status: WorkspaceActivationProgress): Promise<void>;
}

export function activationFailure(error: unknown, stage: string): Readonly<{
  errorCode: ActivationErrorCode;
  errorStage: string;
}>;

export function createWorkspaceActivationStatusStore(options: {
  path: string;
}): WorkspaceActivationStatusStore;
```

读取器接受旧 schema v1 的 `unchanged`、`activated`、`failed` 终态并映射成只读兼容结果；发布器只写 schema v2。`activationFailure` 按当前阶段映射稳定错误码，未知构建异常映射为 `candidate_build_failed`，不得序列化原错误文本。

- [ ] **Step 4: 实现两次 attempt worker**

核心循环固定为：

```ts
for (const attempt of [1, 2] as const) {
  try {
    await publish('building', attempt);
    const candidate = await buildCandidate({ requestId, attempt });
    const finalIdentity = await readIdentity(options.projectRoot);
    if (candidate.buildId !== finalIdentity.buildId) {
      throw new ActivationFailure('workspace_identity_changed', 'verifying');
    }
    await publish('staging', attempt, { targetBuildId: candidate.buildId });
    await stage(candidate.expandedRoot, releaseRoot(candidate.buildId));
    await publish('activating', attempt, { targetBuildId: candidate.buildId });
    const result = await options.supervisor.activateCandidate(candidate.buildId);
    if (result.state !== 'activated') {
      throw new ActivationFailure('activation_rolled_back', 'activating');
    }
    await options.commitWorkspaceManifest(finalIdentity, candidate.buildId);
    await publishTerminal('activated', attempt, { activeBuildId: candidate.buildId });
    return;
  } catch (error) {
    await publish('cleaning', attempt);
    await cleanAttempt(requestId, attempt);
    if (attempt === 1) {
      await publish('retrying', 2);
      continue;
    }
    await publishFailure(error, attempt, await options.readActiveBuildId());
  }
}
```

`buildCandidate` 的默认实现使用 `releasesRoot/.activation-work/<requestId>/attempt-<n>/{output,work}`；`cleanAttempt` 先 `path.resolve` 并验证结果仍位于该 request 根下，再 `rm(..., { recursive: true, force: true })`。

- [ ] **Step 5: 让 ActivationRepository 成为 active build 事实源**

在 `apps/host/src/main.ts` 注入：

```ts
readActiveBuildId: async () => (await activation.current()).activeBuildId,
commitWorkspaceManifest: async (sourceIdentity, buildId) => {
  const release = await import(pathToFileURL(path.join(resolvedRoot, 'tools/release/dist/source-identity.js')).href);
  await release.writeWorkspaceBuildManifest(resolvedRoot, sourceIdentity, buildId);
},
```

删除 worker 对 manifest backup/restore 的依赖；manifest 只在 Supervisor 已提交 candidate 后写入。

- [ ] **Step 6: 运行 Host 测试和类型检查**

Run: `node node_modules/vitest/vitest.mjs run apps/host/src/workspace-activation.test.ts apps/host/src/supervisor.test.ts apps/host/src/supervisor.integration.test.ts --maxWorkers=1`

Expected: PASS，且 rollback 测试确认旧实例重新 ready。

Run: `corepack pnpm --filter @learning-more/host typecheck`

Expected: 退出码 0。

- [ ] **Step 7: 提交 Host 自愈**

```powershell
git add apps/host/src/workspace-activation-status.ts apps/host/src/workspace-activation.ts apps/host/src/workspace-activation.test.ts apps/host/src/main.ts
git commit -m "feat(host): self-heal failed workspace activation"
```

### Task 4: Launcher 接受请求、恢复终态并安全修复 Host

**Files:**
- Modify: `apps/host/src/launcher-process.ts`
- Modify: `apps/host/src/launcher-process.test.ts`
- Modify: `apps/launcher/src/workspace-activation.ts`
- Create: `apps/launcher/src/workspace-activation.test.ts`
- Modify: `apps/launcher/src/local-runtime.ts`
- Modify: `apps/launcher/src/local-runtime.test.ts`
- Modify: `apps/launcher/src/recovery-policy.ts`
- Modify: `apps/launcher/src/main.ts`
- Modify: `apps/launcher/src/main.test.ts`
- Modify: `apps/launcher/src/control-server.ts`
- Modify: `apps/launcher/src/control-server.test.ts`

**Interfaces:**
- Produces: `requestWorkspaceActivation(): Promise<WorkspaceActivationResult>`，reconnect 与 sync-frontend 共用的 activation path。
- Consumes: Task 1 的公开进度合同和 Task 3 的 schema v2 状态文件。

- [ ] **Step 1: 写 Launcher 请求接受、终态恢复与一次 repair 测试**

```ts
it('returns rebuilding only after Host accepts the matching request', async () => {
  statuses.push(building);
  await expect(requestWorkspaceActivation(options)).resolves.toMatchObject({
    mode: 'activate', targetBuildId: 'build_new', activation: { phase: 'building' },
  });
});

it('repairs Host once when it never acknowledges the request', async () => {
  now.mockReturnValueOnce(0).mockReturnValueOnce(5_100).mockReturnValue(5_200);
  await requestWorkspaceActivation({ ...options, repairHost });
  expect(repairHost).toHaveBeenCalledOnce();
});

it('restores the matching terminal failure after Launcher replacement', async () => {
  await expect(readWorkspaceActivationStatus(options)).resolves.toMatchObject({
    phase: 'failed', errorCode: 'candidate_build_failed', activeBuildId: 'build_old',
  });
});
```

- [ ] **Step 2: 运行 Launcher 测试并确认失败**

Run: `node node_modules/vitest/vitest.mjs run apps/launcher/src/workspace-activation.test.ts apps/launcher/src/main.test.ts apps/launcher/src/local-runtime.test.ts --maxWorkers=1`

Expected: FAIL，因为当前没有 schema v2 终态读取、首次响应 repair 或真实 `syncFrontend()`。

- [ ] **Step 3: 向 Launcher 传递受限 Host repair 描述**

`startOrAdoptLauncher` 增加 `hostEntry` 和 `hostProjectRoot`，子进程环境只增加：

```ts
LEARNING_MORE_HOST_ENTRY: options.hostEntry,
LEARNING_MORE_HOST_PROJECT_ROOT: options.hostProjectRoot,
```

Host main 始终传当前受信 Host entry 和原始 `resolvedRoot`；不从请求 body 或浏览器参数接受路径。

- [ ] **Step 4: 接受请求并提供可恢复终态读取**

`requestWorkspaceActivation` 返回类型固定为：

```ts
export type WorkspaceActivationResult =
  | Readonly<{ mode: 'reconnect'; activation?: WorkspaceActivationProgress }>
  | Readonly<{
      mode: 'activate';
      targetBuildId: string;
      activation: WorkspaceActivationProgress;
    }>;
```

请求轮询只接受 `status.requestId === requestId`。Host 发布首个包含 `sourceBuildId` 或 `targetBuildId` 的状态后返回 `mode: 'activate'`，但调用者只能将其显示为 `rebuilding`，不能显示完成。首个有效状态在 5 秒内未出现时只调用一次 `repairHost()`；最终未接受时返回 `host_unavailable`。另导出 `readWorkspaceActivationStatus()`，使当前或替换后的 Launcher 每次 GET status 都从持久化文件读取 `activated` / `failed` 终态。

- [ ] **Step 5: 实现受限 Host repair adapter**

在 `local-runtime.ts` 使用 `execFile`，参数只能来自 Host 注入环境：

```ts
repairHost: async () => {
  if (options.hostEntry === undefined || options.hostProjectRoot === undefined) {
    throw new Error('host_unavailable');
  }
  await execute(process.execPath, [
    options.hostEntry, 'repair', '--project-root', options.hostProjectRoot,
  ], options.hostProjectRoot);
},
```

Host `repair` 内部继续核对固定计划任务定义并使用 `multipleInstances: ignore-new`；Launcher 不枚举、不终止任意进程。

- [ ] **Step 6: 统一 reconnect 与 sync-frontend**

在 Launcher runtime 内提取：

```ts
const activateWorkspace = async () => {
  const result = await dependencies.requestWorkspaceActivation?.();
  if (result?.mode === 'activated') {
    state = 'healthy';
    targetBuildId = result.targetBuildId;
    activation = result.activation;
    return status();
  }
  return restartVerifiedServer();
};
```

`reconnect()` 调用 `activateWorkspace()`；`syncFrontend()` 也调用 `activateWorkspace()`，但 Web 层不会在其后调用 Provider reconnect。控制 GET 每次合并 `readWorkspaceActivationStatus()`：中间态为 `rebuilding`，`failed` 为 `activation_failed`，`activated` 且当前 Launcher build 匹配时为 `healthy`。不得把请求已接受或旧 Server 健康改写为目标激活成功。

- [ ] **Step 7: 控制接口返回公开错误**

`control-server.ts` 捕获 `WorkspaceActivationError` 时返回：

```ts
return response(503, {
  code: error.code,
  activation: error.activation,
  oldRuntimeAvailable: error.activation.activeBuildId !== undefined,
}, corsHeaders);
```

其他错误仍返回 `control_action_failed`；响应不得含 `error.message` 或 stack。

- [ ] **Step 8: 运行 Launcher/Host 接线测试**

Run: `node node_modules/vitest/vitest.mjs run apps/host/src/launcher-process.test.ts apps/launcher/src/workspace-activation.test.ts apps/launcher/src/local-runtime.test.ts apps/launcher/src/main.test.ts apps/launcher/src/control-server.test.ts --maxWorkers=1`

Expected: PASS。

Run: `corepack pnpm --filter @learning-more/launcher typecheck`

Expected: 退出码 0。

- [ ] **Step 9: 提交 Launcher 协调器**

```powershell
git add apps/host/src/launcher-process.ts apps/host/src/launcher-process.test.ts apps/launcher/src/workspace-activation.ts apps/launcher/src/workspace-activation.test.ts apps/launcher/src/local-runtime.ts apps/launcher/src/local-runtime.test.ts apps/launcher/src/recovery-policy.ts apps/launcher/src/main.ts apps/launcher/src/main.test.ts apps/launcher/src/control-server.ts apps/launcher/src/control-server.test.ts
git commit -m "feat(launcher): wait for terminal workspace activation"
```

### Task 5: Web 执行真实三方版本验证

**Files:**
- Modify: `apps/web/src/client/runtime-client.ts`
- Modify: `apps/web/src/state/runtime-recovery-coordinator.ts`
- Modify: `apps/web/src/state/runtime-recovery-coordinator.test.ts`
- Modify: `apps/web/src/layouts/app-shell.tsx`
- Modify: `apps/web/src/features/runtime/runtime-center.tsx`
- Modify: `apps/web/src/features/runtime/runtime-center.test.tsx`

**Interfaces:**
- Produces: `verifyRuntimeActivation(targetBuildId)` 和包含公开激活错误的恢复快照。
- Consumes: Task 1 的 `WebBuildMetaSchema`/Launcher contract、Task 4 的控制响应、现有 `RuntimeReady`。

- [ ] **Step 1: 写三方版本失败测试**

在 coordinator 测试覆盖：

```ts
it('does not complete when the served web build remains old', async () => {
  const dependencies = createDependencies({
    reconnect: { targetBuildId: 'build_new' },
    readiness: { ...readiness, buildId: 'build_new' },
    webBuild: { schemaVersion: 1, buildId: 'build_old', protocolVersion: '1' },
  });
  await expect(coordinator.recover(dependencies)).rejects.toThrow('served_web_build_mismatch');
  expect(coordinator.snapshot()).toMatchObject({
    kind: 'failed', reason: 'served_web_build_mismatch',
  });
});

it('keeps local activation completed when only AI refresh fails', async () => {
  dependencies.refreshAi.mockRejectedValue(new Error('provider_failed'));
  await coordinator.recover(dependencies);
  expect(coordinator.snapshot()).toMatchObject({ kind: 'completed', aiRecoveryFailed: true });
});
```

- [ ] **Step 2: 运行 Web 恢复测试并确认失败**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/state/runtime-recovery-coordinator.test.ts apps/web/src/features/runtime/runtime-center.test.tsx --maxWorkers=1`

Expected: FAIL，因为 verify 仍为空且 client 不读取 `build-meta.json`。

- [ ] **Step 3: 实现 client 三方验证**

`RuntimeCenterClient` 增加：

```ts
getLauncherStatus(): Promise<LauncherRuntimeStatus>;
getServedWebBuild(): Promise<WebBuildMeta>;
verifyRuntimeActivation(targetBuildId: string): Promise<RuntimeReady>;
```

验证实现固定为：

```ts
const [launcher, readiness, web] = await Promise.all([
  getLauncherStatus(), fetchRuntimeReadiness(), getServedWebBuild(),
]);
if (launcher.activation?.phase !== 'activated' ||
    launcher.activation.activeBuildId !== targetBuildId ||
    readiness.buildId !== targetBuildId ||
    web.buildId !== targetBuildId ||
    readiness.protocolVersion !== web.protocolVersion) {
  throw new Error(web.buildId !== targetBuildId
    ? 'served_web_build_mismatch'
    : 'runtime_build_mismatch');
}
return readiness;
```

`getServedWebBuild()` 请求 `/build-meta.json?operation=<timestamp>`，使用 `cache: 'no-store'` 并由 `WebBuildMetaSchema` 解析。

- [ ] **Step 4: 调整协调器顺序**

依赖改为：

```ts
verifyCurrent(): Promise<void>;
reconnect(): Promise<LauncherRuntimeStatus>;
waitUntilReady(targetBuildId?: string): Promise<RuntimeReady>;
verifyActivated(targetBuildId: string): Promise<RuntimeReady>;
refreshRuntime(readiness: RuntimeReady): Promise<void>;
refreshAi(): Promise<void>;
```

流程为 current verify → reconnect/activation → runtime ready → activated three-way verify → refresh local state → refresh AI。`reconnect` 返回 `activation_failed` 时立即停止，不进入五分钟轮询。

- [ ] **Step 5: 替换 AppShell 空 verify**

`app-shell.tsx` 不再传 `verify: async () => undefined`，改为调用 client 的 current identity probe；激活后只在 `verifyActivated` 返回成功且目标 build 与当前 bundle 不同时执行 `location.reload()`。

- [ ] **Step 6: 运行中心显示真实失败**

恢复快照的 failed 分支增加：

```ts
activation?: WorkspaceActivationProgress;
oldRuntimeAvailable?: boolean;
```

运行中心显示稳定中文映射，例如 `candidate_build_failed → 候选版本连续两次构建失败`、`external_port_owner → 端口由其他程序占用，未执行强制接管`，并显示“旧版本仍可用”或“旧版本也不可用”。“同步前端版本”改为共享恢复协调器的 local-only 模式，不直接调用旧 `refreshAi()` 空路径。

- [ ] **Step 7: 运行 Web 定向测试与类型检查**

Run: `node node_modules/vitest/vitest.mjs run apps/web/src/state/runtime-recovery-coordinator.test.ts apps/web/src/features/runtime/runtime-center.test.tsx apps/web/src/app.test.tsx --maxWorkers=1`

Expected: PASS。

Run: `corepack pnpm --filter @learning-more/web typecheck`

Expected: 退出码 0。

- [ ] **Step 8: 提交 Web 真验证**

```powershell
git add apps/web/src/client/runtime-client.ts apps/web/src/state/runtime-recovery-coordinator.ts apps/web/src/state/runtime-recovery-coordinator.test.ts apps/web/src/layouts/app-shell.tsx apps/web/src/features/runtime/runtime-center.tsx apps/web/src/features/runtime/runtime-center.test.tsx
git commit -m "feat(web): verify runtime activation end to end"
```

### Task 6: 跨层故障矩阵与真实版本切换

**Files:**
- Modify: `tests/e2e/runtime-version-sync.spec.ts`
- Modify: `tests/recovery/full-fault-matrix.test.ts`
- Modify: `playwright.runtime.config.ts`（仅当现有 fixture 无法注入两个 build；否则不改）

**Interfaces:**
- Produces: 可复现的失败激活 → 自动重试 → 新页面，以及双失败 → 旧页面保留验收。
- Consumes: Tasks 2-5 的真实 Host、Launcher、Server 和 Web 入口。

- [ ] **Step 1: 增加首次失败、第二次成功的 runtime 测试**

场景断言：

```ts
await runtime.failNextCandidateBuild();
await page.getByRole('button', { name: '一键重连' }).click();
await expect(page.getByText('恢复完成')).toBeVisible();
expect(await runtime.hostActivation()).toMatchObject({ phase: 'activated', attempt: 2 });
expect((await runtime.ready()).buildId).toBe(targetBuildId);
expect((await runtime.webBuild()).buildId).toBe(targetBuildId);
```

- [ ] **Step 2: 增加连续失败与安全边界测试**

分别断言：两次构建失败时 active build 不变；外部端口 owner 不被终止；Host task identity 被篡改时返回 `host_identity_mismatch`；失败响应不含 dataRoot、secret、绝对路径和 stack。

- [ ] **Step 3: 运行定向 runtime/fault tests**

Run: `node node_modules/vitest/vitest.mjs run tests/recovery/full-fault-matrix.test.ts --maxWorkers=1`

Expected: PASS。

Run: `corepack pnpm playwright:test -- tests/e2e/runtime-version-sync.spec.ts`

Expected: PASS；目标页面无需用户手动强制刷新即可显示新 build。

- [ ] **Step 4: 提交跨层验收**

```powershell
git add tests/e2e/runtime-version-sync.spec.ts tests/recovery/full-fault-matrix.test.ts playwright.runtime.config.ts
git commit -m "test(runtime): cover activation recovery fault matrix"
```

### Task 7: 回归验证、文档收口与运行态验收

**Files:**
- Modify: `docs/superpowers/specs/2026-07-16-safe-runtime-activation-recovery-design.md`
- Modify: `docs/superpowers/plans/2026-07-16-safe-runtime-activation-recovery.md`
- Modify: `docs/项目2.0现状/03-后端架构层.md`（仅记录已实现的 Host/Launcher/Web 口径，不改历史）

**Interfaces:**
- Produces: 与实际代码和运行态一致的完成记录。
- Consumes: 前六个 Task 的提交和测试证据。

- [ ] **Step 1: 运行服务端 seam 非回归测试**

Run: `node node_modules/vitest/vitest.mjs run apps/server/src/bootstrap/local-application-contract.test.ts apps/server/src/http/routes/health.test.ts apps/server/src/bootstrap/app.test.ts --maxWorkers=1`

Expected: 3 个文件、4 项测试全部 PASS；`git diff -- apps/server/src/bootstrap` 为空。

- [ ] **Step 2: 运行 Host、Launcher、Web 和 release 定向套件**

```powershell
node node_modules/vitest/vitest.mjs run packages/contracts/src/runtime.test.ts tools/release/src/build-portable.test.ts apps/host/src/workspace-activation.test.ts apps/host/src/supervisor.test.ts apps/launcher/src/workspace-activation.test.ts apps/launcher/src/local-runtime.test.ts apps/launcher/src/main.test.ts apps/launcher/src/control-server.test.ts apps/web/src/state/runtime-recovery-coordinator.test.ts apps/web/src/features/runtime/runtime-center.test.tsx --maxWorkers=1
```

Expected: 全部 PASS。

- [ ] **Step 3: 运行仓库门禁**

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm schema:check
corepack pnpm architecture:check
corepack pnpm equivalence:check
corepack pnpm build
```

Expected: 全部退出 0；不得通过跳过测试、放宽 schema 或更新无关快照消除失败。

- [ ] **Step 4: 运行完整 runtime 验收**

Run: `corepack pnpm playwright:runtime`

Expected: 现有 Provider/DPAPI、外部端口、身份篡改、版本同步和新激活自愈场景全部 PASS。

- [ ] **Step 5: 核验真实运行态**

记录并比对：Host activation `activeBuildId`、`/api/v1/runtime/ready` 的 `buildId`、`/build-meta.json` 的 `buildId`。三者必须相同，Provider 独立显示真实健康状态；失败演练后旧 release 和用户数据仍存在。

- [ ] **Step 6: 更新当前架构文档和计划执行记录**

只写已经通过测试和真实运行态验证的事实。计划末尾追加实际测试数量、三方 build ID、失败演练结果和最终提交 ID；未完成项目保持未勾选。

- [ ] **Step 7: 提交文档收口**

```powershell
git add docs/superpowers/specs/2026-07-16-safe-runtime-activation-recovery-design.md docs/superpowers/plans/2026-07-16-safe-runtime-activation-recovery.md docs/项目2.0现状/03-后端架构层.md
git commit -m "docs: record runtime activation recovery"
```

## Execution Record (2026-07-16)

- Tasks 1-6 and Task 7's static/documentation gates are implemented. The step checkboxes above preserve the original execution recipe; this record is the authoritative completion status.
- Implementation commits: `319b61f`, `377339d`, `c32beea`, `bea78b6`, `8fc4d86`, `f88c66c`, `24a4088`.
- Server composition boundary remained unchanged: `git diff -- apps/server/src/bootstrap` was empty, and the 3 seam files/4 tests passed.
- Core activation suite: 10 files/53 tests passed. Recovery matrix: 4 files/26 tests passed. Full repository: 221 files/860 tests passed.
- Format, ESLint, typecheck, schema, architecture, equivalence, and full workspace build all passed. Architecture result: 273 data keys, 0 forbidden imports, 0 forbidden AI/UI profile mutations; equivalence result: 77/77.
- The Web production build emits `build-meta.json`. Host/Launcher integration verifies retry-once, durable terminal recovery, old release/data preservation, and public-status redaction.
- A new full Playwright runtime run was not claimed: ports `43119/43120` were occupied by an existing old Learning MORE instance, and the implementation did not terminate or take over it. The test is discoverable with `--list`; current read-only probe found Runtime build `d2b9bf0ab403-w6d008f9ebe05` and no served `build-meta.json`, so that old instance does not satisfy the new three-way acceptance rule.

## Self-Review Record

- Spec coverage: Tasks 1-7 覆盖 schema v2、一次自动重试、request-scoped 清理、旧 release 回滚、Launcher 请求接受与跨重启终态恢复、一次受限 Host repair、真实 sync-frontend、三方 build 验证、Provider 独立失败、运行中心呈现和完整故障矩阵。
- Current architecture: 计划只读取 `RuntimeReady`；没有修改拆分后的 `local-application` 门面、内部 runtime Module 或 Server bootstrap。
- Placeholder scan: 未包含 TBD、TODO、模糊的“增加错误处理”或未定义接口；每个行为都给出稳定类型、错误码、命令与预期结果。
- Type consistency: `WorkspaceActivationProgress` 从 Host 状态文件投影到 Launcher 控制合同，再由 Web coordinator/UI 消费；`targetBuildId`、`activeBuildId`、`attempt` 和 `errorCode` 名称全程一致。
- Safety: 候选目录按 request/attempt 隔离，manifest 延迟提交，外部进程不终止，用户数据目录完全不在清理函数参数范围内。
