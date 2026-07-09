import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5177,
    proxy: {
      '/api': { target: 'http://localhost:8899', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8899', ws: true },
    },
  },
})
