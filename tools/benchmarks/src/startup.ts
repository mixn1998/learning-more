import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { duration, enforceBudget, medianOfFive } from './benchmark.js';

async function coldStartOnce(projectRoot: string, port: number): Promise<number> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-benchmark-startup-'));
  const serverEntry = path.join(projectRoot, 'apps', 'server', 'dist', 'bootstrap', 'main.js');
  const child = spawn(
    process.execPath,
    [serverEntry, '--data-root', path.join(root, 'data'), '--server-port', String(port)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        LEARNING_MORE_RUNTIME_DIR: path.join(root, 'runtime'),
        LEARNING_MORE_LOG_DIR: path.join(root, 'logs'),
        LEARNING_MORE_SECRET_DIR: path.join(root, 'secrets'),
      },
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  try {
    return await duration(async () => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/v1/runtime/ready`);
          if (response.ok && ((await response.json()) as { status?: unknown }).status === 'ready') {
            return;
          }
        } catch {
          // Cold start has not reached the listening phase yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('benchmark_startup_timeout');
    });
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    await rm(root, { recursive: true, force: true });
  }
}

const defaultProjectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

export async function benchmarkStartup(projectRoot = defaultProjectRoot): Promise<number> {
  const observed = await medianOfFive(() => coldStartOnce(projectRoot, 43_210));
  enforceBudget('cold_start_median_of_five', observed, 5_000);
  return observed;
}
