import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { offline } from './tools/vite-plugin-offline.ts';
import { saveEndpoint } from './tools/vite-plugin-save.ts';

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [offline(), saveEndpoint()],
  // The build time, which the dev key B prints (the original's `__TIME__`)
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@game': fileURLToPath(new URL('./src/game', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // The online save's Firebase, loaded on sign-in only: the service worker keeps it when
        // first fetched, not at install (`tools/vite-plugin-offline.ts`)
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => /node_modules[\\/]@?firebase[\\/]/.test(id))
            ? 'assets/firebase-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
