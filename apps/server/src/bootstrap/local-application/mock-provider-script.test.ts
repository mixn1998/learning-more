import { describe, expect, it } from 'vitest';

import { parseTeachingAgentResult } from '../../modules/interactive-teaching/implementation/teaching-control-protocol.js';
import { createLocalMockProvider } from './mock-provider-script.js';

async function generate(prompt: string): Promise<string> {
  const provider = createLocalMockProvider({ mockFailOnce: false });
  let output = '';
  for await (const delta of provider.generate(
    { taskId: 'task_test', prompt },
    new AbortController().signal,
  )) {
    output += delta.text;
  }
  return output;
}

describe('local mock provider script', () => {
  it('returns the hidden teaching directive and visible reply required by interactive teaching', async () => {
    const output = await generate(`【教学目标】
以学习者形成清晰、准确、能够支撑后续理解的知识结构为最高目标。

【当前诉求｜用户原话】
请继续。

【机器控制协议｜不得展示给学习者】
当前机器状态：{"schemaVersion":1,"lessonPhase":"warmup","activeKnowledgePointRef":"knowledge:kp_1","knowledgePoints":[{"ref":"knowledge:kp_1","title":"条件变化","status":"pending","interactionStatus":"pending"}],"comprehensiveCheck":"pending","closureInquiry":"pending","summaryStatus":"pending"}`);

    expect(parseTeachingAgentResult(output, true)).toMatchObject({
      markdown: expect.stringContaining('我们从你刚才的问题继续'),
      directive: {
        schemaVersion: 3,
        lessonPhase: 'knowledge_point',
        turnHandoff: 'invite_response',
        knowledgePoints: [{ ref: 'knowledge:kp_1', status: 'learning' }],
      },
    });
  });

  it('keeps frozen teaching protocol text from shadowing a lesson Review request', async () => {
    const output = await generate(`根据完整、冻结且可追溯的教学证据生成学习者可见 Review。

接口输出协议：只返回一个 JSON 对象，不要使用代码围栏或附加说明。
固定识别字段：{"schemaVersion":1,"kind":"lesson-final"}。

冻结证据中曾出现：
【机器控制协议｜不得展示给学习者】
当前机器状态：{"schemaVersion":1,"lessonPhase":"ready_to_close"}`);

    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: 1,
      kind: 'lesson-final',
      title: '本课学习回看',
    });
  });

  it('returns structured observations for the current incremental observation prompt', async () => {
    const output =
      await generate(`每轮只读取上次观察锚点与本轮新增消息，并结合 previousState 生成本轮教学观察增量。

{"knowledgePointRefs":["knowledge:kp_1"],"messages":[{"messageId":"message_ai_1","role":"assistant"}]}`);

    expect(JSON.parse(output)).toMatchObject({
      scope: { alignment: 'direct', relationRefs: ['knowledge:kp_1'] },
      entries: [
        {
          entryId: 'entry_delivery_message_ai_1',
          kind: 'teaching_delivery',
          sourceRefs: ['message:message_ai_1'],
        },
      ],
    });
  });

  it('does not invent portrait claims when no stable learning mode is available', async () => {
    const output = await generate(`【分析边界】
只解释已校验的稳定学习模式。

【已校验稳定学习模式】
当前没有可投影的稳定学习模式。

【可用学习证据】
### 学习证据 1
证据编号：evidence_1
观察主题：条件核验

### 学习证据 2
证据编号：evidence_2
观察主题：条件核验`);

    expect(JSON.parse(output)).toMatchObject({
      title: '学习记录还不够',
      claims: [],
    });
  });

  it('returns a bounded report for the current completed-lessons prompt', async () => {
    const output = await generate(`【周报范围】
2026-07-20 至 2026-07-27（结束日期不计入），按 Asia/Shanghai 统计。

【已完成课节】
- 概率空间（数学）：理解样本空间。
来源标记：fact:fact_1`);

    expect(output).toContain('# 上周学习成果概括');
    expect(output).toContain('<!-- sources:fact:fact_1 -->');
    expect(output).not.toContain('learning-more-outline');
  });
});
