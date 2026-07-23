import type { TransactionContext } from '../../../persistence/unit-of-work.js';

export interface MaterialRecord {
  readonly artifactRef: string;
  readonly outlineSessionId: string;
  readonly originalFileName: string;
  readonly format: 'markdown' | 'text' | 'pdf';
  readonly sha256: string;
  readonly importedAt: string;
  readonly parserVersion: 'material-ingestion-v1';
  readonly extractedText: string;
  readonly sections: readonly {
    readonly title: string;
    readonly level: number;
    readonly startPage?: number;
    readonly endPage?: number;
  }[];
  readonly warnings: readonly string[];
  readonly resourceVersion: number;
}

export interface MaterialRepository {
  get(artifactRef: string): Promise<MaterialRecord | undefined>;
  save(tx: TransactionContext, material: MaterialRecord, expectedVersion: 0): Promise<void>;
  listBySession(outlineSessionId: string): AsyncIterable<MaterialRecord>;
}
