import { describe, expect, it } from 'vitest';

import {
  buildHostManagementCommand,
  buildPortableStartCommand,
  cleanupPortableWorkRoot,
  portableWebBuildSettings,
  resolvePortableBuildPaths,
} from './build-portable.js';

describe('portable Windows entry commands', () => {
  it('repairs the Host, waits for readiness, and opens the homepage exactly once', () => {
    const start = buildPortableStartCommand();

    expect(start).toContain(' repair --project-root ');
    const encoded = start.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/u)?.[1];
    expect(encoded).toBeDefined();
    const script = Buffer.from(encoded!, 'base64').toString('utf16le');
    expect(script).toContain('http://127.0.0.1:43119/api/v1/runtime/ready');
    expect(script).toContain('http://127.0.0.1:43119/build-meta.json');
    expect(script).toContain("$ready.status -eq 'ready'");
    expect(script).toContain('$web.buildId -eq $ready.buildId');
    expect(script.match(/Start-Process/gu)).toHaveLength(1);
    expect(script).toContain("Start-Process 'http://127.0.0.1:43119/'");
  });

  it('keeps all Host maintenance entries headless', () => {
    for (const command of ['install', 'repair', 'uninstall'] as const) {
      const maintenance = buildHostManagementCommand(command);
      expect(maintenance).not.toContain('EncodedCommand');
      expect(maintenance).not.toContain('127.0.0.1:43119');
      expect(maintenance).not.toContain('Start-Process');
    }
  });

  it('keeps an activation candidate inside its request-scoped roots', () => {
    expect(
      resolvePortableBuildPaths('D:\\workspace\\Learning MORE', {
        outputRoot: 'D:\\runtime\\requests\\request_01\\attempt_1\\output',
        workRoot: 'D:\\runtime\\requests\\request_01\\attempt_1\\work',
      }),
    ).toEqual({
      outputRoot: 'D:\\runtime\\requests\\request_01\\attempt_1\\output',
      workRoot: 'D:\\runtime\\requests\\request_01\\attempt_1\\work',
      expandedRoot: 'D:\\runtime\\requests\\request_01\\attempt_1\\output\\portable\\Learning MORE',
    });
  });

  it('builds frontend identity inside the isolated activation work root', () => {
    expect(
      portableWebBuildSettings('build-new', 'D:\\runtime\\requests\\request_01\\attempt_1\\work'),
    ).toEqual({
      buildId: 'build-new',
      outputRoot: 'D:\\runtime\\requests\\request_01\\attempt_1\\work\\web-dist',
      environment: expect.objectContaining({
        VITE_BUILD_ID: 'build-new',
        VITE_OUT_DIR: 'D:\\runtime\\requests\\request_01\\attempt_1\\work\\web-dist',
      }),
    });
  });

  it('does not discard a completed candidate when disposable work-root cleanup is blocked', async () => {
    const remove = async () => {
      throw Object.assign(new Error('file_in_use'), { code: 'EPERM' });
    };

    await expect(
      cleanupPortableWorkRoot(
        'D:\\runtime\\requests\\request_01\\attempt_1\\work',
        remove as typeof import('node:fs/promises').rm,
      ),
    ).resolves.toBeUndefined();
  });
});
