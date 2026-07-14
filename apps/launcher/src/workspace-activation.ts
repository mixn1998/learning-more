import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ActivationPhase =
  'preparing' | 'unchanged' | 'building' | 'activating' | 'activated' | 'failed';

type ActivationStatus = Readonly<{
  schemaVersion: 1;
  requestId: string;
  phase: ActivationPhase;
  sourceBuildId?: string;
}>;

function parseStatus(value: unknown): ActivationStatus | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== 1 ||
    typeof input.requestId !== 'string' ||
    !['preparing', 'unchanged', 'building', 'activating', 'activated', 'failed'].includes(
      String(input.phase),
    ) ||
    (input.sourceBuildId !== undefined && typeof input.sourceBuildId !== 'string')
  ) {
    return undefined;
  }
  return input as ActivationStatus;
}

async function writeAtomically(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function requestWorkspaceActivation(options: {
  requestPath: string;
  statusPath: string;
  wait?(delayMs: number): Promise<void>;
  now?(): number;
}): Promise<
  Readonly<{ mode: 'reconnect' }> | Readonly<{ mode: 'activate'; targetBuildId: string }>
> {
  const requestId = randomUUID();
  await writeAtomically(options.requestPath, {
    schemaVersion: 1,
    requestId,
    requestedAt: new Date(options.now?.() ?? Date.now()).toISOString(),
  });
  const deadline = (options.now?.() ?? Date.now()) + 5_000;
  while ((options.now?.() ?? Date.now()) < deadline) {
    try {
      const status = parseStatus(JSON.parse(await readFile(options.statusPath, 'utf8')) as unknown);
      if (status?.requestId === requestId) {
        if (status.phase === 'unchanged') return { mode: 'reconnect' };
        if (
          ['preparing', 'building', 'activating', 'activated'].includes(status.phase) &&
          status.sourceBuildId !== undefined
        ) {
          return { mode: 'activate', targetBuildId: status.sourceBuildId };
        }
        if (status.phase === 'failed') throw new Error('workspace_activation_failed');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await (options.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))))(
      100,
    );
  }
  throw new Error('workspace_activation_timeout');
}
