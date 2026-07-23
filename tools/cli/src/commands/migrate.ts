import { migrateStore } from '../maintenance/migrate-store.js';
import { SchemaRegistry } from '../maintenance/schema-registry.js';

export async function migrateCommand(arguments_: readonly string[]): Promise<number> {
  const storeRoot = arguments_[0];
  const targetVersion = Number(arguments_[1]);
  if (storeRoot === undefined || !Number.isInteger(targetVersion)) {
    throw new Error('migrate_arguments_invalid');
  }
  await migrateStore({
    storeRoot,
    targetVersion,
    readerVersion: 1,
    registry: new SchemaRegistry([]),
  });
  process.stdout.write(`${JSON.stringify({ status: 'migrated', targetVersion })}\n`);
  return 0;
}
