import { createHash, randomUUID } from 'node:crypto';
import { appendFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { GenerationStreamEventSchema, type GenerationStreamEvent } from '@learning-more/contracts';

import { DataRoot } from '../../../persistence/data-root.js';
import { checksumJson, encodeJson, StorageDocumentError } from '../../../persistence/json-codec.js';
import type { GenerationFrameLog, GenerationFrameMeta } from '../interface.js';

function prefix(dataRoot: DataRoot, taskId: string): string {
  const hash = createHash('sha256').update(taskId).digest('hex');
  return path.join(dataRoot.absolutePath, 'tasks', 'journals', hash);
}

async function writeAtomic(filePath: string, value: string): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, 'utf8');
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function reconciledMeta(
  stored: GenerationFrameMeta,
  frames: readonly GenerationStreamEvent[],
): GenerationFrameMeta {
  const last = frames.at(-1);
  if (last === undefined) return stored;
  const state =
    last.type === 'task.completed'
      ? 'completed'
      : last.type === 'task.failed'
        ? 'failed'
        : last.type === 'task.cancelled'
          ? 'cancelled'
          : stored.state;
  return {
    taskId: stored.taskId,
    state,
    lastSequence: Math.max(stored.lastSequence, last.sequence),
  };
}

export function createGenerationFrameLog(
  dataRoot: DataRoot,
  options: { readonly maxFrames: number } = { maxFrames: 1_000 },
): GenerationFrameLog {
  const appendTails = new Map<string, Promise<void>>();

  async function serializeAppend<T>(taskId: string, work: () => Promise<T>): Promise<T> {
    const previous = appendTails.get(taskId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const current = previous.catch(() => undefined).then(() => gate);
    appendTails.set(taskId, current);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (appendTails.get(taskId) === current) appendTails.delete(taskId);
    }
  }

  async function readMeta(taskId: string): Promise<GenerationFrameMeta> {
    return JSON.parse(
      await readFile(`${prefix(dataRoot, taskId)}.meta.json`, 'utf8'),
    ) as GenerationFrameMeta;
  }
  async function readFrames(taskId: string): Promise<GenerationStreamEvent[]> {
    try {
      const text = await readFile(`${prefix(dataRoot, taskId)}.frames.ndjson`, 'utf8');
      return text
        .trimEnd()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const record = JSON.parse(line) as { frame: unknown; checksum: string };
          const frame = GenerationStreamEventSchema.parse(record.frame);
          if (record.checksum !== checksumJson(frame))
            throw new StorageDocumentError('storage_corrupted');
          return frame;
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  return {
    async ensureTask(taskId, state) {
      try {
        await readMeta(taskId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await writeAtomic(
          `${prefix(dataRoot, taskId)}.meta.json`,
          encodeJson({ taskId, state, lastSequence: 0 }),
        );
      }
    },
    async append(taskId, type, data) {
      return serializeAppend(taskId, async () => {
        const storedMeta = await readMeta(taskId);
        const existingFrames = await readFrames(taskId);
        const meta = reconciledMeta(storedMeta, existingFrames);
        const frame = GenerationStreamEventSchema.parse({
          taskId,
          sequence: meta.lastSequence + 1,
          emittedAt: new Date().toISOString(),
          type,
          data,
        });
        const framesPath = `${prefix(dataRoot, taskId)}.frames.ndjson`;
        await appendFile(framesPath, encodeJson({ frame, checksum: checksumJson(frame) }), 'utf8');
        const frames = await readFrames(taskId);
        if (frames.length > options.maxFrames) {
          await writeAtomic(
            framesPath,
            frames
              .slice(-options.maxFrames)
              .map((item) => encodeJson({ frame: item, checksum: checksumJson(item) }))
              .join(''),
          );
        }
        meta.lastSequence = frame.sequence;
        if (type === 'task.completed') meta.state = 'completed';
        else if (type === 'task.failed') meta.state = 'failed';
        else if (type === 'task.cancelled') meta.state = 'cancelled';
        try {
          await writeAtomic(`${prefix(dataRoot, taskId)}.meta.json`, encodeJson(meta));
        } catch {
          // Frames are append-only and authoritative; readAfter reconciles stale metadata.
        }
        return frame;
      });
    },
    async readAfter(taskId, sequence) {
      const storedMeta = await readMeta(taskId);
      const frames = await readFrames(taskId);
      const meta = reconciledMeta(storedMeta, frames);
      const firstSequence = frames[0]?.sequence ?? meta.lastSequence + 1;
      return {
        reset: sequence < firstSequence - 1,
        frames: frames.filter((frame) => frame.sequence > sequence),
        meta,
      };
    },
  };
}
