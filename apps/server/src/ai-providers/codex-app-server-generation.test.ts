import { describe, expect, it, vi } from 'vitest';

import {
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
