import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  controlStatus,
  removeRuntimeRoot,
  runtimeManifest,
  startLauncher,
  startStandaloneServer,
  stopLauncher,
  stopStandaloneServer,
  waitFor,
} from './runtime-harness.js';

const temporary = path.join(process.cwd(), 'tests', '.tmp');

test('heals a crashed server and adopts a verified server after Launcher restart', async () => {
  const root = path.join(temporary, 'runtime-self-heal');
  await removeRuntimeRoot(root);
  let launcher = await startLauncher(root);
  let standalone: Awaited<ReturnType<typeof startStandaloneServer>> | undefined;
  try {
    const first = await waitFor(async () => {
      const manifest = await runtimeManifest(launcher).catch(() => undefined);
      const status = await controlStatus();
      return manifest !== undefined && status?.state === 'healthy' ? manifest : undefined;
    });
    process.kill(first.pid, 'SIGKILL');
    await waitFor(async () => {
      const manifest = await runtimeManifest(launcher).catch(() => undefined);
      const status = await controlStatus();
      return manifest !== undefined &&
        manifest.generation > first.generation &&
        status?.state === 'healthy'
        ? manifest
        : undefined;
    });
    await stopLauncher(launcher);
    standalone = await startStandaloneServer(root);
    const standaloneManifest = JSON.parse(
      await readFile(path.join(standalone.runtimeDirectory, 'runtime-manifest.json'), 'utf8'),
    ) as { generation: number };
    launcher = await startLauncher(root);
    await expect.poll(async () => (await controlStatus())?.state).toBe('healthy');
    expect((await runtimeManifest(launcher)).generation).toBe(standaloneManifest.generation);
    await stopLauncher(launcher);
    await expect.poll(() => standalone.process.exitCode).not.toBeNull();
  } finally {
    await stopLauncher(launcher).catch(() => undefined);
    if (standalone !== undefined) await stopStandaloneServer(standalone).catch(() => undefined);
    await removeRuntimeRoot(root);
  }
  await expect
    .poll(async () =>
      fetch('http://127.0.0.1:43120')
        .then(() => false)
        .catch(() => true),
    )
    .toBe(true);
});

test('blocks a foreign 43120 owner and never terminates it', async () => {
  const root = path.join(temporary, 'runtime-foreign-owner');
  await removeRuntimeRoot(root);
  await mkdir(root, { recursive: true });
  const marker = path.join(root, 'foreign.marker');
  const foreign = spawn(
    process.execPath,
    ['--import', 'tsx', 'tools/test-processes/foreign-port-owner.ts'],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, LEARNING_MORE_FOREIGN_MARKER: marker },
    },
  );
  let launcher: Awaited<ReturnType<typeof startLauncher>> | undefined;
  try {
    await waitFor(() => readFile(marker, 'utf8').catch(() => undefined));
    launcher = await startLauncher(root);
    await expect.poll(async () => (await controlStatus())?.state).toBe('blocked_external_port');
    expect(() => process.kill(foreign.pid!, 0)).not.toThrow();
    expect(await fetch('http://127.0.0.1:43120').then((response) => response.text())).toBe(
      'foreign-owner',
    );
  } finally {
    if (launcher !== undefined) await stopLauncher(launcher).catch(() => undefined);
    if (foreign.exitCode === null) {
      const exited = once(foreign, 'exit');
      foreign.kill();
      await exited;
    }
    await removeRuntimeRoot(root);
  }
});

test('blocks tampered identity fields without killing the still-running server', async () => {
  const mutations = [
    ['instanceId', 'instance_tampered'],
    ['projectRoot', 'D:\\tampered-project-root'],
    ['dataRootHash', 'b'.repeat(64)],
  ] as const;
  for (const [field, value] of mutations) {
    const root = path.join(temporary, `runtime-wrong-${field}`);
    await removeRuntimeRoot(root);
    const standalone = await startStandaloneServer(root);
    let launcher: Awaited<ReturnType<typeof startLauncher>> | undefined;
    try {
      const manifest = JSON.parse(
        await readFile(path.join(standalone.runtimeDirectory, 'runtime-manifest.json'), 'utf8'),
      ) as Record<string, unknown> & { pid: number };
      await writeFile(
        path.join(standalone.runtimeDirectory, 'runtime-manifest.json'),
        `${JSON.stringify({ ...manifest, [field]: value })}\n`,
        'utf8',
      );
      launcher = await startLauncher(root);
      await expect
        .poll(async () => (await controlStatus())?.state)
        .toBe('blocked_identity_mismatch');
      expect(() => process.kill(manifest.pid, 0)).not.toThrow();
    } finally {
      if (launcher !== undefined) await stopLauncher(launcher).catch(() => undefined);
      await stopStandaloneServer(standalone).catch(() => undefined);
      await removeRuntimeRoot(root);
    }
  }
});
