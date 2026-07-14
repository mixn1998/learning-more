# 运行中心 Codex CLI 与本地服务恢复设计

日期：2026-07-14  
状态：已批准方案 A，待规格复核

## 1. 背景与问题

运行中心当前存在三项用户可见故障：

1. Codex CLI 模型选项来自静态样稿数据，与本机 Codex CLI 的实际模型目录不一致。
2. Codex CLI 没有被稳定地自动发现和注册，健康状态只验证可执行文件或演示状态，不能代表登录、模型目录和生成命令均可用。
3. Launcher 在读取控制状态时轮换 capability，但控制写操作仍可能校验旧 capability，导致“一键重连”返回 `403 control_capability_invalid`。

本机诊断基线显示，当前 Codex CLI 为 `0.144.0-alpha.4`；`codex debug models` 当前返回 `gpt-5.6-sol`，支持 `low`、`medium`、`high`、`xhigh`、`max`、`ultra` 六档推理强度，默认 `low`。这些值只作为诊断证据，不写入产品静态目录。

## 2. 目标与非目标

### 2.1 目标

- 运行中心只显示本机 Codex CLI 实际返回的可用模型和推理强度。
- 启动时自动发现可执行的 Codex CLI；环境变量仍可作为显式覆盖。
- Codex CLI 的“可用”必须同时表示：可执行文件可运行、登录状态有效、模型目录可解析。
- Codex CLI 未登录时，用户可以从运行中心启动登录；CLI 自动打开官方账号验证网页，验证完成后页面自动刷新状态和模型目录。
- 课程生成通过真实 `codex exec` 参数调用，而不是项目自定义的无效 CLI 参数。
- 本地服务“一键重连”可以取得当前有效 capability，并完成受控重启、健康等待和界面刷新。
- 本地服务恢复结果与 AI Provider 恢复结果独立呈现；AI 恢复失败不能抹掉已经成功的本地服务恢复结果。
- Provider 切换失败时保留原 Provider 与原配置，不展示或保存不存在的模型。

### 2.2 非目标

- 本阶段不接入 Codex app-server 常驻协议。
- 不在浏览器中读取 Codex 用户凭据、配置文件或本地绝对路径。
- 不把远端模型目录永久复制为项目常量。
- 不增加新的用户访问地址或公开端口。

## 3. 方案选择

采用方案 A：直接 Codex CLI Adapter。

备选方案 B 是连接 Codex app-server 常驻进程，能提供更丰富的会话能力，但会引入守护进程协议、连接生命周期和版本协商，超出本次故障范围。方案 C 是继续使用手工路径和静态模型白名单，无法满足“与实际后台配置一致”，因此不采用。

## 4. 模块与接口

### 4.1 `CodexCliAdapter` 深模块

在 Server 的 AI Provider 层形成一个集中接口，隐藏可执行文件发现、进程调用、超时、JSON 解析、模型规范化和错误映射：

```ts
interface CodexCliAdapter {
  probe(): Promise<CodexCliProbe>;
  startLogin(): Promise<'started' | 'already_authenticated'>;
  generate(request: CodexGenerationRequest, signal: AbortSignal): AsyncIterable<ProviderDelta>;
}
```

`probe()` 返回公开且可验证的数据：CLI 版本、登录是否有效、模型目录、默认推理强度、支持的推理强度及健康结果。它不返回凭据、用户目录或完整诊断输出。

Adapter 的发现顺序为：

1. `LEARNING_MORE_CODEX_CLI_EXECUTABLE` 显式覆盖；
2. 当前进程 `PATH` 中能够通过 `--version` 的候选；
3. 当前 Windows 用户 `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe` 中能够执行的最新候选。

不扫描或执行其他 Windows 用户目录中的二进制文件。

健康探测顺序为：

1. `codex --version`；
2. `codex login status`；
3. `codex debug models` 并按严格 Schema 解析。

任一步失败均返回不可用状态和稳定错误码。模型目录允许短时内存缓存，但“重新检查”必须绕过缓存重新探测。

`startLogin()` 先检查当前登录状态；已经登录时不重复启动进程，未登录时以 `shell: false` 启动当前用户的 `codex login`。登录进程由 Codex CLI 打开官方验证网页并处理回调，Learning MORE 不解析、不代理、不保存账号凭据或 OAuth 回调。相同登录进程运行期间重复请求必须幂等返回 `started`，不得并发打开多个验证页面。

生成调用使用 `codex exec --ephemeral --skip-git-repo-check --sandbox read-only --model <model> -c model_reasoning_effort=<effort> <prompt>`。参数数组直接传给 `spawn`，保持 `shell: false`；中止信号必须终止子进程。只有标准输出中的最终文本进入生成流，诊断信息不得混入 AI 正文。

### 4.2 Provider 目录接口

Contracts 新增严格 Schema，公开各 Provider 的真实状态：

```ts
type ProviderCatalog = {
  providers: Array<{
    providerId: string;
    capabilities: ProviderCapabilities;
    health: ProviderHealth;
    models: Array<{
      id: string;
      displayName: string;
      defaultReasoningEffort: string;
      supportedReasoningEfforts: string[];
    }>;
  }>;
};
```

Server 提供同源只读接口：

```text
GET /api/v1/ai-runtime/providers
```

并提供同源受 CSRF 保护的登录启动接口：

```text
POST /api/v1/ai-runtime/providers/codex-cli/login
```

响应只包含 `started` 或 `already_authenticated`，不包含验证 URL、账号或令牌。

Generation Runtime 只暴露一个列举 Provider 目录的方法；每个 Provider 自行实现可选的模型列举能力。Mock 和普通 API-compatible Provider 可以返回空模型目录，Codex CLI 返回实时目录。Web 不再维护 Codex 型号常量。

### 4.3 Launcher capability 接口

控制服务器不再持有 capability 的启动快照，而是通过单一 getter 获取当前 capability：

```ts
getCapability(): { value: string; expiresAt: number };
```

`GET /control/v1/status` 返回的 capability 与紧接着的写操作校验使用同一当前状态。临近过期时 getter 原子轮换；前端收到 `403 control_capability_invalid` 时清除会话缓存、重新读取一次状态并仅重试一次。

控制面继续只监听 `127.0.0.1:43119`，继续校验 loopback、精确 Host、精确 Origin 和自定义 capability header。

## 5. 数据流

### 5.1 页面加载与重新检查

1. Web 并行读取当前 Provider 状态、Provider 目录和本地运行时就绪状态。
2. Server 调用 Generation Runtime 列举 Provider。
3. Codex CLI Provider 通过 Adapter 完成真实探测并返回模型目录。
4. Web 用返回目录生成模型和推理强度选择器。
5. CLI 不可用时，卡片显示“不可用”及稳定、无敏感信息的原因；不显示虚构选项。

### 5.2 Provider 切换

1. 用户从真实目录中选择模型和推理强度。
2. Web 提交 Provider、公开配置和 secret handle。
3. Server 重新验证目标模型仍在最新目录中，并检查登录与健康状态。
4. 验证成功后原子切换并持久化公开配置；验证失败则保留原 Provider。
5. Web 重新获取当前状态和目录，以后端结果覆盖本地选择状态。

### 5.3 Codex CLI 登录

1. Provider 目录返回 `codex_cli_not_authenticated`，运行中心显示“登录 Codex”。
2. 用户点击后，Web 调用登录启动接口。
3. Server 通过 Codex CLI Adapter 幂等启动 `codex login`，Codex CLI 自动打开官方验证网页。
4. Web 每两秒重新读取一次 Provider 目录，最长等待两分钟；页面关闭时立即停止轮询。
5. 探测转为健康后，Web 自动停止轮询、刷新模型目录并恢复切换按钮。
6. 登录进程失败或两分钟内未完成时显示可重试提示，Mock 和其他 Provider 继续可用。

### 5.4 本地服务一键重连

1. Web 获取当前 Launcher capability。
2. Launcher 核验当前实例身份并执行受控重启。
3. Web 等待 `/api/v1/runtime/ready` 返回匹配的新实例。
4. 本地服务阶段标记为完成。
5. Web 随后独立重新检查 AI Provider；失败时只标记 AI 检查失败，本地服务仍保持完成。
6. Web 刷新当前页面运行时状态。

## 6. 状态与错误处理

- 未发现 CLI：`codex_cli_not_found`。
- CLI 无法执行：`codex_cli_unexecutable`。
- 未登录：`codex_cli_not_authenticated`。
- 登录进程无法启动：`codex_cli_login_failed`。
- 模型目录不可解析或为空：`codex_cli_catalog_unavailable`。
- 所选模型或推理强度已失效：`codex_cli_model_unavailable`。
- 生成进程异常退出：沿用 `provider_process_failed`，允许在首个 delta 前按现有策略重试。
- capability 失效：前端刷新 capability 后重试一次；再次失败进入“需处理”，不循环重试。
- 端口被非受管进程占用或实例身份不匹配：继续停止自动恢复，不强杀未知进程。

所有错误响应都不得包含 token、凭据、完整用户路径或 Codex 原始配置。

## 7. 运行中心表现

- Provider 卡片的“可用/不可用/当前使用”全部来自 Provider 目录和当前状态。
- Codex CLI 模型选择器只显示返回目录；每个模型旁显示其真实默认推理强度。
- 选择模型后，推理强度选择器只显示该模型支持的值。
- 没有模型时禁用切换操作，并明确显示探测失败原因。
- 未登录时显示“登录 Codex”；启动后显示“等待浏览器验证”，验证成功后自动加载真实模型，不要求手动刷新。
- “启动并检查”强制刷新 Provider 目录；“重新连接”重放已保存配置并重新探测。
- 本地服务四阶段继续保留“核验实例、重连服务、等待健康、刷新 AI”，但最后一阶段的 AI 失败不会回滚前三阶段的成功结果。
- 保持现有视觉规格、字体、行距、组件尺寸和九种玩法配色，不改动页面布局基线。

## 8. 测试与验收

### 8.1 单元与契约测试

- CLI 发现按覆盖、PATH、当前用户安装目录的顺序选择，并跳过不可执行候选。
- `debug models` 的真实形状被严格解析；未知字段可忽略，缺少关键字段必须失败。
- CLI Provider 拒绝目录外模型和不支持的推理强度。
- 未登录时只启动一个 `codex login` 进程；已登录时返回 `already_authenticated`；重复点击不并发打开验证页面。
- 生成命令使用真实 `codex exec` 参数、`shell: false` 和中止信号。
- Provider 目录路由通过 Contracts Schema 校验，不泄露敏感字段。
- capability 轮换后，状态返回值与写操作校验值一致。
- capability 首次 403 时前端刷新并重试一次。
- 本地服务恢复成功而 AI 重连失败时，服务状态仍为完成。

### 8.2 集成与浏览器验收

- 页面中不再出现 `gpt-5.6-luna`、`gpt-5.5-luna` 等未由实际 CLI 返回的型号。
- 当前机器上模型选择器与 `codex debug models` 的可见目录一致。
- Codex CLI 登录有效时显示可用；未登录或可执行文件缺失时显示不可用。
- 在未登录测试 Adapter 下点击“登录 Codex”会启动登录并轮询，模拟验证完成后自动出现动态模型选项。
- 点击“一键重连”不再产生 403，后台实例 PID/instanceId 更新后恢复为健康。
- 重连期间 `http://127.0.0.1:43119/` 始终返回站点页面。
- Provider 切换到 Codex CLI 后执行一次最小真实生成冒烟，确认收到有效文本。
- 现有运行中心视觉、无障碍、全量单元测试和生产构建继续通过。

## 9. 完成定义

以下条件全部满足后完成：

- 运行中心没有静态 Codex 模型白名单。
- 模型目录、连接状态和当前配置均可追溯到同一 Server 运行时结果。
- Codex CLI 能自动发现、健康探测、切换并执行最小真实生成。
- Codex CLI 需要账号验证时可以从运行中心启动登录并自动打开官方验证网页，成功后自动刷新模型目录。
- 本地服务一键重连完成真实受控重启，且 capability 轮换无 403。
- 三项用户报告症状均有红绿回归测试和真实运行验证。
- 相关设计规格、实施计划和最终验收报告同步更新。
