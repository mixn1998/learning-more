import { rename } from 'node:fs/promises';

const TRANSIENT_REPLACE_CODES = new Set(['EPERM', 'EBUSY']);

export type AtomicReplaceOptions = Readonly<{
  maxAttempts?: number;
  renameFile?: (source: string, target: string) => Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
}>;

export type TransientFileOperationOptions = Readonly<{
  maxAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
}>;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function transientReplaceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    TRANSIENT_REPLACE_CODES.has((error as NodeJS.ErrnoException).code ?? '')
  );
}

/**
 * Replaces a file atomically while tolerating the short-lived read handles that
 * Windows may retain after a reader has finished parsing the previous value.
 */
export async function replaceFileAtomic(
  source: string,
  target: string,
  options: AtomicReplaceOptions = {},
): Promise<void> {
  const renameFile = options.renameFile ?? rename;
  return retryTransientFileOperation(() => renameFile(source, target), options);
}

export async function retryTransientFileOperation<T>(
  operation: () => Promise<T>,
  options: TransientFileOperationOptions = {},
): Promise<T> {
  const waitForRetry = options.wait ?? wait;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 8);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!transientReplaceError(error) || attempt >= maxAttempts) throw error;
      await waitForRetry(Math.min(4 * 2 ** (attempt - 1), 32));
    }
  }
}
