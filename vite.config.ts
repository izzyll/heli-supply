import { defineConfig } from 'vite';
export default defineConfig({
  base: './', // relative asset paths: works from any folder or subpath (GitHub Pages, itch.io, etc.)
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
