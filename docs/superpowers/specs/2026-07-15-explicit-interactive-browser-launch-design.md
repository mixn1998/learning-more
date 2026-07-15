# Learning MORE 显式交互打开主页设计

日期：2026-07-15

状态：已批准（用户选择“方案 B：交互包装器负责打开”）

## 背景与根因

正式 Windows Host 路径会向 Launcher 注入 `LEARNING_MORE_NO_OPEN=1`，但 Host 被外部终止后，工作区曾通过 `node tools/start-learning-more.mjs` 直接启动 Launcher。该直接入口默认允许打开浏览器；Launcher 在启动完成后调用 `rundll32.exe url.dll,FileProtocolHandler http://127.0.0.1:43119`，因此每次此类恢复都会弹出一个新的 Learning MORE 主页。

现场同时确认：

- Windows 任务处于 `Ready`，结果为 `0xC000013A`，并非周期触发。
- 当前服务由孤立的 development Launcher 持有，而非 Host。
- 直接启动根进程创建于 2026-07-15 01:28:32，Server 于 01:28:58 ready。
- 无副作用最小复现表明 `LauncherRuntime.start()` 会调用一次 `openApplication()`。
- `syncFrontend()` 在允许打开浏览器的 Launcher 中也会调用同一 Windows URL handler。

问题本质不是缺少弹页去重，而是浏览器副作用位于长期服务层，任何启动方式或环境变量遗漏都可能重新触发它。

## 目标

浏览器只能由明确的交互入口打开，并且每次显式操作最多打开一次。下列后台路径永久禁止打开浏览器：

- Windows Task Scheduler 启动 Host；
- Host 启动、收养、恢复或替换 Launcher；
- Launcher 启动、复用或恢复 Server；
- Server 崩溃自愈与配置重连；
- 工作区构建激活；
- `syncFrontend`、诊断和 Provider 刷新；
- 普通 `pnpm start` 和其他未携带 `--open` 的脚本调用。

明确允许打开主页的入口只有：

- `pnpm start:open`；
- `node tools/start-learning-more.mjs --open`；
- 可移植发行包中用户双击的交互式 `START.cmd`。

## 方案决策

采用“交互包装器负责打开”。浏览器启动能力从 Launcher 领域边界中删除，不再用否定环境变量控制长期服务的副作用。

未采用方案：

- 正向环境变量：虽然比 `LEARNING_MORE_NO_OPEN` 安全，但仍把浏览器副作用留在 Launcher 内部。
- 弹页锁或去重标记：只能缓解重复，不能阻止新的启动路径隐式打开浏览器。

## 架构与 Interface

### Launcher

从 `LauncherDependencies` 删除：

```ts
openApplication(): Promise<void>;
```

从 `LocalRuntimeOptions` 删除：

```ts
openBrowser: boolean;
```

`LauncherRuntime.start()` 只负责租约、身份观察、Store 恢复、Server 启动和 readiness。无论启动成功、复用现有实例、进入 degraded 或阻断状态，都不产生浏览器副作用。

`LauncherRuntime.syncFrontend()` 继续保留控制面合同，但其实现只执行前端同步所需状态操作；MVP 当前无额外文件同步动作时允许为空操作。它不得打开 URL、刷新用户页面或生成新标签页。

### 工作区交互包装器

`tools/start-learning-more.mjs` 是工作区唯一可选择打开浏览器的入口：

```text
node tools/start-learning-more.mjs          # 启动但不打开主页
node tools/start-learning-more.mjs --open   # ready 后打开一次主页
```

包装器解析固定参数集合，仅接受零参数或单个 `--open`。未知参数以非零状态退出，不启动运行时。

包装器先等待 `runLauncher()` 完成其启动与 readiness，再在 `--open` 存在时调用 Windows URL handler。打开动作只执行一次，不参与 Launcher 的恢复循环。

该包装器是开发期前台入口，不是正式服务恢复入口。正式恢复始终调用 Host `repair`，避免 Codex 或终端成为长期进程所有者。

根 `package.json` 暴露：

```json
{
  "start": "corepack pnpm build && node tools/start-learning-more.mjs",
  "start:open": "corepack pnpm build && node tools/start-learning-more.mjs --open"
}
```

### 可移植发行包

`START.cmd` 是明确的交互入口。它负责调用 Host 安装/修复入口、等待 `http://127.0.0.1:43119/api/v1/runtime/ready` 返回可信 readiness，然后打开一次固定主页。安装、修复、卸载脚本继续完全无界面。

发行包 README 必须区分：

- `START.cmd`：交互启动并打开一次主页；
- `INSTALL-AUTOSTART.cmd` / `REPAIR-AUTOSTART.cmd`：维护后台 Host，不打开主页。

## 运行流程

### 后台流程

```text
Windows Task Scheduler
  -> Host
  -> Launcher
  -> Server ready
  -> 不打开浏览器
```

Host 和 Launcher 的任何自动恢复均重复同一无界面流程。

### 显式交互流程

```text
用户执行 start:open 或双击 START.cmd
  -> 启动/修复运行链
  -> 等待 43119 readiness
  -> 调用一次系统 URL handler
  -> 交互包装器结束或继续等待自身负责的前台进程
```

浏览器动作不重试。URL handler 成功启动后不检查浏览器是否已经存在同一标签页，因为用户已明确请求打开；每次显式命令最多一次。

## 错误处理

- 运行时未 ready：不打开浏览器，并返回启动/超时错误。
- URL handler 启动失败：保留已经健康的服务，向交互调用者输出明确警告，并让该交互入口最终以非零状态结束；不得停止 Host、Launcher 或 Server。
- 未知参数：在启动任何进程前失败。
- Host、Launcher 或 Server 自愈：始终无界面，不因失败或成功打开主页。
- `syncFrontend`：无浏览器副作用；失败只通过现有控制面错误返回。
- 外部端口 owner 或身份不匹配：沿用现有受控阻断，不强杀未知进程。

## 当前孤立进程恢复

部署代码后执行一次受控所有权切换：

1. 核验 43119 owner 的命令行、PID、Server 子进程和 readiness identity。
2. 仅终止已确认的 `tools/start-learning-more.mjs` 孤立进程树。
3. 构建 Host 与 Launcher。
4. 运行 Host `repair`，由 Windows Task Scheduler 启动正式 Host。
5. 验证 Host 父进程属于 `Schedule` 服务，Launcher 父进程属于 Host，Server 父进程属于 Launcher。
6. 验证任务只有一个 `AtLogOn` 触发器，`NextRunTime` 为空，不增加周期触发。
7. 验证 43119/43120 ready、身份一致，并在恢复过程中没有新的浏览器窗口。

课程数据、Provider 配置、密钥、备份和业务领域状态不参与此次切换。

## 测试策略

测试 seam 固定为 Launcher orchestration、交互包装器和可移植发布脚本生成器。

1. `LauncherRuntime.start()` 的新建、复用、degraded 和阻断分支均没有 `openApplication` 依赖或调用。
2. `syncFrontend()` 不调用进程启动器或 URL handler。
3. 工作区包装器无参数启动时打开次数为零。
4. 工作区包装器带 `--open` 且 ready 时打开次数恰好为一。
5. 工作区包装器带未知参数时不启动 Launcher，也不打开浏览器。
6. readiness 失败时打开次数为零。
7. URL handler 失败时服务保持健康，交互命令报告失败。
8. 可移植 `START.cmd` 包含一次显式打开动作；安装、修复和卸载脚本不包含 URL handler。
9. Windows 真实验收监测浏览器窗口集合：Host repair、Launcher 自愈和 `syncFrontend` 后没有新 Learning MORE 页面；显式交互入口后恰好新增一次。

## 验收标准

- 后台链连续运行和自愈期间不会弹出主页。
- `pnpm start` 不打开主页。
- `pnpm start:open` 在 ready 后只打开一次主页。
- “同步前端版本”和“一键重连”不打开新页面。
- Windows 计划任务恢复为 Running，进程父链由 `Schedule` 服务持有。
- 不增加每分钟或其他周期触发。
- 当前孤立 development Launcher 被正式 Host release 替代。
- Launcher、Host、发布构建和相关前端测试全部通过。

## 非目标

- 不实现跨浏览器标签页去重。
- 不关闭用户已经打开的 Learning MORE 页面。
- 不更改固定端口、数据目录、Provider、课程领域逻辑或前端路由。
- 不将 Windows Task Scheduler 改为 Windows Service。
