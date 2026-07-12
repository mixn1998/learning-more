import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { DataRoot, assertSafePathSegment } from './data-root.js';
import { ImmutableResourceError } from './local-file-repositories.js';
import type { UnitOfWork } from './unit-of-work.js';

interface ArtifactDocument {
  readonly artifactId: string;
  readonly kind: string;
  readonly contentSha256: string;
  readonly immutable: boolean;
  readonly content: string;
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createMarkdownArtifactStore(dataRoot: DataRoot, unitOfWork: UnitOfWork) {
  function draftPath(id: string): string {
    assertSafePathSegment(id);
    return `work/artifacts/${hash(id)}/draft.md`;
  }
  function basePath(id: string): string {
    assertSafePathSegment(id);
    const digest = hash(id);
    return `entities/artifacts/${digest.slice(0, 2)}/${id}`;
  }
  async function readOptional(relativePath: string): Promise<string | undefined> {
    try {
      return await readFile(path.join(dataRoot.absolutePath, relativePath), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  return {
    async saveDraft(artifactId: string, content: string) {
      await unitOfWork.execute({ transactionId: `tx_artifact_${randomUUID()}` }, (tx) =>
        tx.stageText(draftPath(artifactId), content),
      );
    },
    readDraft: (artifactId: string) => readOptional(draftPath(artifactId)),
    async finalize(input: {
      artifactId: string;
      kind: string;
      content: string;
      immutable: boolean;
    }) {
      const existing = await readOptional(`${basePath(input.artifactId)}/artifact.json`);
      if (existing !== undefined && (JSON.parse(existing) as { immutable?: boolean }).immutable) {
        throw new ImmutableResourceError();
      }
      const contentSha256 = hash(input.content);
      await unitOfWork.execute({ transactionId: `tx_artifact_${randomUUID()}` }, async (tx) => {
        await tx.stageText(`${basePath(input.artifactId)}/content.md`, input.content);
        await tx.stageJson(`${basePath(input.artifactId)}/artifact.json`, {
          schemaVersion: 1,
          artifactId: input.artifactId,
          kind: input.kind,
          contentFile: 'content.md',
          contentSha256,
          immutable: input.immutable,
          completionStatus: 'complete',
          createdAt: new Date().toISOString(),
        });
        await tx.deleteOnCommit(draftPath(input.artifactId));
      });
    },
    async read(artifactId: string): Promise<ArtifactDocument | undefined> {
      const metadataText = await readOptional(`${basePath(artifactId)}/artifact.json`);
      if (metadataText === undefined) return undefined;
      const metadata = JSON.parse(metadataText) as Omit<ArtifactDocument, 'content'>;
      const content = await readFile(
        path.join(dataRoot.absolutePath, basePath(artifactId), 'content.md'),
        'utf8',
      );
      if (hash(content) !== metadata.contentSha256) throw new Error('storage_corrupted');
      return { ...metadata, content };
    },
  };
}
