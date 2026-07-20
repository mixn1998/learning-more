import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { ProviderExecutionError, type ProviderDelta } from './provider.js';

export type CodexCliGenerationRequest = Readonly<{
  prompt: string;
  model: string;
  reasoningEffort: string;
  workingDirectory?: string;
}>;

export type CodexAppServerConnection = Readonly<{
  send(message: Readonly<Record<string, unknown>>): void;
  messages(): AsyncIterable<unknown>;
  close(): Promise<void>;
}>;

export type CodexAppServerConnectionFactory = (
  executable: string,
  signal: AbortSignal,
) => CodexAppServerConnection;

export type CodexCliAppServerGenerationRunner = (
  executable: string,
  request: CodexCliGenerationRequest,
  signal: AbortSignal,
) => AsyncIterable<ProviderDelta>;

const MAX_BUFFERED_DELTA_LENGTH = 2_048;
const LEGACY_AGENT_ITEM_ID = '__legacy_agent_message__';

type AgentItemStream = {
  assembled: string;
  buffered: string;
};

function flushBoundary(value: string): number {
  let boundary = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '\n' || ['。', '！', '？', '；'].includes(character)) {
      boundary = index + 1;
      continue;
    }
    if (['.', '!', '?', ';'].includes(character) && /\s/u.test(value[index + 1] ?? '')) {
      boundary = index + 1;
    }
  }
  return boundary > 0 ? boundary : value.length >= MAX_BUFFERED_DELTA_LENGTH ? value.length : 0;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stdioConnection(executable: string, signal: AbortSignal): CodexAppServerConnection {
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
    shell: false,
    windowsHide: process.platform === 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let stderr = '';
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.stdin.on('error', () => undefined);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });
  const onAbort = () => child.kill();
  signal.addEventListener('abort', onAbort, { once: true });

  return {
    send(message) {
      if (child.stdin.destroyed) throw new Error('codex_app_server_closed');
      child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8');
    },
    async *messages() {
      try {
        for await (const line of lines) {
          const source = line.trim();
          if (source === '') continue;
          try {
            yield JSON.parse(source) as unknown;
          } catch {
            throw new Error('codex_app_server_protocol_invalid');
          }
        }
        if (!signal.aborted) {
          throw new Error(spawnError?.message ?? (stderr.trim() || 'codex_app_server_closed'));
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
    async close() {
      signal.removeEventListener('abort', onAbort);
      lines.close();
      if (!child.stdin.destroyed) child.stdin.end();
      if (child.exitCode === null) child.kill();
    },
  };
}

async function nextMessage(
  iterator: AsyncIterator<unknown>,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  while (true) {
    const next = await iterator.next();
    if (next.done) throw new Error('codex_app_server_closed');
    const message = object(next.value);
    if (message !== undefined && predicate(message)) return message;
  }
}

function responseResult(message: Record<string, unknown>, id: number): Record<string, unknown> {
  if (message.id !== id) throw new Error('codex_app_server_response_mismatch');
  const error = object(message.error);
  if (error !== undefined) {
    throw new Error(String(error.message ?? 'codex_app_server_request_failed'));
  }
  const result = object(message.result);
  if (result === undefined) throw new Error('codex_app_server_response_invalid');
  return result;
}

export async function* runCodexAppServerGeneration(
  executable: string,
  request: CodexCliGenerationRequest,
  signal: AbortSignal,
  connectionFactory: CodexAppServerConnectionFactory = stdioConnection,
): AsyncIterable<ProviderDelta> {
  if (signal.aborted) return;
  const connection = connectionFactory(executable, signal);
  const iterator = connection.messages()[Symbol.asyncIterator]();
  const agentItems = new Map<string, AgentItemStream>();
  let yieldedAnyText = false;
  const streamFor = (itemId: string): AgentItemStream => {
    const existing = agentItems.get(itemId);
    if (existing !== undefined) return existing;
    const created = { assembled: '', buffered: '' };
    agentItems.set(itemId, created);
    return created;
  };
  try {
    connection.send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'learning-more', title: 'Learning MORE', version: '2' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    });
    responseResult(await nextMessage(iterator, (message) => message.id === 1), 1);
    connection.send({ method: 'initialized' });
    connection.send({
      id: 2,
      method: 'thread/start',
      params: {
        model: request.model,
        cwd: request.workingDirectory ?? process.cwd(),
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
      },
    });
    const threadResult = responseResult(
      await nextMessage(iterator, (message) => message.id === 2),
      2,
    );
    const threadId = String(object(threadResult.thread)?.id ?? '');
    if (threadId === '') throw new Error('codex_app_server_thread_invalid');

    connection.send({
      id: 3,
      method: 'turn/start',
      params: {
        threadId,
        input: [{ type: 'text', text: request.prompt, text_elements: [] }],
        model: request.model,
        effort: request.reasoningEffort,
        approvalPolicy: 'never',
      },
    });
    const turnResult = responseResult(
      await nextMessage(iterator, (message) => message.id === 3),
      3,
    );
    const turnId = String(object(turnResult.turn)?.id ?? '');
    if (turnId === '') throw new Error('codex_app_server_turn_invalid');

    while (!signal.aborted) {
      const next = await iterator.next();
      if (next.done) throw new Error('codex_app_server_closed');
      const message = object(next.value);
      if (message === undefined) continue;
      const method = typeof message.method === 'string' ? message.method : '';
      const params = object(message.params);
      if (method === 'item/agentMessage/delta' && params?.turnId === turnId) {
        const delta = typeof params.delta === 'string' ? params.delta : '';
        if (delta !== '') {
          const itemId = typeof params.itemId === 'string' ? params.itemId : LEGACY_AGENT_ITEM_ID;
          const stream = streamFor(itemId);
          stream.assembled += delta;
          stream.buffered += delta;
          const boundary = flushBoundary(stream.buffered);
          if (boundary > 0) {
            const text = stream.buffered.slice(0, boundary);
            stream.buffered = stream.buffered.slice(boundary);
            yieldedAnyText = true;
            yield { type: 'text', text };
          }
        }
        continue;
      }
      if (method === 'item/completed' && params?.turnId === turnId) {
        const item = object(params.item);
        if (item?.type === 'agentMessage' && typeof item.text === 'string') {
          const itemId =
            typeof item.id === 'string'
              ? item.id
              : agentItems.size === 1
                ? (agentItems.keys().next().value ?? LEGACY_AGENT_ITEM_ID)
                : LEGACY_AGENT_ITEM_ID;
          const stream = streamFor(itemId);
          if (stream.assembled !== '' && !item.text.startsWith(stream.assembled)) {
            throw new Error('codex_app_server_stream_mismatch');
          }
          const remaining = item.text.startsWith(stream.assembled)
            ? item.text.slice(stream.assembled.length)
            : '';
          const text = stream.assembled === '' ? item.text : remaining;
          stream.assembled += text;
          stream.buffered += text;
          if (stream.buffered !== '') {
            yieldedAnyText = true;
            yield { type: 'text', text: stream.buffered };
            stream.buffered = '';
          }
          agentItems.delete(itemId);
        }
        continue;
      }
      if (method === 'error' && params?.turnId === turnId && params.willRetry !== true) {
        throw new Error(String(object(params.error)?.message ?? 'codex_app_server_turn_failed'));
      }
      if (method === 'turn/completed' && params?.threadId === threadId) {
        const turn = object(params.turn);
        if (turn?.id !== turnId) continue;
        if (turn.status !== 'completed') {
          throw new Error(
            String(object(turn.error)?.message ?? `codex_turn_${String(turn.status)}`),
          );
        }
        for (const stream of agentItems.values()) {
          if (stream.buffered === '') continue;
          yieldedAnyText = true;
          yield { type: 'text', text: stream.buffered };
          stream.buffered = '';
        }
        return;
      }
      if (message.id !== undefined && method !== '') {
        connection.send({
          id: message.id,
          error: { code: -32601, message: 'Learning MORE does not expose interactive tools.' },
        });
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    throw new ProviderExecutionError(
      error instanceof Error ? error.message : 'codex_app_server_failed',
      {
        retryable: true,
        beforeFirstDelta: !yieldedAnyText,
        code: 'provider_process_failed',
      },
    );
  } finally {
    await connection.close();
  }
}
