export class RepositoryVersionConflictError extends Error {
  readonly code = 'version_conflict';

  constructor(readonly currentVersion: number) {
    super('version_conflict');
    this.name = 'RepositoryVersionConflictError';
  }
}

export class ImmutableResourceError extends Error {
  readonly code = 'immutable_resource';

  constructor() {
    super('immutable_resource');
    this.name = 'ImmutableResourceError';
  }
}
