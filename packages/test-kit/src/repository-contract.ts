export type CorruptionMode = 'truncate' | 'checksum' | 'missing-reference';

export interface RepositoryContractHarness<TRepository> {
  createRepository(): Promise<TRepository>;
  corrupt(target: string, mode: CorruptionMode): Promise<void>;
  reopen(): Promise<TRepository>;
}
