import {
  taskDefinitionsMatch,
  type HostTaskDefinition,
  type TaskSchedulerPort,
} from './task-scheduler.js';

export type HostInstallationStatus = Readonly<{
  state: 'missing' | 'installed' | 'drifted';
  matches: boolean;
  desired: HostTaskDefinition;
  actual?: HostTaskDefinition;
}>;

export interface HostManager {
  install(): Promise<HostInstallationStatus>;
  status(): Promise<HostInstallationStatus>;
  repair(): Promise<HostInstallationStatus>;
  uninstall(): Promise<void>;
}

export function createHostManager(options: {
  scheduler: TaskSchedulerPort;
  desired: HostTaskDefinition;
}): HostManager {
  const status = async (): Promise<HostInstallationStatus> => {
    const actual = await options.scheduler.read(options.desired.name);
    if (actual === undefined) {
      return { state: 'missing', matches: false, desired: options.desired };
    }
    const matches = taskDefinitionsMatch(actual, options.desired);
    return {
      state: matches ? 'installed' : 'drifted',
      matches,
      desired: options.desired,
      actual,
    };
  };

  const reconcile = async (): Promise<HostInstallationStatus> => {
    const before = await status();
    if (!before.matches) {
      await options.scheduler.replace(options.desired);
      await options.scheduler.start(options.desired.name);
    }
    return status();
  };

  return {
    install: reconcile,
    status,
    repair: reconcile,
    async uninstall() {
      await options.scheduler.remove(options.desired.name);
    },
  };
}
