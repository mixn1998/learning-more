import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { encodeJson } from '../persistence/json-codec.js';
import { redactForLog } from './redaction.js';

async function readRedactedLogs(directory: string): Promise<unknown[]> {
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records: unknown[] = [];
  let retainedBytes = 0;
  for (const name of names.reverse()) {
    const content = await readFile(path.join(directory, name), 'utf8');
    retainedBytes += Buffer.byteLength(content);
    if (retainedBytes > 10 * 1024 * 1024) break;
    for (const line of content.split('\n')) {
      if (line === '') continue;
      try {
        records.push(redactForLog(JSON.parse(line) as unknown));
      } catch {
        records.push({ eventCode: 'diagnostic_log_line_invalid' });
      }
    }
  }
  return records;
}

export async function createDiagnosticsArtifact(input: {
  outputDirectory: string;
  logDirectory: string;
  publicConfig: Readonly<Record<string, unknown>>;
  manifest: Readonly<Record<string, unknown>>;
  checksumReport: unknown;
  now?: () => Date;
}): Promise<Readonly<{ artifactRef: string; filePath: string }>> {
  const now = input.now ?? (() => new Date());
  const artifactRef = `diagnostics_${randomUUID()}`;
  const filePath = path.join(input.outputDirectory, `${artifactRef}.json`);
  const publicConfig = {
    timezone: input.publicConfig.timezone,
    launcherPort: input.publicConfig.launcherPort,
    serverPort: input.publicConfig.serverPort,
    providerId: input.publicConfig.providerId,
    interactiveConcurrency: input.publicConfig.interactiveConcurrency,
    backgroundConcurrency: input.publicConfig.backgroundConcurrency,
    logLevel: input.publicConfig.logLevel,
  };
  const manifestSummary = {
    instanceId: input.manifest.instanceId,
    generation: input.manifest.generation,
    buildId: input.manifest.buildId,
    protocolVersion: input.manifest.protocolVersion,
    startedAt: input.manifest.startedAt,
    identityFingerprint: input.manifest.identityFingerprint,
  };
  const artifact = redactForLog({
    schemaVersion: 1,
    artifactRef,
    createdAt: now().toISOString(),
    publicConfig,
    manifestSummary,
    checksumReport: input.checksumReport,
    logs: await readRedactedLogs(input.logDirectory),
  });
  await mkdir(input.outputDirectory, { recursive: true });
  await writeFile(filePath, encodeJson(artifact), { encoding: 'utf8', mode: 0o600 });
  return { artifactRef, filePath };
}
