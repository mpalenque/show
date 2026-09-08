import { defineConfig } from 'vite';
import { parte2MediaPlugin } from './tools/parte2-media-service.mjs';

export default defineConfig({
  base: './',
  plugins: [parte2MediaPlugin()],
  server: { port: 5173 },
  esbuild: { jsx: 'automatic' },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        editor: 'editor.html',
        fluids: 'fluids.html',
        parte2: 'parte2.html',
      },
    },
  },
});
