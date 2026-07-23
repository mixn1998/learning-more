import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
type WatchHandle = Readonly<{ close(): void }>;

const ROOT_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
]);
const SOURCE_ROOTS = new Set(['apps', 'packages', 'tools']);
const IGNORED_SEGMENTS = new Set([
  '.git',
  '.learning-more-data',
  '.learning-more-local',
  '.learning-more-runtime',
  'dist',
  'node_modules',
]);

export function isActivationRelevantPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (ROOT_FILES.has(normalized)) return true;
  const segments = normalized.split('/').filter(Boolean);
  const sourceRoot = segments[0];
  if (sourceRoot === undefined || segments.length < 2 || !SOURCE_ROOTS.has(sourceRoot))
    return false;
  return !segments.some((segment) => IGNORED_SEGMENTS.has(segment));
}

async function writeActivationRequest(requestPath: string, requestId: string): Promise<void> {
  const temporary = `${requestPath}.${requestId}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, requestId })}\n`, 'utf8');
    await rename(temporary, requestPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

export interface WorkspaceAutoActivationMonitor {
  start(): void;
  stop(): void;
}

export function createWorkspaceAutoActivationMonitor(options: {
  projectRoot: string;
  requestPath: string;
  quietMs?: number;
  nextRequestId?: () => string;
  watchWorkspace?: (listener: (relativePath: string | undefined) => void) => WatchHandle;
  publishRequest?: (requestId: string) => Promise<void>;
}): WorkspaceAutoActivationMonitor {
  const quietMs = options.quietMs ?? 15_000;
  const nextRequestId = options.nextRequestId ?? randomUUID;
  const publishRequest =
    options.publishRequest ??
    ((requestId) => writeActivationRequest(options.requestPath, requestId));
  const watchWorkspace =
    options.watchWorkspace ??
    ((listener) => {
      const watcher = watch(options.projectRoot, { recursive: true }, (_eventType, filename) =>
        listener(filename?.toString()),
      );
      return { close: () => watcher.close() };
    });
  let watcher: WatchHandle | undefined;
  let timer: NodeJS.Timeout | undefined;
  let publishing = false;
  let pending = false;
  let running = false;

  const publishLatest = async () => {
    timer = undefined;
    if (publishing) {
      pending = true;
      return;
    }
    publishing = true;
    try {
      await publishRequest(nextRequestId());
    } catch {
      pending = true;
    } finally {
      publishing = false;
      if (running && pending) {
        pending = false;
        timer = setTimeout(() => void publishLatest(), quietMs);
      }
    }
  };

  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void publishLatest(), quietMs);
  };

  const changed = (relativePath: string | undefined) => {
    if (relativePath === undefined || !isActivationRelevantPath(relativePath)) return;
    schedule();
  };

  return {
    start() {
      if (watcher !== undefined) return;
      running = true;
      watcher = watchWorkspace(changed);
      schedule();
    },
    stop() {
      running = false;
      watcher?.close();
      watcher = undefined;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = false;
    },
  };
}
