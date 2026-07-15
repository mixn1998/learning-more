import { describe, expect, it } from 'vitest';

import { buildHostManagementCommand, buildPortableStartCommand } from './build-portable.js';

describe('portable Windows entry commands', () => {
  it('repairs the Host, waits for readiness, and opens the homepage exactly once', () => {
    const start = buildPortableStartCommand();

    expect(start).toContain(' repair --project-root ');
    const encoded = start.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/u)?.[1];
    expect(encoded).toBeDefined();
    const script = Buffer.from(encoded!, 'base64').toString('utf16le');
    expect(script).toContain('http://127.0.0.1:43119/api/v1/runtime/ready');
    expect(script).toContain("$ready.status -eq 'ready'");
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
});
