// npm run build        -> dist/: the folder build, for shipping (itch.io, a website)
// npm run build:single -> dist-single/index.html: one file with everything
//                         inlined, which every check opens from disk
// Vitest reads the test block; Playwright has its own config.
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  // Relative paths, so the build works from any folder, itch.io included.
  base: './',
  // Assets are imported in the code (new URL('../assets/x.png', import.meta.url)),
  // so Vite hashes them and the single file inlines them.
  // public/ holds the app's install files (manifest, icons, service worker): the folder build copies
  // them; the single file, opened from disk by the checks, has no use for them.
  publicDir: mode === 'single' ? false : 'public',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  // The game's page only: other pages in the project (one-shots in prototypes/)
  // are not scanned for packages.
  optimizeDeps: { entries: ['index.html'] },
  // Online play in development: the dev page talks to `npm run server` (port 8787) through /ws.
  server: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    emptyOutDir: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
}));
