import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const visualMode = mode === 'visual';

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: visualMode ? 61_587 : 5_173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:43120',
        },
      },
      strictPort: true,
    },
  };
});
