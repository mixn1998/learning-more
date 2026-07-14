# Markdown 大纲真实投影与版本调整设计

## 决策

课程大纲的展示结构只来源于每个版本已经保存的原始 Markdown。系统不额外保存结构化 `modules`，也不按固定课节数猜测模块。候选生成阶段的机器契约只负责验证生成结果，不成为正式课程页面的结构数据源。

## 目标

- 删除“每两节课一组”的实现兜底。
- 正式课程、历史版本和调整候选统一从各自的 `outlineMarkdown` 解析模块标题与课节归属。
- Markdown 无法识别模块时，按课节平铺为“未分组课程”，不制造模块。
- 进入大纲调整页时完整显示当前正式大纲 v1。
- 调整会话继承 v1，而不是重新走空白课程创建与三轮起点评估。
- 用户提出要求后生成候选 v2；发布前 v1 不变。
- v2 同时标记“保持不变、内容调整、新增、删除”；发布后 v1 永久保留为历史版本。

## Markdown 投影

新增纯函数模块 `outline-markdown-projection.ts`，输入原始 Markdown 和可选的正式课节列表，输出页面投影：

```ts
type OutlineMarkdownProjection = Readonly<{
  title?: string;
  modules: readonly Readonly<{
    key: string;
    title: string;
    markdown: string;
    lessons: readonly Readonly<{
      key: string;
      title: string;
      markdown: string;
      lessonId?: string;
    }>[];
  }>[];
  ungroupedLessons: readonly Readonly<{
    key: string;
    title: string;
    lessonId?: string;
  }>[];
}>;
```

解析规则：

1. Markdown 第一个一级标题是课程标题，不作为模块。
2. 其余标题按层级构成树；包含已保存课节标题的标题节点识别为课节。
3. 课节的最近上级标题是模块，模块标题保留 Markdown 原文。
4. 列表项也可与已保存课节标题匹配，归属到最近的标题模块。
5. 未匹配课节进入“未分组课程”；不得按数量重新分组。
6. 没有正式课节列表时，以标题层级解析候选 v2：课程标题的直接子标题为模块，下一层标题或列表项为课节。
7. 非模块正文仍保留在完整 Markdown 展示中，不因导航投影丢失。

## 调整会话

新增 `CreateOutlineAdjustmentSession` 命令和 HTTP 入口。服务端加载：

- 当前课程；
- 当前 `outlineVersion`；
- 该版本的 `sourceCandidateVersionId`；
- 对应候选版本。

调整会话创建后直接处于 `candidate-ready`，并以当前候选为基线。随后用户消息走既有 alignment planner：

- `clarify`：继续对话，不生成新候选；
- `patch`：在当前 v1 Markdown 上局部调整；
- `regenerate`：在继承 v1 和完整用户要求的前提下重生成候选。

候选生成输入必须包含 `currentCandidate.markdown`。调整会话不重新执行起点评估，也不伪造用户消息。

## 轻量大纲可读性提示

初次生成与调整生成共用一段深模块上下文提示：清楚表达模块与课节的归属；每节课优先给出可识别的名称，并在其附近给出简洁摘要与关键词。它只帮助 Markdown 投影器稳定识别内容，不规定模块数、课节数、层级深度、措辞、顺序或固定版式，也不提升为课程内容 Schema。模型仍可根据真实教学目标自由组织完整大纲；投影器只读取模型实际写出的 Markdown，解析失败的课节进入“未分组课程”。

调整回合中的“调整决策”与“用户可见回复”可以并行生成，但两项任务使用独立调度所有者，并由生成运行时原子认领队列任务，避免同一任务被重复执行。这里不增加教学观察调用。

## 版本比较

`outline-markdown-diff.ts` 比较 v1/v2 的 Markdown 投影：

- 先按去编号后的规范化标题匹配模块和课节；
- 标题相同且规范化正文相同：`unchanged`；
- 匹配对象正文或标题发生变化：`modified`；
- 仅存在于 v2：`added`；
- 仅存在于 v1：`removed`。

页面使用中文标签“保持不变、内容调整、新增、删除”。删除项必须保留在比较视图中，但不属于待发布 v2 的内容。

## 页面行为

- 尚未生成 v2：右侧完整渲染当前 v1 Markdown。
- 正在生成：v1 保持可见，并显示候选生成状态。
- v2 完成：保留 v1 基线，同时显示 v2 和差异列表。
- 发布按钮只针对候选 v2；发布前正式课程仍读取 v1。
- 历史版本弹窗继续读取各版本自己的 `outlineMarkdown`。

## 失败处理

- v1 Markdown 无法解析模块：完整 Markdown 仍照常显示，导航按“未分组课程”平铺。
- v2 生成失败：保留 v1、用户对话和错误信息，不产生版本变更。
- 差异无法可靠匹配：以“删除 + 新增”表达，不猜测为内容调整。

## 验证

- 不均匀模块课节数（1、3、2）必须按 Markdown 原样投影。
- 正式课程页面不再出现 `offset += 2` 或 `slice(offset, offset + 2)`。
- 调整页初始状态显示完整 v1。
- 调整候选 prompt 包含 v1 Markdown。
- v1/v2 对比覆盖四种状态。
- 发布 v2 后 v1 仍可通过历史版本接口读取。
