export type VerificationIssue = Readonly<{
  severity: 'warning' | 'error' | 'fatal';
  code: string;
  path?: string;
  detail?: string;
}>;

export interface StoreMigration<TFrom, TTo> {
  name: string;
  fromVersion: number;
  toVersion: number;
  preconditions(input: TFrom): readonly VerificationIssue[];
  transform(input: TFrom): TTo;
  postconditions(output: TTo): readonly VerificationIssue[];
}

export class SchemaRegistry {
  readonly #migrations = new Map<number, StoreMigration<unknown, unknown>>();

  constructor(migrations: readonly StoreMigration<unknown, unknown>[]) {
    for (const migration of migrations) {
      if (migration.toVersion !== migration.fromVersion + 1) {
        throw new Error('migration_must_be_single_step');
      }
      if (this.#migrations.has(migration.fromVersion)) throw new Error('migration_ambiguous');
      this.#migrations.set(migration.fromVersion, migration);
    }
  }

  plan(fromVersion: number, toVersion: number): readonly StoreMigration<unknown, unknown>[] {
    if (toVersion < fromVersion) throw new Error('migration_downgrade_forbidden');
    const plan: StoreMigration<unknown, unknown>[] = [];
    for (let version = fromVersion; version < toVersion; version += 1) {
      const migration = this.#migrations.get(version);
      if (migration === undefined) throw new Error('migration_path_missing');
      plan.push(migration);
    }
    return plan;
  }
}
