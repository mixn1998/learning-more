import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseBackupManifest, type BackupManifest } from './backup-manifest.js';

export type RetentionDecision = Readonly<{
  keep: readonly string[];
  remove: readonly string[];
}>;

export type RetentionFaultPoint = 'manifest_deleted' | 'objects_collected';

function dateValue(manifest: BackupManifest): number {
  const value = Date.parse(manifest.createdAt);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function weekKey(date: Date): string {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return dayKey(start);
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function keepNewestBuckets(
  sorted: readonly BackupManifest[],
  keep: Set<string>,
  key: (date: Date) => string,
  limit: number,
): void {
  const buckets = new Set<string>();
  for (const manifest of sorted) {
    const date = new Date(manifest.createdAt);
    if (!Number.isFinite(date.getTime())) continue;
    const bucket = key(date);
    if (buckets.has(bucket)) continue;
    buckets.add(bucket);
    keep.add(manifest.backupId);
    if (buckets.size === limit) return;
  }
}

export function selectBackupsForRetention(
  manifests: readonly BackupManifest[],
  now = new Date(),
): RetentionDecision {
  const sorted = [...manifests].sort(
    (left, right) =>
      dateValue(right) - dateValue(left) || left.backupId.localeCompare(right.backupId),
  );
  if (sorted.length === 0) return { keep: [], remove: [] };
  const eligible = sorted.filter((manifest) => dateValue(manifest) <= now.getTime());
  const keep = new Set<string>(
    sorted
      .filter((manifest) => dateValue(manifest) > now.getTime())
      .map((manifest) => manifest.backupId),
  );
  if (eligible[0] !== undefined) keep.add(eligible[0].backupId);
  for (const manifest of sorted) {
    if (manifest.trigger === 'pre-upgrade') keep.add(manifest.backupId);
  }
  keepNewestBuckets(eligible, keep, dayKey, 7);
  keepNewestBuckets(eligible, keep, weekKey, 4);
  keepNewestBuckets(eligible, keep, monthKey, 6);
  return {
    keep: sorted
      .filter((manifest) => keep.has(manifest.backupId))
      .map((manifest) => manifest.backupId),
    remove: sorted
      .filter((manifest) => !keep.has(manifest.backupId))
      .map((manifest) => manifest.backupId),
  };
}

export function shouldCreateAutomaticBackup(
  manifests: readonly BackupManifest[],
  now = new Date(),
): boolean {
  const latest = manifests.reduce(
    (maximum, manifest) => Math.max(maximum, dateValue(manifest)),
    Number.NEGATIVE_INFINITY,
  );
  return !Number.isFinite(latest) || now.getTime() - latest >= 24 * 60 * 60 * 1000;
}

async function installedManifests(backupRoot: string): Promise<BackupManifest[]> {
  const directory = path.join(backupRoot, 'manifests');
  const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) =>
        parseBackupManifest(
          JSON.parse(await readFile(path.join(directory, entry), 'utf8')) as unknown,
        ),
      ),
  );
}

type RetentionJournal = Readonly<{
  journalId: string;
  createdAt: string;
  state: 'pending' | 'complete';
  keep: readonly string[];
  remove: readonly string[];
}>;

async function writeJournal(journalPath: string, journal: RetentionJournal): Promise<void> {
  const temporary = `${journalPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal)}\n`, 'utf8');
  await rename(temporary, journalPath);
}

async function objectFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else output.push(absolute);
    }
  };
  await visit(root);
  return output;
}

async function collectUnreferencedObjects(backupRoot: string): Promise<void> {
  const manifests = await installedManifests(backupRoot);
  const referenced = new Set(
    manifests.flatMap((manifest) => manifest.objects.map((object) => object.checksum)),
  );
  const root = path.join(backupRoot, 'objects', 'sha256');
  for (const filePath of await objectFiles(root)) {
    if (!referenced.has(path.basename(filePath))) await rm(filePath, { force: true });
  }
}

async function finishRetentionJournal(
  backupRoot: string,
  journalPath: string,
  journal: RetentionJournal,
  faultInjector?: (point: RetentionFaultPoint) => void | Promise<void>,
): Promise<void> {
  for (const backupId of journal.remove) {
    await rm(path.join(backupRoot, 'manifests', `${backupId}.json`), { force: true });
  }
  await faultInjector?.('manifest_deleted');
  await collectUnreferencedObjects(backupRoot);
  await faultInjector?.('objects_collected');
  await writeJournal(journalPath, { ...journal, state: 'complete' });
}

export async function resumeBackupRetention(backupRoot: string): Promise<void> {
  const journalDirectory = path.join(backupRoot, 'retention-journals');
  const entries = await readdir(journalDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries.filter((candidate) => candidate.endsWith('.json')).sort()) {
    const journalPath = path.join(journalDirectory, entry);
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RetentionJournal;
    if (journal.state === 'pending') {
      await finishRetentionJournal(backupRoot, journalPath, journal);
    }
  }
}

export async function applyBackupRetention(
  backupRoot: string,
  now = new Date(),
  faultInjector?: (point: RetentionFaultPoint) => void | Promise<void>,
): Promise<RetentionDecision> {
  await resumeBackupRetention(backupRoot);
  const manifests = await installedManifests(backupRoot);
  const decision = selectBackupsForRetention(manifests, now);
  if (decision.remove.length === 0) return decision;

  const journalDirectory = path.join(backupRoot, 'retention-journals');
  const journalId = `retention_${randomUUID()}`;
  const journalPath = path.join(journalDirectory, `${journalId}.json`);
  await mkdir(journalDirectory, { recursive: true });
  const journal: RetentionJournal = {
    journalId,
    createdAt: now.toISOString(),
    state: 'pending',
    ...decision,
  };
  await writeJournal(journalPath, journal);
  await finishRetentionJournal(backupRoot, journalPath, journal, faultInjector);
  return decision;
}
