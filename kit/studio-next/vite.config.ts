/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The legacy desk runs on 127.0.0.1:4747. Dev mode proxies the whole server
 * surface there so `studio-next` never needs its own backend, and the legacy
 * app keeps serving unchanged on its own origin.
 */
const STUDIO_ORIGIN = process.env.STUDIO_ORIGIN ?? 'http://127.0.0.1:4747';
const PROXIED = ['/api', '/media', '/version-media', '/logo.svg', '/icons.svg'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 4748,
    strictPort: true,
    host: '127.0.0.1',
    proxy: Object.fromEntries(
      PROXIED.map((path) => [path, { target: STUDIO_ORIGIN, changeOrigin: false }]),
    ),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: true,
    reportCompressedSize: false,
    // Every region renders at boot (as in the legacy desk), so a split chunk would load
    // on the first frame anyway; the app chunk is ~230 kB gzipped.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        /**
         * Keep the vendor runtime out of the app chunk so a UI change does not
         * bust the React cache entry on every deploy.
         *
         * Matched on the resolved path rather than by package name: React 19's
         * JSX runtime and `react-dom/client` are separate entry points, and an
         * id-list match leaves them behind in the app chunk.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'server/*.mjs'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'server/**/*.test.mjs',
        'src/test/**',
        'src/main.tsx',
        'src/**/index.ts',
        'src/**/*.d.ts',
      ],
      thresholds: { statements: 70, branches: 70, functions: 70, lines: 70 },
    },
    /**
     * Two environments: the desk runs in jsdom with the DOM stubs, the little
     * static server runs in node. One setup file cannot serve both, so they are
     * separate projects rather than a glob of environment overrides.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          css: true,
          restoreMocks: true,
          clearMocks: true,
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          globals: true,
          environment: 'node',
          include: ['server/**/*.test.mjs'],
        },
      },
    ],
  },
});
