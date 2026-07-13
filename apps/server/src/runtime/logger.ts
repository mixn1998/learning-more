import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { serializeRedacted } from './redaction.js';

export type LogStream = 'runtime' | 'application' | 'generation' | 'projection' | 'security';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type StructuredLogInput = Readonly<{
  level: LogLevel;
  component: string;
  correlationId: string;
  eventCode: string;
  fields?: Readonly<Record<string, unknown>>;
}>;

export interface StructuredLogger {
  log(stream: LogStream, input: StructuredLogInput): Promise<void>;
  close(): Promise<void>;
}

export function createStructuredLogger(options: {
  directory: string;
  instanceId: string;
  now?: () => Date;
  maxTotalBytes?: number;
  retentionDays?: number;
}): StructuredLogger {
  const now = options.now ?? (() => new Date());
  const maxTotalBytes = options.maxTotalBytes ?? 200 * 1024 * 1024;
  const retentionDays = options.retentionDays ?? 30;
  let barrier: Promise<void> = Promise.resolve();

  async function prune(): Promise<void> {
    const entries = await readdir(options.directory, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map(async (entry) => {
          const filePath = path.join(options.directory, entry.name);
          return { filePath, ...(await stat(filePath)) };
        }),
    );
    const cutoff = now().getTime() - retentionDays * 86_400_000;
    for (const file of files) {
      if (file.mtimeMs < cutoff) await rm(file.filePath, { force: true });
    }
    const retained = files
      .filter((file) => file.mtimeMs >= cutoff)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = retained.reduce((sum, file) => sum + file.size, 0);
    for (const file of retained) {
      if (total <= maxTotalBytes) break;
      await rm(file.filePath, { force: true });
      total -= file.size;
    }
  }

  async function write(stream: LogStream, input: StructuredLogInput): Promise<void> {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,99}$/.test(input.component)) {
      throw new Error('log_component_invalid');
    }
    if (!/^[a-z][a-z0-9_]{0,99}$/.test(input.eventCode)) {
      throw new Error('log_event_code_invalid');
    }
    const timestamp = now().toISOString();
    const day = timestamp.slice(0, 10);
    await mkdir(options.directory, { recursive: true });
    await appendFile(
      path.join(options.directory, `${stream}-${day}.jsonl`),
      `${serializeRedacted({
        timestamp,
        level: input.level,
        component: input.component,
        instanceId: options.instanceId,
        correlationId: input.correlationId,
        eventCode: input.eventCode,
        fields: input.fields ?? {},
      })}\n`,
      'utf8',
    );
    await prune();
  }

  return {
    log(stream, input) {
      const operation = barrier.then(
        () => write(stream, input),
        () => write(stream, input),
      );
      barrier = operation.catch(() => undefined);
      return operation;
    },
    async close() {
      await barrier;
    },
  };
}
