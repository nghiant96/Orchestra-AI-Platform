import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/jobs': {
        target: 'http://localhost:3927',
        changeOrigin: true,
      },
      '/config': {
        target: 'http://localhost:3927',
        changeOrigin: true,
      },
      '/logs': {
        target: 'http://localhost:3927',
        changeOrigin: true,
        ws: true,
      },
      '/health': {
        target: 'http://localhost:3927',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
