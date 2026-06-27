import { ref, computed, watch } from 'vue';
import { subYears, addYears } from 'date-fns';
import { categoriesApi, tasksApi, itemsApi } from '../services/api';

// Module-level singletons — state persists across route navigation
const timeFilter      = ref('');
const categories      = ref([]);
const categoryFilter  = ref([]);
const items           = ref([]);
const itemFilter      = ref([]);
const showPaused      = ref(false);
const showCompleted   = ref(false);
const filterLoading   = ref(false);
const pausedTasks     = ref([]);
const rawCompletions  = ref([]);

const activeFilterCount = computed(() =>
  (timeFilter.value ? 1 : 0) +
  (categoryFilter.value.length ? 1 : 0) +
  (itemFilter.value.length ? 1 : 0) +
  (showPaused.value ? 1 : 0) +
  (showCompleted.value ? 1 : 0)
);

function toggleCategory(id) {
  const idx = categoryFilter.value.indexOf(id);
  if (idx === -1) categoryFilter.value.push(id);
  else categoryFilter.value.splice(idx, 1);
}

function toggleItem(id) {
  const idx = itemFilter.value.indexOf(id);
  if (idx === -1) itemFilter.value.push(id);
  else itemFilter.value.splice(idx, 1);
}

function clearFilters() {
  timeFilter.value     = '';
  categoryFilter.value = [];
  itemFilter.value     = [];
  showPaused.value     = false;
  showCompleted.value  = false;
}

async function loadPausedTasks() {
  if (!showPaused.value) { pausedTasks.value = []; return; }
  filterLoading.value = true;
  try {
    const { data } = await tasksApi.list();
    pausedTasks.value = data.filter(t => t.active === false);
  } finally {
    filterLoading.value = false;
  }
}

async function loadCompletions() {
  if (!showCompleted.value) { rawCompletions.value = []; return; }
  filterLoading.value = true;
  try {
    const now = new Date();
    const { data } = await tasksApi.completions({
      from: subYears(now, 5).toISOString(),
      to:   addYears(now, 5).toISOString(),
    });
    rawCompletions.value = data;
  } finally {
    filterLoading.value = false;
  }
}

// Module-level watches — live for the app's lifetime alongside the shared state
watch(showPaused,    loadPausedTasks);
watch(showCompleted, loadCompletions);

export function useCalendarFilters() {
  // filterMenuOpen is intentionally per-instance: menu open/close state
  // should not persist across navigation or be shared between views.
  const filterMenuOpen = ref(false);

  async function loadFilterData() {
    const [catRes, itemRes] = await Promise.all([categoriesApi.list(), itemsApi.list()]);
    categories.value = catRes.data;
    items.value      = itemRes.data;
  }

  return {
    filterMenuOpen,
    timeFilter, categories, categoryFilter,
    items, itemFilter, showPaused, showCompleted, filterLoading,
    pausedTasks, rawCompletions, activeFilterCount,
    toggleCategory, toggleItem, clearFilters, loadFilterData,
  };
}
