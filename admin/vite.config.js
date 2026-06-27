import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';

// Admin app runs on a separate port (5174) from the consumer client (5173).
// In dev it proxies /api to the same backend; in production VITE_API_BASE_URL
// points at the deployed API (which must allowlist this app's origin via
// CORS_ORIGINS on the server).
export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
