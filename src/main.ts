import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { handleHotUpdate, routes } from 'vue-router/auto-routes'
import App from './App.vue'
import { useAuth } from './lib/auth'
import './styles/main.scss'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

if (import.meta.hot) {
  handleHotUpdate(router)
}

/**
 * Convenience, not security — it only stops the UI flashing content before the
 * server refuses it. Every /api route rejects an unauthenticated request on its
 * own, and that is what actually protects the data.
 */
router.beforeEach(async to => {
  const { status, loadSession } = useAuth()
  const current = status.value === 'unknown' ? await loadSession() : status.value

  if (current === 'out' && to.path !== '/login') return '/login'
  if (current === 'in' && to.path === '/login') return '/'
  return true
})

createApp(App).use(router).mount('#app')
