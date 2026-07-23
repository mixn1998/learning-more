import { describe, expect, it } from 'vitest';

import { createBuildMetaAsset, createBuildMetaResponse } from './vite.config.js';

describe('web build identity asset', () => {
  it('emits the public build and protocol identity at a stable path', () => {
    expect(createBuildMetaAsset('build_01')).toEqual({
      type: 'asset',
      fileName: 'build-meta.json',
      source: '{"schemaVersion":1,"buildId":"build_01","protocolVersion":"1"}\n',
    });
  });

  it('serves the same identity at the stable path in development', () => {
    expect(createBuildMetaResponse('/build-meta.json?operation=1', 'stale-web-build')).toBe(
      '{"schemaVersion":1,"buildId":"stale-web-build","protocolVersion":"1"}\n',
    );
    expect(createBuildMetaResponse('/runtime', 'stale-web-build')).toBeUndefined();
  });
});
