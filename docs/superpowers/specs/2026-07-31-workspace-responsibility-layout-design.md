# Learning MORE 工作区职责分区设计

## 目标

将仓库整理为可快速辨认职责的工作区：产品代码、共享产品能力、运行维护、工程支持、有效文档和本地状态彼此分离。根目录只保留仓库入口与工具约定文件，不借本次整理改写产品内部业务架构。

## 设计原则

1. 目录按职责而不是文件类型分组。
2. 可运行产品与工程维护工具使用独立 workspace。
3. 用户数据、缓存、日志和生成物不与源码混放。
4. 仍被程序读取的 Markdown、YAML 等文件属于工程契约，应靠近使用它们的模块。
5. 过期规格、计划、报告、视觉样稿和失效索引直接删除，不建立历史文档坟场；Git 历史承担追溯职责。
6. 只保留工具默认发现或仓库入口所必需的根级配置。

## 目标结构

```text
Learning MORE/
├─ apps/                  # 可运行产品：web、server、launcher、host
├─ packages/              # 产品共享包：contracts、ui
├─ operations/            # 启动、维护、迁移、投影、发布
├─ engineering/           # 架构校验、测试工具、跨应用测试、基准
├─ docs/                  # 少量当前有效的人类文档
├─ .local/                # 被 Git 忽略的缓存、日志、运行态和生成物
├─ README.md
├─ CHANGELOG.md
├─ package.json
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
└─ 工具约定配置
```

## 职责迁移

### operations

- 将根级 `tools/` 中的启动、自愈、数据回填、知识链重投影和 Review 重投影脚本迁入 `operations/` 下相应 workspace。
- 将根级 `release/` 中仍有效的发布说明和清单归入 `operations/release/`；生成的发布包进入 `.local/generated/release/`。
- 将根级 `scripts/verify-workspace.mjs` 并入维护工具，不保留只有一个文件的 `scripts/`。

### engineering

- 将根级 `tests/` 归入 `engineering/tests/`，按 e2e、visual、recovery、performance、support 分类。
- 将变更感知校验、产品 UI 静态校验及其测试迁入 `engineering/verification/`。
- 将仍参与架构检查的等价矩阵和基线移到 `engineering/architecture/fixtures/`，同步修改读取路径。
- 保留 Vitest、ESLint、TypeScript 等工具约定配置；仅在命令可明确指定且能减少根目录噪音时移动专项配置。

### docs

保留：

- 项目入口说明；
- 当前仍适用的安全、隐私和维护说明；
- 必须由开发者阅读、但不被程序当作测试夹具读取的当前架构说明。

删除：

- `docs/superpowers/` 中既有计划、规格和报告；
- `docs/UI视觉预览/` 及其审计脚本；
- 旧版项目现状、教学范例、历史设计过程和失效截图；
- `PROJECT_CONTEXT.md`、`SANITIZATION_REPORT.md` 等已失效或重复入口；
- 已删除功能的画像说明与截图。

本设计文件仅服务本次迁移；完成并验证后随过程文档一并删除，Git 历史保留决策记录。

### 本地状态

- 将 `.corepack`、`.npm-cache`、`.pnpm-home`、`.pnpm-store`、`.playwright-browsers`、`.release-cache`、临时日志、测试结果、构建与发布产物统一收纳至 `.local/`。
- 用户使用数据保留独立生命周期，不纳入源码清理，也不随缓存清理删除。
- 现有运行服务若引用旧路径，迁移前先修改路径解析和恢复逻辑，再移动状态；不得造成已安装实例读取失败。

## 删除 UI 样稿测试环节

`docs/UI视觉预览` 不再作为验收或回归基线：

- 删除 `ui-samples:verify`；
- 删除视觉样稿服务及审计脚本；
- 删除只针对静态样稿的 Playwright 配置与测试；
- 从组合验收命令中移除该环节；
- 保留针对真实 React 页面、核心业务流程和可访问性的必要测试。

## 迁移安全

1. 先建立目标目录并更新引用，再删除旧入口。
2. 所有移动使用 Git 可识别的重命名，保留历史。
3. 不修改 `.learning-more-data` 中的用户内容。
4. 清理前核对每个待删文件的代码、脚本和 README 引用。
5. 不保留兼容软链接或重复目录；调用方一次性切换到新路径。

## 验证

- 根目录不再存在 `tools/`、`scripts/`、`tests/`、`artifacts/` 和发布产物目录。
- `pnpm` workspace 只覆盖职责明确的目录。
- 所有 `package.json` 命令引用新路径。
- 搜索确认不存在旧目录引用和已删除文档引用。
- 运行格式、类型、核心单元测试、架构检查、构建和真实页面关键流程测试。
- 启动本地服务，验证课节加载、课程生成和返回导航。
- 检查用户数据目录和已安装实例未被删除或重置。
