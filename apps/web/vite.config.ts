import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const visualMode = mode === 'visual';
  const e2eWebPort = Number(process.env.LEARNING_MORE_E2E_WEB_PORT ?? 5_173);
  const e2eServerPort = Number(process.env.LEARNING_MORE_E2E_SERVER_PORT ?? 43_120);

  return {
    plugins: [react()],
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
