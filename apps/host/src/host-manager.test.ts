import { describe, expect, it } from 'vitest';

import type { HostTaskDefinition, TaskSchedulerPort } from './task-scheduler.js';
import { createHostManager } from './host-manager.js';

const desired: HostTaskDefinition = {
  name: 'Learning MORE',
  executable: 'C:\\Program Files\\nodejs\\node.exe',
  arguments: ['C:\\Learning MORE\\host\\main.js', 'run'],
  userId: 'DOGGY\\14627',
  trigger: 'logon',
  startWhenAvailable: true,
  multipleInstances: 'ignore-new',
  restartIntervalMinutes: 1,
  restartCount: 999,
  executionTimeLimit: 'PT0S',
};

class MemoryScheduler implements TaskSchedulerPort {
  definition: HostTaskDefinition | undefined;
  replacements = 0;
  starts = 0;

  async read() {
    return this.definition;
  }

  async replace(definition: HostTaskDefinition) {
    this.replacements += 1;
    this.definition = structuredClone(definition);
  }

  async remove() {
    this.definition = undefined;
  }

  async start() {
    this.starts += 1;
  }
}

describe('Windows Host manager', () => {
  it('installs and repairs the exact per-user logon task idempotently', async () => {
    const scheduler = new MemoryScheduler();
    const manager = createHostManager({ scheduler, desired });

    await expect(manager.install()).resolves.toMatchObject({ state: 'installed', matches: true });
    expect(scheduler.replacements).toBe(1);
    expect(scheduler.starts).toBe(1);

    await expect(manager.install()).resolves.toMatchObject({ state: 'installed', matches: true });
    expect(scheduler.replacements).toBe(1);
    expect(scheduler.starts).toBe(2);

    scheduler.definition = { ...desired, restartCount: 0 };
    await expect(manager.status()).resolves.toMatchObject({ state: 'drifted', matches: false });
    await expect(manager.repair()).resolves.toMatchObject({ state: 'installed', matches: true });
    expect(scheduler.replacements).toBe(2);
    expect(scheduler.starts).toBe(3);
  });

  it('removes only the fixed Learning MORE task and never user data', async () => {
    const scheduler = new MemoryScheduler();
    scheduler.definition = desired;
    const manager = createHostManager({ scheduler, desired });

    await manager.uninstall();

    await expect(manager.status()).resolves.toMatchObject({ state: 'missing', matches: false });
  });
});
