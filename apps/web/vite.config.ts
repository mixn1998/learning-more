import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

export function createBuildMetaAsset(buildId: string) {
  return {
    type: 'asset' as const,
    fileName: 'build-meta.json',
    source: `${JSON.stringify({
      schemaVersion: 1,
      buildId,
      protocolVersion: '1',
    })}\n`,
  };
}

function buildMetaPlugin(buildId: string): Plugin {
  return {
    name: 'learning-more-build-meta',
    generateBundle() {
      this.emitFile(createBuildMetaAsset(buildId));
    },
  };
}

export default defineConfig(({ mode }) => {
  const visualMode = mode === 'visual';
  const e2eWebPort = Number(process.env.LEARNING_MORE_E2E_WEB_PORT ?? 5_173);
  const e2eServerPort = Number(process.env.LEARNING_MORE_E2E_SERVER_PORT ?? 43_120);
  const buildId = process.env.VITE_BUILD_ID ?? 'development';

  return {
    plugins: [react(), buildMetaPlugin(buildId)],
    server: {
      host: '127.0.0.1',
      port: visualMode ? 61_587 : e2eWebPort,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${e2eServerPort}`,
        },
      },
      strictPort: true,
    },
  };
});
