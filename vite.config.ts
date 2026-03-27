import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, 'src/app'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@ipc': path.resolve(__dirname, 'ipc')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/app/tests/setup.ts']
  }
});
