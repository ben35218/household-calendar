import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/register', name: 'Register', component: () => import('../views/RegisterView.vue'), meta: { public: true } },
  { path: '/', redirect: '/calendar' },
  { path: '/maintenance', name: 'MaintenanceDashboard', component: () => import('../views/DashboardView.vue'), meta: { hideDrawerFab: true, backTo: '/calendar' } },
  { path: '/items/new', name: 'NewItem', component: () => import('../views/ItemFormView.vue'), meta: { hideDrawerFab: true, parent: '/maintenance' } },
  { path: '/items/:id', name: 'ItemDetail', component: () => import('../views/ItemDetailView.vue'), meta: { hideDrawerFab: true, parent: '/maintenance' } },
  { path: '/items/:id/edit', name: 'EditItem', component: () => import('../views/ItemFormView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/items/${r.params.id}` } },
  { path: '/items/:id/chat', name: 'MaintenanceChat', component: () => import('../views/MaintenanceChatView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/items/${r.params.id}` } },
  { path: '/events', name: 'Events', component: () => import('../views/EventsView.vue') },
  { path: '/tasks/new', redirect: { path: '/calendar/event/new', query: { tab: 'task' } } },
  { path: '/categories', name: 'Categories', component: () => import('../views/CategoriesView.vue'), meta: { hideDrawerFab: true, parent: '/maintenance' } },
  { path: '/tasks/templates', name: 'TaskTemplates', component: () => import('../views/TaskTemplatesView.vue'), meta: { hideDrawerFab: true, parent: '/maintenance' } },
  { path: '/tasks/:id', name: 'TaskDetail', component: () => import('../views/TaskDetailView.vue'), meta: { hideDrawerFab: true, parent: '/maintenance' } },
  { path: '/tasks/:id/edit', name: 'EditTask', component: () => import('../views/TaskFormView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/tasks/${r.params.id}` } },
  { path: '/chores', name: 'ChoresDashboard', component: () => import('../views/ChoresDashboardView.vue'), meta: { hideDrawerFab: true, backTo: '/calendar' } },
  { path: '/chores/new', redirect: { path: '/calendar/event/new', query: { tab: 'chore' } } },
  { path: '/chores/templates', name: 'ChoreTemplates', component: () => import('../views/ChoreTemplatesView.vue'), meta: { hideDrawerFab: true, parent: '/chores' } },
  { path: '/chores/:id', name: 'ChoreDetail', component: () => import('../views/ChoreDetailView.vue'), meta: { hideDrawerFab: true, parent: '/chores' } },
  { path: '/chores/:id/edit', name: 'EditChore', component: () => import('../views/ChoreFormView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/chores/${r.params.id}` } },
  { path: '/calendar', name: 'Calendar', component: () => import('../views/CalendarView.vue') },
  { path: '/calendars', name: 'Calendars', component: () => import('../views/CalendarsView.vue'), meta: { hideDrawerFab: true, parent: '/calendar' } },
  { path: '/calendar/assistant', name: 'CalendarAssistant', component: () => import('../views/CalendarAssistantView.vue'), meta: { hideDrawerFab: true, parent: '/calendar' } },
  { path: '/calendar/day/:date', name: 'CalendarDay', component: () => import('../views/CalendarDayView.vue'), meta: { hideDrawerFab: true, parent: '/calendar' } },
  { path: '/calendar/event/new', name: 'NewEvent', component: () => import('../views/EventFormView.vue'), meta: { hideDrawerFab: true, parent: '/calendar' } },
  { path: '/calendar/event/:eventId', name: 'EventDetail', component: () => import('../views/EventDetailView.vue'), meta: { hideDrawerFab: true, parent: '/calendar' } },
  { path: '/calendar/event/:eventId/edit', name: 'EditEvent', component: () => import('../views/EventFormView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/calendar/event/${r.params.eventId}` } },

  { path: '/holidays', name: 'Holidays', component: () => import('../views/HolidaysView.vue'), meta: { hideDrawerFab: true, backTo: '/calendar' } },
  { path: '/weather', name: 'Weather', component: () => import('../views/WeatherView.vue'), meta: { hideDrawerFab: true, backTo: '/calendar' } },
  { path: '/profile', name: 'profile', component: () => import('../views/ProfileMenu.vue'), meta: { hideDrawerFab: true, parent: '/calendar' } },
  { path: '/profile/account',       name: 'profile-account',       component: () => import('../views/profile/AccountSection.vue'),       meta: { hideDrawerFab: true, parent: '/profile' } },
  { path: '/profile/people',        name: 'profile-people',        component: () => import('../views/PeopleView.vue'),                   meta: { hideDrawerFab: true, parent: '/profile' } },
  { path: '/profile/about',         redirect: '/profile/people' },
  { path: '/profile/household',     name: 'profile-household',      component: () => import('../views/HouseholdView.vue'),                meta: { hideDrawerFab: true, parent: '/profile' } },
  { path: '/profile/billing',       name: 'profile-billing',        component: () => import('../views/BillingView.vue'),                  meta: { hideDrawerFab: true, parent: '/profile' } },
  // TEMP: unauthenticated monetization admin page (standalone = reachable while
  // logged in or out; moves to a separate admin app before go-live).
  { path: '/monetization-config', name: 'MonetizationConfig', component: () => import('../views/MonetizationConfigView.vue'), meta: { public: true, standalone: true } },
  // Old paths → new /profile sections (keep bookmarks/links working).
  { path: '/settings',  redirect: '/profile' },
  { path: '/people',    redirect: '/profile/people' },
  { path: '/household', redirect: '/profile/household' },

  { path: '/recipes', name: 'Recipes', component: () => import('../views/RecipesView.vue'), meta: { hideDrawerFab: true, parent: '/meal-planner' } },
  { path: '/recipes/new', name: 'NewRecipe', component: () => import('../views/RecipeFormView.vue'), meta: { hideDrawerFab: true, parent: '/recipes' } },
  { path: '/recipes/:id', name: 'RecipeDetail', component: () => import('../views/RecipeDetailView.vue'), meta: { hideDrawerFab: true, parent: '/recipes' } },
  { path: '/recipes/:id/edit', name: 'EditRecipe', component: () => import('../views/RecipeFormView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/recipes/${r.params.id}` } },
  { path: '/meal-planner', name: 'MealPlanner', component: () => import('../views/MealPlannerView.vue'), meta: { hideDrawerFab: true, backTo: '/calendar' } },
  { path: '/meal-planner/settings', name: 'MealPlannerSettings', component: () => import('../views/MealPlannerSettingsView.vue'), meta: { hideDrawerFab: true, parent: '/meal-planner' } },
  { path: '/food', name: 'Inventory', component: () => import('../views/InventoryView.vue'), meta: { hideDrawerFab: true, parent: '/meal-planner' } },
  { path: '/find-recipes', name: 'FindRecipes', component: () => import('../views/FindRecipesView.vue'), meta: { hideDrawerFab: true, parent: '/food' } },

  { path: '/vacations', name: 'Vacations', component: () => import('../views/VacationsView.vue'), meta: { hideDrawerFab: true, backTo: '/calendar' } },
  { path: '/vacations/new', name: 'NewTrip', component: () => import('../views/TripFormView.vue'), meta: { hideDrawerFab: true, parent: '/vacations' } },
  { path: '/vacations/:id/assistant', name: 'VacationAssistant', component: () => import('../views/VacationAssistantView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/vacations/${r.params.id}` } },
  { path: '/vacations/:id', name: 'TripDetail', component: () => import('../views/TripDetailView.vue'), meta: { hideDrawerFab: true, parent: '/vacations' } },
  { path: '/vacations/:id/edit', name: 'EditTrip', component: () => import('../views/TripFormView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/vacations/${r.params.id}` } },
  { path: '/vacations/:id/settle', name: 'TripSettle', component: () => import('../views/TripSettleView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/vacations/${r.params.id}` } },
  { path: '/vacations/:id/items/new', name: 'NewTripItem', component: () => import('../views/TripItemFormView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/vacations/${r.params.id}` } },
  { path: '/vacations/:id/items/:itemId/edit', name: 'EditTripItem', component: () => import('../views/TripItemFormView.vue'), meta: { hideDrawerFab: true, parent: (r) => `/vacations/${r.params.id}` } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (to, from, savedPosition) => {
    if (to.name === 'Calendar') return false;
    return savedPosition ?? { top: 0 };
  },
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isLoggedIn) {
    return { name: 'Login', query: { redirect: to.fullPath } };
  }
  // Standalone public pages (e.g. the temp admin config) stay reachable while
  // logged in; only auth pages (login/register) redirect away.
  if (to.meta.public && !to.meta.standalone && auth.isLoggedIn) {
    return { name: 'Calendar' };
  }
});

export default router;
