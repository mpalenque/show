import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  esbuild: { jsx: 'automatic' },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        editor: 'editor.html',
        fluids: 'fluids.html',
      },
    },
  },
});
