import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/jobs': 'http://localhost:3927',
      '/health': 'http://localhost:3927',
      '/run': 'http://localhost:3927',
    }
  }
})
