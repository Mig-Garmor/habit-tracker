import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueRouter from 'vue-router/vite'

// VueRouter() must come before vue() — it transforms `definePage()` in SFCs.
export default defineConfig({
  plugins: [
    VueRouter({
      // Every .vue file under src/pages becomes a route. Types land in typed-router.d.ts.
      routesFolder: 'src/pages',
    }),
    vue(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // The Vue app talks to /api; the Hono server on 5174 owns SQLite.
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
})
