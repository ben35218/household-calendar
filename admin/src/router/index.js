import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/', redirect: '/monetization' },
  { path: '/insights', name: 'Insights', component: () => import('../views/InsightsView.vue') },
  { path: '/monetization', name: 'Monetization', component: () => import('../views/MonetizationConfigView.vue') },
  { path: '/households', name: 'Households', component: () => import('../views/HouseholdsView.vue') },
  { path: '/billing', name: 'Billing', component: () => import('../views/BillingView.vue') },
  { path: '/users', name: 'Users', component: () => import('../views/UsersView.vue') },
  { path: '/e2ee', name: 'E2EE', component: () => import('../views/E2eeOpsView.vue') },
  { path: '/audit', name: 'Audit', component: () => import('../views/AuditLogView.vue') },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isLoggedIn) {
    return { name: 'Login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'Login' && auth.isLoggedIn) return { path: '/' };
  return true;
});

export default router;
