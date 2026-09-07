import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const runtimeProcess = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process;

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this repository below /radiance-live-show/ while
  // local development and preview continue to use the root path.
  base: runtimeProcess?.env?.GITHUB_ACTIONS ? '/radiance-live-show/' : '/',
  server: { host: '0.0.0.0', port: 4180 },
  preview: { host: '0.0.0.0', port: 4180 },
  worker: { format: 'es' },
});
