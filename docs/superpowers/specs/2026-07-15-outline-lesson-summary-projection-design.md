# 课程目录课节摘要真实投影设计

## 目标

正式课程目录中，每节课标题下方显示该课节在当前原始 Markdown 大纲中的一句话摘要，例如：

> 理解 token、模型服务、算力商品、预付额度与货币之间的区别，并拆解模型费用如何进入企业账单。

目录摘要不再由 `coreKnowledgePoints` 机械拼接。知识点继续用于课内知识导航、教学上下文和学习证据，不承担目录文案职责。

## 边界

- 不增加 AI 调用。
- 不新增后端字段，不修改课程存储或共享契约。
- 不改变 Markdown 对模块标题和课节归属的真实投影规则。
- 不按字符数机械压缩知识点，也不从关键词数组合成摘要。
- 当前正式大纲版本是摘要的唯一内容来源；历史版本仍使用各自保存的 Markdown。

## 投影接口

扩展前端纯函数 `projectOutlineMarkdown(markdown, lessons?)` 的课节结果：

```ts
type OutlineProjectionLesson = Readonly<{
  key: string;
  title: string;
  markdown: string;
  summary?: string;
  lessonId?: string;
}>;
```

`summary` 只是从该课节 Markdown 片段派生的展示投影，不持久化，也不覆盖正式课节的 `objective` 或 `coreKnowledgePoints`。

## 摘要解析规则

解析范围严格限定为已匹配课节自己的 Markdown 片段，不能越过下一同级或更高层级标题。

按以下优先级提取：

1. 明确标注的 `摘要`、`一句话摘要`、`本节摘要`、`课节摘要` 字段，其冒号后的正文为候选摘要。
2. 若没有明确字段，选择课节标题后的第一句有效叙述正文。
3. 候选正文包含多句时，仅取第一句完整表达；没有句末标点时保留整段。
4. 清理 Markdown 行内标记并合并多余空白，但保留原句语义和中英文内容。

以下内容不得作为摘要：

- `关键词`、`核心知识点`、`知识节点`、`前置知识`等元数据行；
- 列表项、表格、代码块、引用块；
- 下级标题和模块标题；
- 只有标签而没有正文的空行。

若无法提取有效摘要，回退显示正式课节的 `objective`。任何情况下都不回退到 `coreKnowledgePoints` 拼接结果。

## 页面数据流

1. `OutlineView` 用当前 `course.outlineMarkdown` 和正式课节标题建立 Markdown 投影。
2. 投影器返回真实模块、课节归属、课节 Markdown 片段和可选摘要。
3. 页面用 `lessonId` 建立投影索引。
4. 每张课节卡片显示 `projection.summary ?? lesson.objective`。
5. 移除课程目录的 `toLessonKnowledgeSummary(coreKnowledgePoints)` 路径。

现有 `lessonDescriptions` 展示覆盖仅用于视觉夹具，不应继续成为正式目录的文案入口；本次将从 `OutlineView` / `FormalCourseView` 接口中删除，避免目录摘要再次被非大纲内容替换。

## 异常与兼容

- 课节标题未与 Markdown 匹配：进入现有“未分组课程”，摘要回退 `objective`。
- Markdown 只有标题和关键词：回退 `objective`。
- 摘要位于列表、表格或代码块：忽略并回退或继续寻找有效正文。
- 旧课程大纲没有摘要格式：读取第一句叙述正文；仍无正文则回退 `objective`。
- 新生成大纲继续使用现有轻量提示，鼓励每节课自然给出名称、摘要和关键词，不增加固定模板。

## 验证

- 明确摘要字段可以提取完整一句话。
- 无标签时可以提取第一句有效正文。
- 关键词、知识点列表、表格、引用和代码不会成为摘要。
- 多句正文只显示第一句。
- 无可用正文时显示 `objective`。
- 课程目录不再渲染 `coreKnowledgePoints` 的拼接结果。
- 模块数量、课节数量及归属仍严格来自原始 Markdown，不受摘要解析影响。

