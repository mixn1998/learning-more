export type HostTaskDefinition = Readonly<{
  name: 'Learning MORE';
  executable: string;
  arguments: readonly string[];
  userId: string;
  trigger: 'logon';
  runLevel: 'limited' | 'highest';
  startWhenAvailable: true;
  allowStartOnBatteries: boolean;
  stopIfGoingOnBatteries: boolean;
  stopOnIdleEnd: boolean;
  allowHardTerminate: boolean;
  multipleInstances: 'ignore-new';
  restartIntervalMinutes: 1;
  restartCount: number;
  executionTimeLimit: 'PT0S';
}>;

export interface TaskSchedulerPort {
  read(name: HostTaskDefinition['name']): Promise<HostTaskDefinition | undefined>;
  replace(definition: HostTaskDefinition): Promise<void>;
  remove(name: HostTaskDefinition['name']): Promise<void>;
  start(name: HostTaskDefinition['name']): Promise<void>;
}

export function taskDefinitionsMatch(
  actual: HostTaskDefinition | undefined,
  desired: HostTaskDefinition,
): boolean {
  return actual !== undefined && JSON.stringify(actual) === JSON.stringify(desired);
}
