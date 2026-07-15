import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readWorkspaceActivationStatus,
  requestWorkspaceActivation,
} from './workspace-activation.js';

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-more-launcher-activation-'));
  roots.push(root);
  return {
    requestPath: path.join(root, 'request.json'),
    statusPath: path.join(root, 'status.json'),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Launcher workspace activation protocol', () => {
  it('returns rebuilding identity only after Host accepts the matching request', async () => {
    const input = await fixture();
    let published = false;

    await expect(
      requestWorkspaceActivation({
        ...input,
        wait: async () => {
          if (published) return;
          published = true;
          const request = JSON.parse(await readFile(input.requestPath, 'utf8')) as {
            requestId: string;
          };
          await writeFile(
            input.statusPath,
            `${JSON.stringify({
              schemaVersion: 2,
              requestId: request.requestId,
              phase: 'building',
              sourceBuildId: 'build-new',
              activeBuildId: 'build-old',
              targetBuildId: 'build-new',
              attempt: 1,
              startedAt: '2026-07-16T00:00:00.000Z',
              updatedAt: '2026-07-16T00:00:01.000Z',
            })}\n`,
            'utf8',
          );
        },
      }),
    ).resolves.toMatchObject({
      mode: 'activate',
      targetBuildId: 'build-new',
      activation: { phase: 'building', requestId: expect.any(String) },
    });
  });

  it('repairs Host once when it never acknowledges the request', async () => {
    const input = await fixture();
    let now = 0;
    const repairHost = vi.fn(async () => {
      const request = JSON.parse(await readFile(input.requestPath, 'utf8')) as {
        requestId: string;
      };
      await writeFile(
        input.statusPath,
        `${JSON.stringify({
          schemaVersion: 2,
          requestId: request.requestId,
          phase: 'verifying',
          sourceBuildId: 'build-new',
          activeBuildId: 'build-old',
          attempt: 1,
          startedAt: '2026-07-16T00:00:00.000Z',
          updatedAt: '2026-07-16T00:00:06.000Z',
        })}\n`,
        'utf8',
      );
    });

    await requestWorkspaceActivation({
      ...input,
      repairHost,
      now: () => now,
      wait: async () => {
        now += 2_600;
      },
    });

    expect(repairHost).toHaveBeenCalledOnce();
  });

  it('restores a terminal failure from the durable Host status', async () => {
    const input = await fixture();
    await writeFile(
      input.statusPath,
      `${JSON.stringify({
        schemaVersion: 2,
        requestId: 'request-01',
        phase: 'failed',
        sourceBuildId: 'build-new',
        activeBuildId: 'build-old',
        targetBuildId: 'build-new',
        attempt: 2,
        errorCode: 'candidate_build_failed',
        errorStage: 'building',
        startedAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:02:00.000Z',
        completedAt: '2026-07-16T00:02:00.000Z',
      })}\n`,
      'utf8',
    );

    await expect(readWorkspaceActivationStatus(input)).resolves.toMatchObject({
      phase: 'failed',
      activeBuildId: 'build-old',
      errorCode: 'candidate_build_failed',
    });
  });

  it('does not project undeclared diagnostic fields from a tampered status file', async () => {
    const input = await fixture();
    await writeFile(
      input.statusPath,
      `${JSON.stringify({
        schemaVersion: 2,
        requestId: 'request-01',
        phase: 'failed',
        attempt: 2,
        errorCode: 'candidate_build_failed',
        errorStage: 'building',
        startedAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:02:00.000Z',
        completedAt: '2026-07-16T00:02:00.000Z',
        stack: 'D:\\private\\workspace',
      })}\n`,
      'utf8',
    );

    await expect(readWorkspaceActivationStatus(input)).resolves.toBeUndefined();
  });
});
