# Learning MORE UI 参考样例索引

本目录保留 HTML/CSS/JS 视觉样例和审计脚本，用于视觉方向参考与回归辅助，不是当前产品运行代码，也不作为功能是否已交付的判断依据。当前前端事实以 [`../项目2.0现状/02-前端实现层.md`](../项目2.0现状/02-前端实现层.md) 为准。

## 样例分区

| 功能域 | 参考样例 |
|---|---|
| 设计系统 | `00-设计系统/九模式视觉身份.html`、`共享组件与状态色.html` |
| 主页 | `01-主页与全局导航/主页.html` |
| 课程创建与大纲 | `02-课程创建与大纲/*.html`、`八大玩法建档/*.html` |
| 规划排期 | `03-课程规划与排期/*.html` |
| 课节学习 | `04-课节学习/*.html` |
| Review 与档案 | `05-Review与学习档案/*.html` |
| 历史统计与日历 | `06-历史统计与学习画像/*.html` |
| 运行服务 | `07-系统运行与自愈/*.html` |

## 九模式样例

- `standard`：`02-课程创建与大纲/标准模式建档.html`
- `brainstorm`：`02-课程创建与大纲/八大玩法建档/头脑风暴.html`
- `argument_clash`：`02-课程创建与大纲/八大玩法建档/论证交锋.html`
- `case_study`：`02-课程创建与大纲/八大玩法建档/案例研习.html`
- `business_insight`：`02-课程创建与大纲/八大玩法建档/商业洞察.html`
- `process_decomposition`：`02-课程创建与大纲/八大玩法建档/流程拆解.html`
- `decision_analysis`：`02-课程创建与大纲/八大玩法建档/决策分析.html`
- `cross_explore`：`02-课程创建与大纲/八大玩法建档/交叉探索.html`
- `reading_seminar`：`02-课程创建与大纲/八大玩法建档/阅读研讨.html`

## 验证入口

- `corepack pnpm ui-samples:verify`：运行样例加载、接线、几何、排版和交互审计。
- `corepack pnpm visual:test`：运行 HTML 与 React 视觉对照。
- `corepack pnpm visual:react`：只运行 React 页面视觉对照。
- `corepack pnpm visual:modes`：验证九模式主题。
- `corepack pnpm visual:components`：验证设计系统关键组件。

样例是否通过、哪些页面已经迁移，以当前测试输出和测试文件中的显式清单为准，不在本 README 固化历史通过数量。
