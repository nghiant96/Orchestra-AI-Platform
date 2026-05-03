/// <reference types="vitest" />
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(process.cwd(), '..');
  const repoEnv = loadEnv(mode, repoRoot, '');
  const dashboardEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const authToken = dashboardEnv.VITE_AI_SYSTEM_SERVER_TOKEN || repoEnv.AI_SYSTEM_SERVER_TOKEN || repoEnv.VITE_AI_SYSTEM_SERVER_TOKEN || process.env.AI_SYSTEM_SERVER_TOKEN || '';

  const proxyTarget = 'http://localhost:3927';
  const proxyHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
  const proxyOptions = {
    target: proxyTarget,
    changeOrigin: true,
    headers: proxyHeaders,
  };

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      port: 5253,
      proxy: {
        '/jobs': proxyOptions,
        '/config': proxyOptions,
        '/logs': { ...proxyOptions, ws: true },
        '/health': proxyOptions,
        '/stats': proxyOptions,
        '/audit': proxyOptions,
        '/lessons': proxyOptions,
        '/queue': proxyOptions,
        '/work-items': proxyOptions,
        '/projects': proxyOptions,
        '/run': proxyOptions,
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
})
