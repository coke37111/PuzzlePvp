import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@puzzle-pvp/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
