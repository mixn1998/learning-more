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
  retryDelay?: (delayMs: number) => Promise<void>;
}): StructuredLogger {
  const now = options.now ?? (() => new Date());
  const maxTotalBytes = options.maxTotalBytes ?? 200 * 1024 * 1024;
  const retentionDays = options.retentionDays ?? 30;
  let barrier: Promise<void> = Promise.resolve();
  const retryDelay =
    options.retryDelay ??
    ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  function retryableWriteError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
  }

  async function appendWithRecovery(filePath: string, content: string): Promise<void> {
    const delays = [20, 50, 100, 200, 400] as const;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await appendFile(filePath, content, 'utf8');
        return;
      } catch (error) {
        if (!retryableWriteError(error) || attempt >= delays.length) {
          if (!retryableWriteError(error)) throw error;
          const parsed = path.parse(filePath);
          const fallbackPath = path.join(
            parsed.dir,
            `${parsed.name}.${options.instanceId}${parsed.ext}`,
          );
          try {
            await appendFile(fallbackPath, content, 'utf8');
          } catch (fallbackError) {
            if (!retryableWriteError(fallbackError)) throw fallbackError;
          }
          return;
        }
        await retryDelay(delays[attempt]!);
      }
    }
  }

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
    await appendWithRecovery(
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
    );
    await prune().catch(() => undefined);
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
