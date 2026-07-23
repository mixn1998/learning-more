import { describe, expect, it, vi } from 'vitest';

import {
  createCodexAppServerGenerationRunner,
  runCodexAppServerGeneration,
  type CodexAppServerConnection,
} from './codex-app-server-generation.js';

function connection(messages: readonly unknown[]) {
  const sent: Readonly<Record<string, unknown>>[] = [];
  const close = vi.fn(async () => undefined);
  const value: CodexAppServerConnection = {
    send(message) {
      sent.push(message);
    },
    async *messages() {
      for (const message of messages) yield message;
    },
    close,
  };
  return { value, sent, close };
}

describe('Codex app-server generation', () => {
  it('isolates concurrent turns in separate warm workers', async () => {
    let workerSequence = 0;
    const connectionFactory = vi.fn(() => {
      workerSequence += 1;
      const workerId = workerSequence;
      return connection([
        { id: 1, result: {} },
        { id: 2, result: { thread: { id: `thread_${workerId}` } } },
        { id: 3, result: { turn: { id: `turn_${workerId}` } } },
        {
          method: 'item/agentMessage/delta',
          params: {
            threadId: `thread_${workerId}`,
            turnId: `turn_${workerId}`,
            itemId: `item_${workerId}`,
            delta: `reply_${workerId}`,
          },
        },
        {
          method: 'turn/completed',
          params: {
            threadId: `thread_${workerId}`,
            turn: { id: `turn_${workerId}`, status: 'completed' },
          },
        },
      ]).value;
    });
    const runner = createCodexAppServerGenerationRunner({ poolSize: 2, connectionFactory });
    const consume = async (prompt: string) => {
      const output: string[] = [];
      for await (const delta of runner(
        'codex.exe',
        { prompt, model: 'model', reasoningEffort: 'medium' },
        new AbortController().signal,
      )) {
        output.push(delta.text);
      }
      return output.join('');
    };

    await expect(Promise.all([consume('one'), consume('two')])).resolves.toEqual([
      'reply_1',
      'reply_2',
    ]);
    expect(connectionFactory).toHaveBeenCalledTimes(2);
  });

  it('interrupts and discards a warm worker when its task is cancelled', async () => {
    const sent: Readonly<Record<string, unknown>>[] = [];
    const close = vi.fn(async () => undefined);
    const connectionFactory = vi.fn((): CodexAppServerConnection => ({
      send(message) {
        sent.push(message);
      },
      async *messages() {
        yield { id: 1, result: {} };
        yield { id: 2, result: { thread: { id: 'thread_cancel' } } };
        yield { id: 3, result: { turn: { id: 'turn_cancel' } } };
        await new Promise(() => undefined);
      },
      close,
    }));
    const runner = createCodexAppServerGenerationRunner({ poolSize: 1, connectionFactory });
    const controller = new AbortController();
    const consume = async () => {
      for await (const _delta of runner(
        'codex.exe',
        { prompt: 'cancel me', model: 'model', reasoningEffort: 'medium' },
        controller.signal,
      )) {
        void _delta;
      }
    };
    const completion = consume();
    for (let index = 0; index < 20; index += 1) {
      if (sent.some((message) => message.method === 'turn/start')) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    controller.abort();
    await expect(completion).resolves.toBeUndefined();
    expect(sent).toContainEqual({
      id: 4,
      method: 'turn/interrupt',
      params: { threadId: 'thread_cancel', turnId: 'turn_cancel' },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('reuses one initialized worker across independent ephemeral turns', async () => {
    const fake = connection([
      { id: 1, result: {} },
      { id: 2, result: { thread: { id: 'thread_1' } } },
      { id: 3, result: { turn: { id: 'turn_1' } } },
      {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'item_1',
          delta: 'reply_1',
        },
      },
      {
        method: 'turn/completed',
        params: {
          threadId: 'thread_1',
          turn: { id: 'turn_1', status: 'completed' },
        },
      },
      { id: 4, result: { thread: { id: 'thread_2' } } },
      { id: 5, result: { turn: { id: 'turn_2' } } },
      {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'thread_2',
          turnId: 'turn_2',
          itemId: 'item_2',
          delta: 'reply_2',
        },
      },
      {
        method: 'turn/completed',
        params: {
          threadId: 'thread_2',
          turn: { id: 'turn_2', status: 'completed' },
        },
      },
    ]);
    const connectionFactory = vi.fn(() => fake.value);
    const runner = createCodexAppServerGenerationRunner({
      poolSize: 1,
      connectionFactory,
    });

    const consume = async () => {
      const output: string[] = [];
      for await (const delta of runner(
        'codex.exe',
        { prompt: 'prompt', model: 'model', reasoningEffort: 'medium' },
        new AbortController().signal,
      )) {
        output.push(delta.text);
      }
      return output;
    };

    await expect(consume()).resolves.toEqual(['reply_1']);
    await expect(consume()).resolves.toEqual(['reply_2']);
    expect(connectionFactory).toHaveBeenCalledOnce();
    expect(fake.sent.filter((message) => message.method === 'initialize')).toHaveLength(1);
    expect(fake.sent.filter((message) => message.method === 'thread/start')).toHaveLength(2);
  });

  it('starts an ephemeral read-only turn and emits only agent message deltas', async () => {
    const fake = connection([
      { id: 1, result: { userAgent: 'codex', codexHome: 'C:/codex', platformFamily: 'windows' } },
      { method: 'thread/started', params: { thread: { id: 'thread_1' } } },
      { id: 2, result: { thread: { id: 'thread_1' } } },
      { id: 3, result: { turn: { id: 'turn_1' } } },
      {
        method: 'item/reasoning/textDelta',
        params: { threadId: 'thread_1', turnId: 'turn_1', delta: 'internal' },
      },
      {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', delta: '第一' },
      },
      {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', delta: '句。' },
      },
      {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', delta: '第二句。' },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'agentMessage', text: '第一句。第二句。' },
        },
      },
      {
        method: 'turn/completed',
        params: { threadId: 'thread_1', turn: { id: 'turn_1', status: 'completed' } },
      },
    ]);
    const output: string[] = [];

    for await (const delta of runCodexAppServerGeneration(
      'codex.exe',
      {
        prompt: '只输出课程回复',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        workingDirectory: 'D:/workspace/course',
      },
      new AbortController().signal,
      () => fake.value,
    )) {
      output.push(delta.text);
    }

    expect(output).toEqual(['第一句。', '第二句。']);
    expect(fake.sent).toEqual([
      expect.objectContaining({ id: 1, method: 'initialize' }),
      { method: 'initialized' },
      {
        id: 2,
        method: 'thread/start',
        params: {
          model: 'gpt-5.6-sol',
          cwd: 'D:/workspace/course',
          approvalPolicy: 'never',
          sandbox: 'read-only',
          ephemeral: true,
        },
      },
      {
        id: 3,
        method: 'turn/start',
        params: {
          threadId: 'thread_1',
          input: [{ type: 'text', text: '只输出课程回复', text_elements: [] }],
          model: 'gpt-5.6-sol',
          effort: 'high',
          approvalPolicy: 'never',
        },
      },
    ]);
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('uses the completed agent item when a CLI version emits no deltas', async () => {
    const fake = connection([
      { id: 1, result: {} },
      { id: 2, result: { thread: { id: 'thread_1' } } },
      { id: 3, result: { turn: { id: 'turn_1' } } },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'agentMessage', text: '最终完整回复' },
        },
      },
      {
        method: 'turn/completed',
        params: { threadId: 'thread_1', turn: { id: 'turn_1', status: 'completed' } },
      },
    ]);
    const output: string[] = [];

    for await (const delta of runCodexAppServerGeneration(
      'codex.exe',
      { prompt: 'prompt', model: 'model', reasoningEffort: 'high' },
      new AbortController().signal,
      () => fake.value,
    )) {
      output.push(delta.text);
    }

    expect(output).toEqual(['最终完整回复']);
  });

  it('keeps sequential agent message items independent within one turn', async () => {
    const fake = connection([
      { id: 1, result: {} },
      { id: 2, result: { thread: { id: 'thread_1' } } },
      { id: 3, result: { turn: { id: 'turn_1' } } },
      {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'item_1',
          delta: 'Compare the two quantifiers:\n\n',
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: {
            id: 'item_1',
            type: 'agentMessage',
            text: 'Compare the two quantifiers:\n\n',
            phase: 'commentary',
          },
        },
      },
      {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'item_2',
          delta: '\\[\\forall x\\,\\exists y\\; P(x,y)\\]',
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: {
            id: 'item_2',
            type: 'agentMessage',
            text: '\\[\\forall x\\,\\exists y\\; P(x,y)\\]',
            phase: 'final_answer',
          },
        },
      },
      {
        method: 'turn/completed',
        params: { threadId: 'thread_1', turn: { id: 'turn_1', status: 'completed' } },
      },
    ]);
    const output: string[] = [];

    for await (const delta of runCodexAppServerGeneration(
      'codex.exe',
      { prompt: 'prompt', model: 'model', reasoningEffort: 'high' },
      new AbortController().signal,
      () => fake.value,
    )) {
      output.push(delta.text);
    }

    expect(output.join('')).toBe(
      'Compare the two quantifiers:\n\n\\[\\forall x\\,\\exists y\\; P(x,y)\\]',
    );
  });

  it('rejects a completed item that contradicts already emitted deltas', async () => {
    const fake = connection([
      { id: 1, result: {} },
      { id: 2, result: { thread: { id: 'thread_1' } } },
      { id: 3, result: { turn: { id: 'turn_1' } } },
      {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', delta: '已展示内容。' },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'agentMessage', text: '不同的最终内容' },
        },
      },
    ]);
    const output: string[] = [];
    const consume = async () => {
      for await (const delta of runCodexAppServerGeneration(
        'codex.exe',
        { prompt: 'prompt', model: 'model', reasoningEffort: 'high' },
        new AbortController().signal,
        () => fake.value,
      )) {
        output.push(delta.text);
      }
    };

    await expect(consume()).rejects.toThrow('codex_app_server_stream_mismatch');
    expect(output).toEqual(['已展示内容。']);
  });
});
