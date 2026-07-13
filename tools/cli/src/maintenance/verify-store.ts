import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { VerificationIssue } from './schema-registry.js';

export type VerificationReport = Readonly<{
  status: 'verified' | 'invalid' | 'unsupported';
  storeVersion?: number;
  issues: readonly VerificationIssue[];
  checkedFiles: number;
  scopes: Readonly<Record<string, 'ok' | 'warning' | 'error'>>;
}>;

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function checksumJson(value: unknown): string {
  const encoded = `${JSON.stringify(canonical(value))}\n`;
  return `sha256:${createHash('sha256').update(encoded).digest('hex')}`;
}

async function files(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    if (entry.isDirectory() && relative === 'quarantine') continue;
    if (entry.isDirectory()) output.push(...(await files(root, absolute)));
    else output.push(relative);
  }
  return output.sort();
}

function issue(
  issues: VerificationIssue[],
  code: string,
  relativePath: string,
  severity: VerificationIssue['severity'] = 'fatal',
) {
  issues.push({ severity, code, path: relativePath });
}

export async function verifyStore(
  storePath: string,
  options: Readonly<{ supportedVersions?: readonly number[] }> = {},
): Promise<VerificationReport> {
  const issues: VerificationIssue[] = [];
  let manifest: Record<string, unknown> | undefined;
  try {
    manifest = JSON.parse(await readFile(path.join(storePath, 'store.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    issue(issues, 'store_manifest_invalid', 'store.json');
  }
  const version = typeof manifest?.formatVersion === 'number' ? manifest.formatVersion : undefined;
  if (version !== undefined && !(options.supportedVersions ?? [1]).includes(version)) {
    issue(issues, 'store_version_unsupported', 'store.json');
  }
  let allFiles: string[] = [];
  try {
    allFiles = await files(storePath);
  } catch {
    issue(issues, 'store_unreadable', '.');
  }
  const artifacts = new Set<string>();
  const artifactRefs: Array<{ ref: string; source: string }> = [];
  const eventPayloads: unknown[] = [];
  const eventIds = new Set<string>();
  let eventIndex: Record<string, unknown> | undefined;
  const outboxPending = new Set<string>();
  const outboxReceipts: Array<{ fileName: string; relativePath: string; eventId?: string }> = [];
  for (const relative of allFiles) {
    const absolute = path.join(storePath, relative);
    if (relative.endsWith('.json')) {
      let value: unknown;
      try {
        value = JSON.parse(await readFile(absolute, 'utf8')) as unknown;
      } catch {
        issue(issues, 'json_invalid', relative);
        continue;
      }
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (relative === 'events/event-log.json') eventIndex = record;
        if (relative.startsWith('outbox/pending/'))
          outboxPending.add(path.posix.basename(relative));
        if (relative.startsWith('outbox/receipts/')) {
          outboxReceipts.push({
            fileName: path.posix.basename(relative),
            relativePath: relative,
            ...(typeof record.eventId === 'string' ? { eventId: record.eventId } : {}),
          });
        }
        if ('data' in record && typeof record.contentSha256 === 'string') {
          if (checksumJson(record.data) !== record.contentSha256) {
            issue(issues, 'envelope_checksum_mismatch', relative);
          }
        }
        if (typeof record.artifactId === 'string') {
          artifacts.add(record.artifactId);
          if (typeof record.contentFile === 'string' && typeof record.contentSha256 === 'string') {
            try {
              const content = await readFile(path.join(path.dirname(absolute), record.contentFile));
              const digest = createHash('sha256').update(content).digest('hex');
              if (digest !== record.contentSha256)
                issue(issues, 'artifact_checksum_mismatch', relative);
            } catch {
              issue(issues, 'artifact_content_missing', relative);
            }
          }
        }
        const scan = (candidate: unknown) => {
          if (candidate === null || typeof candidate !== 'object') return;
          if (Array.isArray(candidate)) return candidate.forEach(scan);
          for (const [key, item] of Object.entries(candidate)) {
            if (key.endsWith('artifactRef') && typeof item === 'string') {
              artifactRefs.push({ ref: item, source: relative });
            }
            scan(item);
          }
        };
        scan(value);
      }
    } else if (relative.endsWith('.ndjson')) {
      const content = await readFile(absolute, 'utf8');
      if (content !== '' && !content.endsWith('\n'))
        issue(issues, 'ndjson_tail_incomplete', relative);
      for (const line of content.split('\n').filter(Boolean)) {
        try {
          const record = JSON.parse(line) as { payload?: unknown; checksum?: unknown };
          if (record.payload !== undefined && record.checksum !== checksumJson(record.payload)) {
            issue(issues, 'event_checksum_mismatch', relative);
          } else if (relative.startsWith('events/segments/') && record.payload !== undefined) {
            eventPayloads.push(record.payload);
            if (
              record.payload !== null &&
              typeof record.payload === 'object' &&
              typeof (record.payload as Record<string, unknown>).id === 'string'
            ) {
              const eventId = (record.payload as Record<string, unknown>).id as string;
              if (eventIds.has(eventId)) issue(issues, 'event_id_duplicate', relative);
              eventIds.add(eventId);
            }
          }
        } catch {
          issue(issues, 'ndjson_record_invalid', relative);
        }
      }
    }
  }
  for (const reference of artifactRefs) {
    if (!artifacts.has(reference.ref))
      issue(issues, 'artifact_reference_missing', reference.source);
  }
  const hasEventSegments = allFiles.some((relative) => relative.startsWith('events/segments/'));
  if (hasEventSegments && eventIndex === undefined) {
    issue(issues, 'event_index_missing', 'events/event-log.json');
  } else if (eventIndex !== undefined) {
    const expectedCount = eventPayloads.length;
    const expectedLastId =
      eventPayloads.length === 0 ||
      eventPayloads.at(-1) === null ||
      typeof eventPayloads.at(-1) !== 'object'
        ? undefined
        : (eventPayloads.at(-1) as Record<string, unknown>).id;
    if (
      eventIndex.eventCount !== expectedCount ||
      eventIndex.eventsChecksum !== checksumJson(eventPayloads) ||
      (expectedLastId === undefined
        ? eventIndex.lastEventId !== undefined
        : eventIndex.lastEventId !== expectedLastId)
    ) {
      issue(issues, 'event_index_mismatch', 'events/event-log.json');
    }
  }
  for (const receipt of outboxReceipts) {
    if (receipt.eventId === undefined) {
      issue(issues, 'outbox_receipt_invalid', receipt.relativePath);
    } else if (!eventIds.has(receipt.eventId)) {
      issue(issues, 'outbox_receipt_event_missing', receipt.relativePath);
    } else if (outboxPending.has(receipt.fileName)) {
      issue(issues, 'outbox_pending_receipt_overlap', receipt.relativePath);
    }
  }
  const unsupported = issues.some((candidate) => candidate.code === 'store_version_unsupported');
  const invalid = issues.some((candidate) => candidate.severity !== 'warning');
  const scopeStatus = (prefix: string) =>
    issues.some((candidate) => candidate.code.includes(prefix))
      ? ('error' as const)
      : ('ok' as const);
  return {
    status: unsupported ? 'unsupported' : invalid ? 'invalid' : 'verified',
    ...(version === undefined ? {} : { storeVersion: version }),
    issues,
    checkedFiles: allFiles.length,
    scopes: {
      store: issues.some((candidate) => candidate.path === 'store.json') ? 'error' : 'ok',
      files: scopeStatus('json'),
      schema: unsupported ? 'error' : 'ok',
      checksum: scopeStatus('checksum'),
      reference: scopeStatus('reference'),
      event: scopeStatus('event'),
      outbox: scopeStatus('outbox'),
      projection: scopeStatus('projection'),
    },
  };
}
