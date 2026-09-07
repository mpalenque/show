// Vite build configuration for Moon Phases Simulator by Gustavo Adrián Salvini <guspatagonico@gmail.com>
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the same build works from the dev server and from
  // /particlesvideo/moon-simulator/ on GitHub Pages.
  base: './',
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    include: ['three', 'lil-gui'],
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['galadriel'],
  },
});
