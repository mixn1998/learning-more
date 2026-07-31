import { spawn } from 'node:child_process';

export type MaintenanceLoop = Readonly<{
  start(): void;
  stop(): Promise<void>;
}>;

export function createMaintenanceLoop(options: {
  run(): Promise<void>;
  intervalMs?: number;
}): MaintenanceLoop {
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;
  const trigger = () => {
    if (inFlight !== undefined) return;
    inFlight = options
      .run()
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined;
      });
  };
  return {
    start() {
      if (timer !== undefined) return;
      trigger();
      timer = setInterval(trigger, options.intervalMs ?? 6 * 60 * 60 * 1_000);
      timer.unref();
    },
    async stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await inFlight;
    },
  };
}

export async function runMaintenanceProcess(options: {
  executablePath: string;
  maintenanceEntry: string;
  dataRoot: string;
  backupRoot: string;
  buildId: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      options.executablePath,
      [options.maintenanceEntry, 'lifecycle', options.dataRoot, options.backupRoot],
      {
        env: { ...process.env, LEARNING_MORE_BUILD_ID: options.buildId },
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`maintenance_lifecycle_failed:${String(code)}`));
    });
  });
}
