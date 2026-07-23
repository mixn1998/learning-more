import { describe, expect, it } from 'vitest';

import { parseCandidateMarkdown } from './candidate-markdown.js';

describe('candidate Markdown adapter', () => {
  it('uses the shared restricted metadata contract to build the visual outline', () => {
    const result = parseCandidateMarkdown(`\`\`\`learning-more-outline
{"protocol":"learning-more.candidate","schemaVersion":1,"outline":{"courseGoals":["理解概率建模"],"disciplineTag":"数学","topicTags":["概率"],"modules":[{"id":"module_foundation","title":"基础模型","lessonIds":["space"]}],"lessons":[{"id":"space","title":"概率空间","objective":"理解样本空间","coreKnowledgePoints":["样本空间"],"prerequisiteLessonIds":[],"estimatedMinutes":30,"sourceRefs":["source_topic"]}]}}
\`\`\`
# 概率论候选课程`);

    expect(result).toMatchObject({
      title: '概率论候选课程',
      summary: '理解概率建模',
      discipline: '数学',
      tags: ['概率'],
      modules: [
        {
          title: '基础模型',
          lessons: [{ title: '理解样本空间', points: ['样本空间'] }],
        },
      ],
    });
  });

  it('keeps a partial plain Markdown stream visible before structured metadata is complete', () => {
    const result = parseCandidateMarkdown('## 候选 A\n- 第一课');

    expect(result?.title).toBe('候选 A');
    expect(result?.modules[0]?.lessons[0]?.title).toBe('第一课');
    expect(result?.bodyMarkdown).toBe('## 候选 A\n- 第一课');
  });

  it('preserves AI-defined heading depth and non-module sections in the body projection', () => {
    const markdown = `# 课程地图\n\n## 案例工作坊\n\n### 关键决策\n- 识别约束\n\n## 延伸阅读\n> 一条支线`;
    const result = parseCandidateMarkdown(markdown);

    expect(result?.bodyMarkdown).toBe(markdown);
  });
});
