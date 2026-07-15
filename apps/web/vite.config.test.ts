import { describe, expect, it } from 'vitest';

import { createBuildMetaAsset } from './vite.config.js';

describe('web build identity asset', () => {
  it('emits the public build and protocol identity at a stable path', () => {
    expect(createBuildMetaAsset('build_01')).toEqual({
      type: 'asset',
      fileName: 'build-meta.json',
      source: '{"schemaVersion":1,"buildId":"build_01","protocolVersion":"1"}\n',
    });
  });
});
