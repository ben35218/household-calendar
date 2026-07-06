import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';

// libsodium-wrappers-sumo's ESM build is broken for bundlers (its .mjs imports a
// sibling that ships in a separate package). Resolve to the working CJS entry —
// require.resolve('…') returns the package's `require` condition (the CJS file).
const require = createRequire(import.meta.url);
const libsodiumCjs = require.resolve('libsodium-wrappers-sumo');

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  // @household/crypto ships TypeScript source (no build step); let Vite's normal
  // pipeline transpile it rather than pre-bundling it as a dep.
  optimizeDeps: { exclude: ['@household/crypto'] },
  resolve: { alias: { 'libsodium-wrappers-sumo': libsodiumCjs } },
  server: {
    port: 5173,
    // Allow importing the linked @household/crypto source from the sibling
    // shared/ directory (outside the client root).
    fs: { allow: ['..', '../shared'] },
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
