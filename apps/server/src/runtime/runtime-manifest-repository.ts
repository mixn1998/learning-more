import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { encodeJson } from '../persistence/json-codec.js';
import { RuntimeManifestSchema, type RuntimeManifest } from './runtime-manifest.js';

export interface RuntimeManifestRepository {
  read(): Promise<RuntimeManifest | undefined>;
  write(manifest: RuntimeManifest): Promise<void>;
  remove(owner: { instanceId: string; generation: number }): Promise<boolean>;
}

export function createRuntimeManifestRepository(filePath: string): RuntimeManifestRepository {
  const repository: RuntimeManifestRepository = {
    async read() {
      try {
        return RuntimeManifestSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async write(manifest) {
      const parsed = RuntimeManifestSchema.parse(manifest);
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      const previous = `${filePath}.${randomUUID()}.previous`;
      let movedPrevious = false;
      try {
        await writeFile(temporary, encodeJson(parsed), 'utf8');
        try {
          await rename(filePath, previous);
          movedPrevious = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await rename(temporary, filePath);
        await rm(previous, { force: true });
      } catch (error) {
        if (movedPrevious) await rename(previous, filePath);
        throw error;
      } finally {
        await rm(temporary, { force: true });
        await rm(previous, { force: true });
      }
    },
    async remove(owner) {
      const current = await repository.read();
      if (
        current === undefined ||
        current.instanceId !== owner.instanceId ||
        current.generation !== owner.generation
      ) {
        return false;
      }
      await rm(filePath, { force: true });
      return true;
    },
  };
  return repository;
}
