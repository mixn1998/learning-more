import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildPortableRelease } from './build-portable.js';
import { readSourceIdentity, writeWorkspaceBuildManifest } from './source-identity.js';

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function runWorkspaceBridge(arguments_: readonly string[]): Promise<void> {
  const [command, projectRoot, ...rest] = arguments_;
  if (projectRoot === undefined || !path.isAbsolute(projectRoot)) {
    throw new Error('workspace_bridge_project_root_invalid');
  }

  if (command === 'read-identity') {
    const [resultPath] = rest;
    if (resultPath === undefined || !path.isAbsolute(resultPath)) {
      throw new Error('workspace_bridge_result_path_invalid');
    }
    await writeJson(resultPath, await readSourceIdentity(projectRoot));
    return;
  }

  if (command === 'build-candidate') {
    const [outputRoot, workRoot, resultPath] = rest;
    if (
      outputRoot === undefined ||
      workRoot === undefined ||
      resultPath === undefined ||
      !path.isAbsolute(outputRoot) ||
      !path.isAbsolute(workRoot) ||
      !path.isAbsolute(resultPath)
    ) {
      throw new Error('workspace_bridge_candidate_paths_invalid');
    }
    const result = await buildPortableRelease(projectRoot, {
      outputRoot,
      workRoot,
      writeWorkspaceManifest: false,
    });
    await writeJson(resultPath, result);
    return;
  }

  if (command === 'commit-manifest') {
    const [buildId] = rest;
    if (buildId === undefined || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(buildId)) {
      throw new Error('workspace_bridge_build_id_invalid');
    }
    const identity = await readSourceIdentity(projectRoot);
    if (identity.buildId !== buildId) throw new Error('workspace_changed_before_commit');
    await writeWorkspaceBuildManifest(projectRoot, identity, buildId);
    return;
  }

  throw new Error('workspace_bridge_command_invalid');
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  await runWorkspaceBridge(process.argv.slice(2));
}
