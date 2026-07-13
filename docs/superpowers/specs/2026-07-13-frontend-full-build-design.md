# Learning MORE 正式前端完整版设计规格

> 日期：2026-07-13
> 状态：以当前工程与 29 个现行 HTML 样稿为施工基准
> 适用范围：`apps/web`、`packages/ui`、前端共享合同、前端所需 HTTP 接口、视觉与端到端测试

## 1. 设计目标

在现有 React 工程中交付 Learning MORE 的正式产品界面，并完整复用已经通过测试的业务交互程序。完成后：

- `apps/web` 是唯一正式产品 UI；
- `packages/ui` 是唯一视觉 token、布局原语、通用组件和 AI 内容排版来源；
- 当前 29 个 HTML 样稿是冻结的视觉与交互参照，不承担生产业务；
- React 页面使用真实 API、SSE、服务端权威状态、幂等键和版本保护；
- 29 个样稿在桌面、平板、移动端形成 87 张权威迁移基线；
- React 全页视觉差异不超过 0.3%，关键组件差异不超过 0.1%；
- 视觉风格、界面版式、字体、间距、九模式身份和响应式与现行样稿保持一致；
- 全部 AI 生成内容统一为“标题黑体、中文正文宋体、英文正文 Times New Roman、代码等宽”。

## 2. 设计原则

1. **存量逻辑优先复用**：已有 reducer、客户端、SSE、路由、命令和恢复程序保持业务语义不变；
2. **服务端是权威状态**：前端不复制领域状态机，不使用样稿 JavaScript 充当 Repository；
3. **共享基础 + 纵向切片**：共享视觉基础先稳定，每个业务切片随后交付可运行闭环；
4. **视觉单源**：样稿 token 迁入 `packages/ui` 后，Feature 不再维护独立颜色、字体、间距或弹窗样式；
5. **状态显式**：loading、empty、error、degraded、rebuilding、conflict、readonly 和完成态都必须有确定 UI；
6. **测试先保护存量**：视觉改造不能降低现有 461 个测试、9 条浏览器闭环和 75 条等价断言；
7. **跨层缺口真实补齐**：需要新接口的操作在合同和服务端实现后再接前端，不用本地假状态绕过。

## 3. 权威输入

优先级从高到低：

1. `CONTEXT.md`、`PROJECT_CONTEXT.md` 和 `docs/` 中当前业务规则；
2. `packages/contracts` Schema、OpenAPI 和服务端公开 HTTP 行为；
3. 当前 React 中已通过测试的业务状态与用户可观察结果；
4. `docs/UI视觉预览` 中 29 个现行 HTML 的布局、视觉、交互表现与响应式；
5. 本规格定义的共享组件、排版和验收门禁。

业务语义与样稿模拟行为冲突时，使用真实业务语义，但保持同一用户可见结构和视觉状态。不得把 HTML 以 iframe、`dangerouslySetInnerHTML` 或静态路由嵌入产品。

## 4. 总体前端架构

### 4.1 模块边界

```text
apps/web/src/routes
  解析 URL、页面参数、查询参数、数据加载和导航
        ↓
apps/web/src/features
  业务 ViewModel、局部交互状态、命令编排和业务组件
        ↓
apps/web/src/client + state
  合同校验、API/SSE、幂等、版本、页面实例和恢复
        ↓
packages/ui
  无业务知识的 token、布局、通用组件和 AI 内容排版
        ↓
apps/server HTTP/SSE
  权威领域状态、写入、持久化、投影与恢复
```

`packages/ui` 不读取路由、不调用 API、不引用 Course、Lesson、Review、PlanFlow 等领域概念。Feature 可以组合共享 UI，但不得复制共享 token 或重新实现通用 Dialog/Tabs/Toast。

### 4.2 Route、Feature 与 Client 职责

| 层 | 必须负责 | 不得负责 |
| --- | --- | --- |
| Route | URL 参数、并行读取、页面级 loading/error、导航 | 细粒度业务状态机、视觉 token |
| Feature | ViewModel、用户动作、命令状态、局部恢复 | 绕过 Client 的随意 fetch、复制服务端状态机 |
| Client | Schema、HTTP、SSE、ETag、Problem、稳定命令身份 | 组件状态和 DOM 行为 |
| State | page instance、command attempt、version guard、可恢复跨请求状态 | 大型全局业务 Store |
| UI | 视觉、ARIA、键盘、响应式和内容排版 | 业务 API、路由或领域判断 |

不引入新的全局状态库。可由 URL 或服务端重建的状态不进入全局内存 Store。

## 5. `packages/ui` 正式设计系统

### 5.1 Token

建立以下唯一 token 组：

- `colors.css`：背景、纸面、正文、弱文本、分割线、强调色；
- `semantic-colors.css`：success、warning、danger、readonly、degraded、rebuilding；
- `course-modes.css`：九模式 accent、accent-dark、tint 和 motif；
- `typography.css`：产品无衬线、AI 标题、AI 正文、代码字体、字号和行高；
- `spacing.css`：4/8 基础节奏、页面/卡片/区块间距；
- `shape.css`：圆角、边框、阴影、层级；
- `breakpoints.css`：桌面、平板和移动端断点。

初始视觉值来自当前样稿的 `base.css`、`workspace.css`、`learning.css` 和 `mode-themes.js`。React 当前 `styles.css` 中不一致的颜色和几何不作为设计来源。

### 5.2 布局原语

- `Page`：最大宽度、页面边距和滚动容器；
- `Stack`：纵向节奏；
- `Inline`：同行操作与自动换行；
- `Grid`：响应式列；
- `SidebarLayout`：主内容/侧栏；
- `Panel`、`Card`、`Toolbar`、`SectionHeader`；
- `StickyHeader`、`StickyFooter`：学习会话和固定操作区。

### 5.3 通用组件

- `Button`：primary、secondary、ghost、danger、loading；
- `Badge`/`Pill`：模式身份与语义状态分开；
- `Tabs`：键盘左右键、选中态和面板关联；
- `Dialog`：焦点陷阱、Escape、背景不可交互、关闭后焦点恢复；
- `Toast`：成功、警告、错误，支持 `aria-live`；
- `Field`、`TextInput`、`TextArea`、`Select`、`FileInput`；
- `EmptyState`、`ErrorState`、`LoadingState`、`StatusBanner`；
- `Skeleton`、`Progress`、`DataDefinition`、`ReadonlyNotice`；
- `AiContent`：受净化的 AI Markdown 与唯一排版入口。

### 5.4 九模式视觉身份

九模式继续使用稳定 ID：

`standard`、`brainstorm`、`argument_clash`、`case_study`、`business_insight`、`process_decomposition`、`decision_analysis`、`cross_explore`、`reading_seminar`。

模式 ID 和业务状态沿用当前 React 注册表；label、prompt、颜色、图标和 motif 与样稿 `mode-themes.js` 对齐。模式色只表达课程来源身份，不覆盖成功、警告、错误、已放弃、只读和重建等全局语义状态。

## 6. 字体与 AI 内容排版

### 6.1 字体范围

| 内容类型 | 字体 |
| --- | --- |
| 产品导航、按钮、表单、标签、用户消息、统计数字、系统状态 | `Inter, "PingFang SC", "Microsoft YaHei", sans-serif` |
| AI 标题 `h1`–`h6` | `SimHei, "黑体", "Microsoft YaHei", sans-serif` |
| AI 正文、列表、引用、表格正文 | `"Times New Roman", SimSun, "宋体", serif` |
| Markdown 代码、诊断代码、快捷键 | 项目统一等宽字体 |

正文栈把 Times New Roman 放在最前，使英文、拉丁数字和常用西文标点优先使用 Times New Roman；缺失的中文字符回退到 SimSun/宋体。

### 6.2 唯一实现

```css
:root {
  --lm-font-product: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  --lm-font-ai-heading: SimHei, "黑体", "Microsoft YaHei", sans-serif;
  --lm-font-ai-serif: "Times New Roman", SimSun, "宋体", serif;
  --lm-font-code: "Cascadia Mono", Consolas, monospace;
  --lm-ai-prose-size: 16px;
  --lm-ai-prose-line-height: 1.8;
  --lm-ai-block-gap: 0.75em;
  --lm-ai-section-gap: 1.5em;
}

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
  font-family: var(--lm-font-ai-heading);
}

.lm-ai-content :where(code, pre, kbd, samp) {
  font-family: var(--lm-font-code);
}
```

标题层级固定为 `h1 28px/1.35`、`h2 22px/1.4`、`h3 18px/1.45`；`h4`–`h6` 保持清晰递减。段落、列表、引用、表格和代码块之间使用共享 block gap；标题与上一内容使用 section gap；首尾多余 margin 归零。

### 6.3 必须应用 `AiContent` 的内容

- 起点评估中的 AI 消息；
- 候选大纲、正式大纲正文、修订建议；
- 正式学习和补充学习中的 AI 消息；
- 计划流生成的建议和说明；
- 阶段 Review、最终课时 Review、课程主题总 Review、周报；
- 画像标题、摘要、洞察正文和证据说明；
- 未来新增的所有 AI Markdown、富文本和长篇说明。

用户输入和系统诊断不能因为位于同一页面而继承 AI 字体。Feature 只能用 `AiContent`，不得自行设置 AI 内容字体、字号、行高或块间距。

## 7. 路由和页面设计

### 7.1 正式路由

保留当前路由：

- `/`：主页；
- `/courses/new`：九模式建档和未确认大纲会话；
- `/courses/:courseId`：正式大纲、版本、课程状态和课程 Review；
- `/courses/:courseId/lessons/:lessonId`：未开始、已放弃和正式学习；
- `/courses/:courseId/lessons/:lessonId/record`：课节记录；
- `/planning`：规划和计划流；
- `/history`：历史统计、日历和画像入口；
- `/profile`：当前画像与证据链；
- `/runtime`：运行中心；
- `/lessons/:lessonId`：兼容入口，解析后进入正式课程上下文；
- `*`：404 和返回主页。

样稿中的弹窗、页签、折叠、选择日期、预览和生成状态由同一路由中的真实状态表达，不为每个样稿状态增加产品路由。

### 7.2 29 个样稿状态映射

| # | HTML 样稿 | React 目标 |
| ---: | --- | --- |
| 1 | `00-设计系统/共享组件与状态色.html` | `/__visual/ui-components` Fixture，仅视觉测试访问 |
| 2 | `00-设计系统/九模式视觉身份.html` | `/__visual/course-modes` Fixture，仅视觉测试访问 |
| 3 | `01-主页与全局导航/主页.html` | `/`，已加载课程、草稿、继续学习和周历 |
| 4 | `02-课程创建与大纲/标准模式建档.html` | `/courses/new`，standard |
| 5 | `.../八大玩法建档/头脑风暴.html` | `/courses/new`，brainstorm |
| 6 | `.../八大玩法建档/论证交锋.html` | `/courses/new`，argument_clash |
| 7 | `.../八大玩法建档/案例研习.html` | `/courses/new`，case_study |
| 8 | `.../八大玩法建档/商业洞察.html` | `/courses/new`，business_insight |
| 9 | `.../八大玩法建档/流程拆解.html` | `/courses/new`，process_decomposition |
| 10 | `.../八大玩法建档/决策分析.html` | `/courses/new`，decision_analysis |
| 11 | `.../八大玩法建档/交叉探索.html` | `/courses/new`，cross_explore |
| 12 | `.../八大玩法建档/阅读研讨.html` | `/courses/new`，reading_seminar + material |
| 13 | `02-课程创建与大纲/正式课程大纲.html` | `/courses/:courseId`，active |
| 14 | `02-课程创建与大纲/修改大纲.html` | `/courses/:courseId`，revision workspace |
| 15 | `02-课程创建与大纲/已关闭课程大纲.html` | `/courses/:courseId`，closed/readonly |
| 16 | `02-课程创建与大纲/课程永久删除确认.html` | `/courses/:courseId`，课程生命周期确认 Dialog 打开 |
| 17 | `03-课程规划与排期/课程规划.html` | `/planning`，schedule workspace |
| 18 | `03-课程规划与排期/计划流向导与管理.html` | `/planning`，plan-flow wizard/management |
| 19 | `04-课节学习/未开始课节导航.html` | `/courses/:courseId/lessons/:lessonId`，not_started |
| 20 | `04-课节学习/已放弃课节恢复导航.html` | 同一路由，abandoned |
| 21 | `04-课节学习/正式课程学习会话.html` | 同一路由，active session |
| 22 | `05-Review与学习档案/课时Review弹窗.html` | 学习路由，Review Dialog 打开 |
| 23 | `05-Review与学习档案/课节记录.html` | `/courses/:courseId/lessons/:lessonId/record` |
| 24 | `05-Review与学习档案/上周学习回顾.html` | `/history`，statistics + weekly report expanded |
| 25 | `05-Review与学习档案/课程主题总Review.html` | `/courses/:courseId`，course Review visible |
| 26 | `06-历史统计与学习画像/历史统计.html` | `/history`，statistics |
| 27 | `06-历史统计与学习画像/学习日历.html` | `/history`，calendar |
| 28 | `06-历史统计与学习画像/学习画像.html` | `/profile`，completed portrait |
| 29 | `07-系统运行与自愈/接口状态与本地服务自愈.html` | `/runtime` |

`/__visual/*` 只在视觉 Fixture Harness 中注册，不进入生产导航和产品构建入口。

## 8. 各业务域完整需求

### 8.1 App Shell 与主页

- 统一顶栏、品牌、主导航、当前路由、运行状态和移动端折叠；
- Runtime degraded/rebuilding/version mismatch 必须全局可见；
- 协议不匹配阻断写操作，读取和返回路径仍可用；
- 首页加载未确认大纲、正式课程、活动会话、推荐未开始课节和周计划；
- 继续学习优先活动会话，其次推荐未开始课节，排除已放弃课节；
- 空态只显示真实可执行入口，不制造虚假“继续学习”；
- 草稿与正式课程明确分区，进入原有真实路由。

若现有公开读取接口无法高效提供首页数据，增加 `/api/v1/home` 聚合读模型及共享 Schema；不得在浏览器遍历内部数据文件。

### 8.2 九模式建档与正式大纲

- 九模式同级、默认 standard、切换不创建状态；
- 提交后只创建一次 OutlineSession，重复动作复用命令身份；
- 阅读研讨支持材料选择、上传、摄取状态、失败恢复和来源提示；
- 保留现有起点评估、候选生成、SSE、停止/失败草稿、重生成、冲突和确认状态机；
- 刷新后从 URL 中的 outlineSessionId 恢复服务端状态；
- 确认后进入正式课程，不在前端复制候选为正式数据；
- 正式课程展示权威大纲、版本、课节、进度、课程模式和状态；
- 大纲修订使用 `outline-revisions` 真实命令，版本冲突可重新加载；
- 关闭态只读，仍可查看大纲、课节记录和课程 Review；
- 所有 AI 消息、大纲和修订说明使用 `AiContent`。

### 8.3 规划与计划流

- 七日栏、选择日期和“其他/待规划”筛选互斥；
- 展示计划项、课程/课节、来源、状态、开始/结束时间和冲突；
- 手工排期、改期、调整时长、取消和锁定均为真实服务端命令；
- 已完成和已放弃课节不能被重新排入活动计划；
- 放弃课节自动取消活动排期，恢复后不自动恢复旧排期；
- 计划流四步向导保留约束、预览零写入、确认一次写入；
- 支持暂停、恢复、重排和结束管理；手工锁定项不被重排；
- 版本冲突展示权威新计划，同时保留用户尚未提交的约束；
- AI 计划说明使用 `AiContent`。

跨层接口按现有领域命令增加：

- `PATCH /api/v1/schedule-assignments/:id`：move/resize/lock；
- `DELETE /api/v1/schedule-assignments/:id`：remove；
- `POST /api/v1/plan-flows/:id/actions`：pause/resume/reflow/end；
- 对应 Request/Response Schema、ETag、Problem 和幂等头。

### 8.4 课节入口、正式学习与 Review

- 未开始页先显示确认后的核心知识、目标和预计时间，点击开始才创建 Session；
- 正式会话恢复现有活动状态、写入权、生成任务和已提交消息；
- 对话区展示完整用户/AI 消息序列，不只保留最后一次 assistant accumulator；
- AI 流式 Markdown 增量安全渲染，完成后保持完整内容；
- SSE 断线显示恢复状态，先恢复服务端快照再继续事件；
- 停止生成保留 draft reference 和用户可编辑输入；
- 多窗口只允许一个写入租约，其他窗口只读并明确提供转移；
- 手动暂停、离开、后台、断线和窗口关闭遵守现有生命周期规则；
- 放弃、恢复、结课和补充学习继续使用现有命令；
- 结课所需 message IDs、checksum、source snapshot 和 end intent 必须来自权威会话/服务端准备数据，不在 UI 中使用固定占位值；
- 关闭事务显示 pending/completed/failed，支持读取和真实 retry；
- 阶段 Review 和最终 Review 使用固定头/内容/操作区的 Dialog；
- Review、AI 消息和补充学习 AI 输出均使用 `AiContent`。

### 8.5 课节记录

- 顶部两个同级页签：学习对话、权威 Review；
- 学习对话内切换原始会话和补充会话；
- 历史记录只读，不出现修改原文或伪造补充学习入口；
- 日历和历史深链能打开对应课程、课节和 Review 页签；
- 已放弃课节只显示已学/剩余、只读记录和明确恢复入口；
- 正文长内容、表格和代码在移动端不裁切。

### 8.6 历史统计、日历与周报

- 历史统计、学习日历、学习画像是三个同级入口；
- 历史分页追加而非替换；筛选日期时不残留旧结果；
- 展示 freshness、asOf、样本量、排除项和数据定义；
- 统计面板以稳定 ViewModel 展示时长、完成、互动和趋势，不直接输出原始 JSON；
- 课程摘要使用 `/courses/:courseId/summary`；
- 月历按本地日期聚合，支持月份切换和日期空态；
- 完成条目可以打开课程和权威 Review；
- 周报默认折叠，展开后展示冻结状态、周统计和 AI Markdown；
- 任一读模型 404、503、stale 或 rebuilding 都有独立可理解状态，不能令整个页面永久 loading；
- 周报与 AI 洞察使用 `AiContent`。

### 8.7 学习画像

- 并行加载全局档案、候选证据和当前画像；
- 明确 preparing、generating、failed、completed 和样本不足状态；
- 刷新后轮询指定 versionId 到终态，并在卸载时取消；
- 失败保留上一版画像、解除刷新按钮 busy、展示可重试原因；
- 证据抽屉展示人类可读复合来源、限制性证据和时间，不泄漏内部置信标签；
- 自由洞察不固定类别或卡片数量；
- 标题、摘要、洞察正文和证据说明使用 `AiContent`。

### 8.8 运行中心

- 展示实例、构建、协议、数据根、Provider、模型、健康和最后检查时间；
- Provider 切换使用当前稳定命令身份，验证失败不改变现值；
- 不显示或持久化 API Key 明文；
- 一键重连按 Launcher 控制、ready 等待、AI 刷新和前端同步执行；
- 诊断按钮调用 `/api/v1/runtime/diagnostics`，显示净化后的结果与修复建议；
- 外部端口、错误实例和版本不匹配状态与现有 runtime E2E 保持一致；
- 诊断内容继续使用产品/等宽字体，不使用 AI 正文字体。

## 9. Client 与合同设计

### 9.1 统一 Client

所有 Client 迁移到 `apiRequest`：

- Response 必须由 `packages/contracts` Schema 解析；
- 404/503 使用显式 union，不用 `undefined as T`；
- ETag 统一解析并返回 resourceVersion；
- Problem 统一映射为可恢复/不可恢复错误；
- 每次可重试写操作由 `use-command-attempt` 提供稳定 idempotency key；
- 成功后旋转命令身份，失败重试保持同一身份；
- CSRF、page instance、If-Match 和 correlation header 只由 Client 生成；
- Feature 不直接拼写底层安全头。

### 9.2 SSE

- 使用当前 `sse-client.ts` 的 `Last-Event-ID`、reset snapshot 和终态支持；
- 页面卸载和切换任务时取消旧连接；
- transient failure 自动恢复，terminal failure 转为用户可见状态；
- 服务端快照覆盖本地推测状态；
- Fixture 使用同一事件结构，不添加生产 `demoMode`。

## 10. 页面状态与错误恢复

每个 Route 至少定义：

- `loading`：首次读取；
- `empty`：权威数据为空；
- `ready`：可操作；
- `readonly`：关闭、无租约或历史记录；
- `submitting/generating`：写入或 SSE 进行中；
- `conflict`：ETag/版本冲突；
- `error`：读取或命令失败；
- `degraded`：运行能力受限；
- `stale/rebuilding`：读模型非当前；
- `version-mismatch`：全局写入阻断。

规则：

- 请求失败保留未提交输入和用户上下文；
- 写入重试复用命令身份；
- 版本冲突提供重新加载权威状态的明确动作；
- 已成功写入后重新拉取权威数据，不只在本地拼接；
- 页面失败不能吞掉导航和返回入口；
- Promise rejection 必须转为可见状态并解除 busy；
- Toast 只报告瞬时结果，长期错误保留在相关模块内。

## 11. 响应式与可访问性

### 11.1 固定验收视口

- 桌面：`1440×1000`；
- 平板：`1024×768`；
- 移动端：`390×844`。

所有视口必须满足：无横向页面滚动、无模块越界、无文字裁切、触控目标不重叠、固定头尾不遮挡内容。

### 11.2 交互要求

- 所有控件有可访问名称；
- 可见焦点与样稿风格一致，不能用 `outline: none` 消除；
- Tabs、Dialog、Toast、状态横幅符合 ARIA 角色和键盘行为；
- 生成、重建、切换 Provider 和诊断过程使用 `aria-busy`/`aria-live`；
- 颜色不是状态的唯一表达；
- 只读状态在 DOM 语义和视觉上同时明确；
- `prefers-reduced-motion` 关闭非必要动画；
- 正文缩放至 200% 仍能阅读和操作。

## 12. 视觉基线与严格差异门禁

### 12.1 基线集合

29 个 HTML 样稿分别在三个固定视口截图，共 **87 张 HTML 权威迁移基线**。每个状态记录：

- HTML 文件；
- React 路由或 visual Fixture；
- Fixture 名称和稳定数据；
- 状态准备步骤；
- 页面稳定标记；
- 关键组件截图区域。

React 页面通过迁移后，保留对应 React 长期基线。HTML 基线证明迁移忠实度，React 基线保护后续产品回归。

### 12.2 确定性环境

- 使用仓库锁定的 Playwright 与 Chromium/Edge；
- Windows、固定 DPI/缩放、`zh-CN`、Asia/Shanghai、light color scheme；
- 固定 Mock Provider、ID、时间、分页游标、数据和生成事件；
- 等待网络、图片、`document.fonts.ready` 和页面稳定标记；
- 关闭动画、过渡、光标闪烁和非确定轮播；
- 截图前验证 Times New Roman、SimSun 和 SimHei 均可用；
- 不通过隐藏正文、大面积遮罩或替换关键模块规避差异。

### 12.3 阈值

- 全页：`threshold: 0.15`，`maxDiffPixelRatio: 0.003`；
- 关键组件：`maxDiffPixelRatio: 0.001`；
- 横向溢出、裁切、控件遮挡、死按钮、控制台错误、字体回退错误：零容忍；
- 失败保留 expected、actual、diff、差异比例、trace 和状态名。

基线进入 `tests/visual/baselines`；运行产物进入 `artifacts/visual`。禁止无审查批量更新快照；每次更新必须说明原因、受影响状态和三个视口结果。

## 13. 测试体系

| 层级 | 目标 |
| --- | --- |
| `packages/ui` | token 契约、ARIA、键盘、焦点、AI 字体和响应式组件 |
| `apps/web` | ViewModel、reducer、错误恢复、路由、稳定命令身份 |
| 合同 | 前后端 Schema、OpenAPI、ETag 和 Problem union |
| 业务 E2E | 真实 Web/Server、临时数据根、Mock Provider、成功与恢复路径 |
| Runtime E2E | Launcher、Provider、端口、身份、自愈和版本阻断 |
| Visual | 87 张 HTML 对照、React 长期截图、关键组件差异 |
| 静态审计 | 死链接、死按钮、溢出、字体映射、禁止 Feature 覆盖 token |
| 全仓门禁 | format、lint、typecheck、schema、architecture、equivalence、test、build |

AI 排版测试必须覆盖中文、英文、中英混排、Markdown 标题、段落、列表、引用、表格、行内代码和代码块，并读取浏览器计算字体和间距。

## 14. 完成定义

正式前端只有在以下条件全部满足时完成：

- 29 个样稿状态全部映射到 React，并完成三个视口；
- 所有页面通过真实 API/SSE，不使用样稿模拟逻辑；
- 当前可复用业务闭环保持通过；
- 规划等跨层增量完成合同、服务端、Client、Feature 和 E2E；
- 87 张 HTML 迁移基线与全部 React 长期基线通过阈值；
- 全页差异 ≤0.3%，关键组件差异 ≤0.1%；
- 所有 AI 内容通过 `AiContent`，计算字体和垂直节奏符合本规格；
- 三视口无溢出、裁切、遮挡和不可用控件；
- 键盘、焦点、Dialog、动态状态朗读和 200% 缩放通过；
- `corepack pnpm verify`、核心 E2E、Runtime E2E 和 Visual 门禁全部为绿色；
- 规格、状态映射、数据定义和验收记录与代码同步。

## 15. 非目标

- 不建立第二套前端工程；
- 不更改已有领域语义和持久化架构；
- 不把 HTML 样稿作为生产页面；
- 不引入新的 UI 框架或全局状态库；
- 不把所有产品 UI 改成衬线字体；
- 不以跨操作系统像素一致为目标，权威环境固定为 Windows Chromium/Edge；
- 不为通过截图而弱化真实数据、交互、错误和恢复状态。
