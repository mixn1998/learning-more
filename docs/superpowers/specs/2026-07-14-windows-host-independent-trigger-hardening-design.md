# Windows Host 独立触发加固设计

日期：2026-07-14

状态：已批准（用户明确要求由 Windows 任务调度器独立触发，并明确禁止周期触发）

## 背景

Learning MORE 已使用当前用户的 Windows 登录计划任务启动 Host，Host 监管 Launcher，Launcher 监管 Server。最近一次 Codex 更新终止了由 Codex 执行环境启动的整条进程链；任务结果为 `0xC000013A`，应用日志中没有 Node 崩溃、数据损坏或端口冲突。

现有 `install/repair` 只在任务缺失或定义漂移时调用 `start`。当任务定义完全一致但当前未运行时，它会返回“installed”而不恢复 Host。这使“任务存在但已停止”成为可重复的恢复缺口。

## 决策

1. Windows Task Scheduler 是 Host 生命周期的唯一外层所有者。
2. 任务只保留当前用户 `AtLogOn` 触发器，不增加每分钟或其他周期触发器。
3. 保留失败后 1 分钟重试和最多 999 次重试。该配置只响应异常失败，不是周期启动。
4. `install()` 与 `repair()` 每次完成定义对账后都调用任务调度器的 `start(name)`；`IgnoreNew` 保证任务已运行时不会产生第二个 Host。
5. Codex、终端和开发脚本不直接承担长期 Host 进程的生命周期。
6. `status()` 继续只报告任务定义是否缺失、漂移或一致，不把短暂运行状态混入安装合同。

## Interface 与不变量

沿用现有 `HostManager` 和 `TaskSchedulerPort` Interface，不增加新的公开方法：

```ts
interface HostManager {
  install(): Promise<HostInstallationStatus>;
  status(): Promise<HostInstallationStatus>;
  repair(): Promise<HostInstallationStatus>;
  uninstall(): Promise<void>;
}

interface TaskSchedulerPort {
  read(name: 'Learning MORE'): Promise<HostTaskDefinition | undefined>;
  replace(definition: HostTaskDefinition): Promise<void>;
  remove(name: 'Learning MORE'): Promise<void>;
  start(name: 'Learning MORE'): Promise<void>;
}
```

不变量：

- `install/repair` 在任务缺失或漂移时先原子替换定义，再启动任务。
- `install/repair` 在任务定义一致时不替换定义，但仍启动任务。
- `uninstall` 仍只移除固定任务，不删除课程数据、Provider 配置、密钥或备份。
- 任务合同仍是单一登录触发、`StartWhenAvailable`、`IgnoreNew`、失败重启和无限执行时长。
- 未知端口 owner、错误进程身份或损坏数据仍进入原有受控阻断路径，不强杀进程。

## 错误处理

- 定义替换失败：不调用 `start`，向调用者返回现有 adapter 错误。
- 启动失败：`install/repair` 失败，不错误报告已恢复。
- 任务已经运行：Windows `IgnoreNew` 保持当前实例，`start` 必须安全幂等。
- 人工 `Stop-ScheduledTask`：按用户约束不设置周期触发，因此不会无人值守自动恢复；需重新登录或执行安装/修复入口。

## 测试与验收

测试 seam 固定为 `HostManager` Interface 和 Windows Task Scheduler adapter：

1. 首次安装：替换一次、启动一次。
2. 对一致任务再次安装：不替换，但再次调用启动。
3. 漂移任务修复：替换后启动。
4. Windows adapter 继续生成且只生成登录触发器；不得出现 `-Once`、`RepetitionInterval` 或周期触发。
5. 真实 Windows 验收：运行 `repair` 后任务为 Running，`43119/43120` 可访问，代理与直连运行身份一致。

## 明确非目标

- 不新增周期触发器。
- 不改为 Windows Service。
- 不承诺人工显式停止后的无人值守恢复。
- 不改变 Launcher/Server 自愈、端口、数据目录、Provider 或业务领域逻辑。
