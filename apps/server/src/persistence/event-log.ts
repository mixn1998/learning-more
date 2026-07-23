import { open, readFile, rename, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { LearningEventEnvelopeSchema, type LearningEventEnvelope } from '@learning-more/contracts';

import { DataRoot } from './data-root.js';
import { checksumJson, encodeJson, StorageDocumentError } from './json-codec.js';
import { acquireStoreWriteLease } from './store-write-lease.js';

interface EventLogRecord {
  readonly length: number;
  readonly payload: LearningEventEnvelope;
  readonly checksum: string;
}

export interface EventLog {
  append(event: LearningEventEnvelope): Promise<'appended' | 'duplicate'>;
  readAll(): Promise<LearningEventEnvelope[]>;
}

function segmentPath(dataRoot: DataRoot): string {
  return path.join(dataRoot.absolutePath, 'events', 'segments', '00000001.ndjson');
}

async function repairIncompleteTail(filePath: string, text: string): Promise<string> {
  if (text.length === 0 || text.endsWith('\n')) return text;
  const finalNewline = text.lastIndexOf('\n');
  const validLength = finalNewline < 0 ? 0 : Buffer.byteLength(text.slice(0, finalNewline + 1));
  await truncate(filePath, validLength);
  return finalNewline < 0 ? '' : text.slice(0, finalNewline + 1);
}

async function readRecords(dataRoot: DataRoot): Promise<LearningEventEnvelope[]> {
  const filePath = segmentPath(dataRoot);
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  text = await repairIncompleteTail(filePath, text);
  const events: LearningEventEnvelope[] = [];
  const ids = new Set<string>();
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    try {
      const record = JSON.parse(line) as EventLogRecord;
      const event = LearningEventEnvelopeSchema.parse(record.payload);
      if (
        record.length !== Buffer.byteLength(encodeJson(event), 'utf8') ||
        record.checksum !== checksumJson(event) ||
        ids.has(event.id)
      ) {
        throw new StorageDocumentError('storage_corrupted');
      }
      ids.add(event.id);
      events.push(event);
    } catch (error) {
      if (error instanceof StorageDocumentError) throw error;
      throw new StorageDocumentError('storage_corrupted', error);
    }
  }
  return events;
}

async function writeIndex(
  dataRoot: DataRoot,
  events: readonly LearningEventEnvelope[],
): Promise<void> {
  const indexPath = path.join(dataRoot.absolutePath, 'events', 'event-log.json');
  const temporaryPath = `${indexPath}.tmp`;
  await writeFile(
    temporaryPath,
    encodeJson({
      schemaVersion: 1,
      segment: '00000001.ndjson',
      eventCount: events.length,
      lastEventId: events.at(-1)?.id,
      eventsChecksum: checksumJson(events),
    }),
    'utf8',
  );
  await rename(temporaryPath, indexPath);
}

export function createEventLog(dataRoot: DataRoot): EventLog {
  return {
    async append(event) {
      const parsed = LearningEventEnvelopeSchema.parse(event);
      const lease = await acquireStoreWriteLease(dataRoot, undefined, {
        waitTimeoutMs: 5_000,
        retryIntervalMs: 10,
      });
      try {
        const existing = await readRecords(dataRoot);
        if (existing.some((candidate) => candidate.id === parsed.id)) return 'duplicate';
        const record: EventLogRecord = {
          length: Buffer.byteLength(encodeJson(parsed), 'utf8'),
          payload: parsed,
          checksum: checksumJson(parsed),
        };
        const handle = await open(segmentPath(dataRoot), 'a');
        try {
          await handle.writeFile(encodeJson(record), 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await writeIndex(dataRoot, [...existing, parsed]);
        return 'appended';
      } finally {
        await lease.release();
      }
    },
    readAll() {
      return readRecords(dataRoot);
    },
  };
}
