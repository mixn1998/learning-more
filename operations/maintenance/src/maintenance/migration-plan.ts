import type { SchemaRegistry, StoreMigration } from './schema-registry.js';

export function createMigrationPlan(
  registry: SchemaRegistry,
  fromVersion: number,
  toVersion: number,
  currentReaderVersion: number,
): readonly StoreMigration<unknown, unknown>[] {
  if (fromVersion > currentReaderVersion || toVersion > currentReaderVersion) {
    throw new Error('store_version_unsupported');
  }
  return registry.plan(fromVersion, toVersion);
}
