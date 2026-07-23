import path from 'node:path';

import { restoreStore } from '../maintenance/restore.js';
import { SchemaRegistry } from '../maintenance/schema-registry.js';

function option(arguments_: readonly string[], name: string): string | undefined {
  return arguments_.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function restoreCommand(arguments_: readonly string[]): Promise<number> {
  const positional = arguments_.filter((argument) => !argument.startsWith('--'));
  const [storeRoot, backupRoot, backupId] = positional;
  if (storeRoot === undefined || backupRoot === undefined || backupId === undefined) {
    throw new Error('restore_arguments_invalid');
  }
  const targetVersion = Number(option(arguments_, '--target-version') ?? '1');
  const readerVersion = Number(option(arguments_, '--reader-version') ?? String(targetVersion));
  if (!Number.isInteger(targetVersion) || !Number.isInteger(readerVersion)) {
    throw new Error('restore_arguments_invalid');
  }
  const result = await restoreStore({
    storeRoot: path.resolve(storeRoot),
    backupRoot: path.resolve(backupRoot),
    backupId,
    targetVersion,
    readerVersion,
    registry: new SchemaRegistry([]),
  });
  process.stdout.write(
    `${JSON.stringify({
      status: 'restored',
      activeStorePath: result.activeStorePath,
      previousStorePath: result.previousStorePath,
    })}\n`,
  );
  return 0;
}
