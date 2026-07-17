import { describe, expect, it } from 'vitest';

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
    const output = await generate(`依据提供的真实上下文继续当前互动式教学。

【当前诉求｜用户原话】
请继续。

当前机器状态：{"schemaVersion":1,"lessonPhase":"warmup","activeKnowledgePointRef":"knowledge:kp_1","knowledgePoints":[{"ref":"knowledge:kp_1","title":"条件变化","status":"pending","interactionStatus":"pending"}],"comprehensiveCheck":"pending","closureInquiry":"pending","summaryStatus":"pending"}`);

    expect(output).toContain('<learning-more-control>');
    expect(output).toContain('"lessonPhase":"knowledge_point"');
    expect(output).toContain('"status":"learning"');
    expect(output).toContain('<learning-more-reply>');
  });
});
