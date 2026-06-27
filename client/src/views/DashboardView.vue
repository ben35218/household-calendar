<template>
  <v-container class="py-6">

    <div class="d-flex align-center mb-4">
      <BackButton />
      <h1 class="text-h4 font-weight-bold ml-2">Maintenance</h1>
      <v-btn
        icon="mdi-cog"
        variant="text"
        size="small"
        class="ml-1"
        title="Manage categories"
        @click="router.push('/categories')"
      />
      <v-spacer />
      <v-btn
        icon="mdi-plus"
        color="#1976D2"
        variant="flat"
        size="small"
        title="Add item"
        @click="router.push('/items/new')"
      />
    </div>

    <!-- Compact status summary -->
    <v-card rounded="lg" class="mb-6" elevation="1">
      <v-card-text class="pa-4">
        <div class="d-flex align-center justify-space-around">
          <div class="d-flex flex-column align-center status-segment" role="button" @click="openStatus('overdue')">
            <div class="d-flex align-center ga-1">
              <v-icon size="10" color="error">mdi-circle</v-icon>
              <span class="text-h5 font-weight-bold">{{ counts.overdue }}</span>
            </div>
            <div class="text-caption text-medium-emphasis">overdue</div>
          </div>
          <v-divider vertical class="mx-2" />
          <div class="d-flex flex-column align-center status-segment" role="button" @click="openStatus('due-soon')">
            <div class="d-flex align-center ga-1">
              <v-icon size="10" color="warning">mdi-circle</v-icon>
              <span class="text-h5 font-weight-bold">{{ counts.dueSoon }}</span>
            </div>
            <div class="text-caption text-medium-emphasis">due soon</div>
          </div>
          <v-divider vertical class="mx-2" />
          <div class="d-flex flex-column align-center status-segment" role="button" @click="openStatus('upcoming')">
            <div class="d-flex align-center ga-1">
              <v-icon size="10" color="success">mdi-circle</v-icon>
              <span class="text-h5 font-weight-bold">{{ counts.upcoming }}</span>
            </div>
            <div class="text-caption text-medium-emphasis">upcoming</div>
          </div>
          <v-divider vertical class="mx-2" />
          <div class="d-flex flex-column align-center status-segment" role="button" @click="openStatus('paused')">
            <div class="d-flex align-center ga-1">
              <v-icon size="10" color="grey">mdi-circle</v-icon>
              <span class="text-h5 font-weight-bold">{{ counts.paused }}</span>
            </div>
            <div class="text-caption text-medium-emphasis">paused</div>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <template v-if="loading">
      <v-skeleton-loader v-for="n in 3" :key="n" type="list-item-avatar-two-line" class="mb-2 rounded-lg" />
    </template>

    <template v-else>
      <div v-for="group in groupedItems" :key="group.location" class="mb-5">
        <p v-if="showLocations" class="text-overline text-medium-emphasis mb-2 pl-1">{{ group.location }}</p>

        <v-card
          v-for="item in group.items"
          :key="item._id"
          rounded="lg"
          class="mb-2"
          elevation="1"
        >
          <v-list-item :to="`/items/${item._id}`" class="py-3">
            <template #prepend>
              <v-avatar
                :color="TYPE_COLORS[item.type] || 'grey-darken-2'"
                size="44"
                rounded="lg"
                class="mr-2"
              >
                <v-icon
                  :icon="TYPE_ICONS[item.type] || 'mdi-package-variant'"
                  color="white"
                  size="22"
                />
              </v-avatar>
            </template>
            <v-list-item-title class="font-weight-medium mb-1">{{ item.name }}</v-list-item-title>
            <v-list-item-subtitle>
              <span v-if="itemCounts(item._id).overdue" class="text-error text-caption font-weight-medium mr-3">
                {{ itemCounts(item._id).overdue }} overdue
              </span>
              <span v-if="itemCounts(item._id).dueSoon" class="text-warning text-caption font-weight-medium mr-3">
                {{ itemCounts(item._id).dueSoon }} due soon
              </span>
              <span v-if="itemCounts(item._id).upcoming" class="text-success text-caption font-weight-medium mr-3">
                {{ itemCounts(item._id).upcoming }} upcoming
              </span>
              <span v-if="itemCounts(item._id).paused" class="text-medium-emphasis text-caption font-weight-medium">
                {{ itemCounts(item._id).paused }} paused
              </span>
            </v-list-item-subtitle>
            <template #append>
              <div class="d-flex align-center ga-2">
                <v-btn
                  prepend-icon="mdi-chat-outline"
                  variant="text"
                  size="small"
                  @click.prevent.stop="router.push(`/items/${item._id}/chat`)"
                >Chat</v-btn>
                <v-btn
                  :icon="expandedItems.has(item._id) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                  variant="text"
                  size="small"
                  :title="expandedItems.has(item._id) ? 'Hide tasks' : 'View tasks'"
                  @click.prevent.stop="toggleItem(item._id)"
                />
              </div>
            </template>
          </v-list-item>

          <v-expand-transition>
            <div v-show="expandedItems.has(item._id)">
              <v-divider />
              <template v-if="getItemTasksGrouped(item._id).length">
                <template v-for="group in getItemTasksGrouped(item._id)" :key="group.catId">
                  <!-- Category header -->
                  <div class="d-flex align-center ga-2 px-4 pt-3 pb-1">
                    <v-icon size="10" :color="group.color || 'grey'">mdi-circle</v-icon>
                    <span class="text-caption font-weight-bold text-uppercase" style="letter-spacing: 0.08em;">{{ group.name }}</span>
                  </div>
                  <template v-for="sub in group.subcategories" :key="sub.subId">
                    <!-- Subcategory header (only when named) -->
                    <div v-if="sub.name" class="px-7 py-0 pb-1">
                      <span class="text-caption text-medium-emphasis">{{ sub.name }}</span>
                    </div>
                    <!-- Task rows -->
                    <v-list-item
                      v-for="task in sub.tasks"
                      :key="task._id"
                      :to="`/tasks/${task._id}`"
                      :class="sub.name ? 'pl-9' : 'pl-5'"
                      min-height="38"
                      density="compact"
                    >
                      <template #prepend>
                        <v-icon size="9" :color="STATUS_COLORS[task._status]" class="mr-2">mdi-circle</v-icon>
                      </template>
                      <v-list-item-title class="text-body-2">{{ task.title }}</v-list-item-title>
                      <template #append>
                        <v-chip :color="STATUS_COLORS[task._status]" size="x-small" label>
                          {{ task._status === 'paused' ? 'Paused' : formatDate(task.nextDueDate) }}
                        </v-chip>
                      </template>
                    </v-list-item>
                  </template>
                </template>
              </template>
              <div v-else class="px-4 py-3 text-caption text-medium-emphasis">No active tasks</div>

              <!-- Add a task for this item -->
              <div class="px-3 pt-1 pb-3">
                <v-btn
                  block
                  variant="outlined"
                  prepend-icon="mdi-plus"
                  @click.prevent.stop="router.push(`/tasks/new?item=${item._id}`)"
                >Add task</v-btn>
              </div>
            </div>
          </v-expand-transition>
        </v-card>
      </div>

      <v-empty-state
        v-if="!items.length"
        icon="mdi-tools"
        title="Nothing to maintain yet"
        text="Add items to start tracking maintenance tasks."
        action-text="Add Item"
        @click:action="router.push('/items/new')"
      />
    </template>

    <!-- Status task list dialog -->
    <v-dialog v-model="statusDialog" max-width="520">
      <v-card rounded="lg">
        <v-card-title class="d-flex align-center">
          <v-icon size="12" :color="STATUS_COLORS[statusFilter]" class="mr-2">mdi-circle</v-icon>
          {{ STATUS_LABELS[statusFilter] }}
          <span class="text-medium-emphasis ml-2">({{ statusTasks.length }})</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="statusDialog = false" />
        </v-card-title>
        <v-divider />
        <v-list v-if="statusTasks.length" density="compact" lines="two" max-height="60vh" class="overflow-y-auto">
          <v-list-item
            v-for="task in statusTasks"
            :key="task._id"
            :to="`/tasks/${task._id}`"
            @click="statusDialog = false"
          >
            <template #prepend>
              <v-icon size="9" :color="STATUS_COLORS[statusFilter]" class="mr-2">mdi-circle</v-icon>
            </template>
            <v-list-item-title class="text-body-2">{{ task.title }}</v-list-item-title>
            <v-list-item-subtitle>{{ task.itemId?.name || '—' }}</v-list-item-subtitle>
            <template #append>
              <v-chip :color="STATUS_COLORS[statusFilter]" size="x-small" label>
                {{ statusFilter === 'paused' ? 'Paused' : formatDate(task.nextDueDate) }}
              </v-chip>
            </template>
          </v-list-item>
        </v-list>
        <v-card-text v-else class="text-medium-emphasis text-body-2">
          No {{ STATUS_LABELS[statusFilter].toLowerCase() }} tasks.
        </v-card-text>
      </v-card>
    </v-dialog>

  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { format } from 'date-fns';
import { tasksApi, itemsApi } from '../services/api';

const router = useRouter();
const items = ref([]);
const allTasks = ref([]);
const counts = ref({ overdue: 0, dueSoon: 0, upcoming: 0, paused: 0 });
const loading = ref(true);
const expandedItems = ref(new Set());

const statusDialog = ref(false);
const statusFilter = ref('overdue');

const DEFAULT_LOCATION = 'Home';

const STATUS_LABELS = {
  overdue:    'Overdue',
  'due-soon': 'Due soon',
  upcoming:   'Upcoming',
  paused:     'Paused',
};

const TYPE_ICONS = {
  vehicle:   'mdi-car',
  equipment: 'mdi-tools',
  appliance: 'mdi-washing-machine',
  system:    'mdi-cog',
  structure: 'mdi-home',
  other:     'mdi-package-variant',
};

const TYPE_COLORS = {
  vehicle:   '#607D8B',
  equipment: '#795548',
  appliance: '#9C27B0',
  system:    '#FF9800',
  structure: '#4CAF50',
  other:     '#9E9E9E',
};

const STATUS_COLORS = {
  overdue:   'error',
  'due-soon': 'warning',
  upcoming:  'success',
  paused:    'grey',
};

const STATUS_ORDER = { overdue: 0, 'due-soon': 1, upcoming: 2, paused: 3 };

function formatDate(d) {
  if (!d) return '';
  return format(new Date(d), 'MMM d');
}

function toggleItem(id) {
  const s = new Set(expandedItems.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  expandedItems.value = s;
}

function itemLocation(item) {
  return (item.location || '').trim() || DEFAULT_LOCATION;
}

// Group items by location name. Locations sorted alphabetically, but "Home" first.
const groupedItems = computed(() => {
  const groups = new Map();
  for (const item of items.value) {
    const loc = itemLocation(item);
    if (!groups.has(loc)) groups.set(loc, { location: loc, items: [] });
    groups.get(loc).items.push(item);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.location === DEFAULT_LOCATION) return -1;
    if (b.location === DEFAULT_LOCATION) return 1;
    return a.location.localeCompare(b.location);
  });
});

// Only show location headers when items span more than one location.
const showLocations = computed(() => groupedItems.value.length > 1);

function openStatus(status) {
  statusFilter.value = status;
  statusDialog.value = true;
}

const statusTasks = computed(() =>
  allTasks.value
    .filter(t => t._status === statusFilter.value)
    .sort((a, b) => new Date(a.nextDueDate || 0) - new Date(b.nextDueDate || 0))
);

function itemCounts(itemId) {
  const id = String(itemId);
  return allTasks.value
    .filter(t => String(t.itemId?._id || t.itemId) === id)
    .reduce((acc, t) => {
      if (t._status === 'overdue') acc.overdue++;
      else if (t._status === 'due-soon') acc.dueSoon++;
      else if (t._status === 'upcoming') acc.upcoming++;
      else if (t._status === 'paused') acc.paused++;
      return acc;
    }, { overdue: 0, dueSoon: 0, upcoming: 0, paused: 0 });
}

function getItemTasksGrouped(itemId) {
  const id = String(itemId);
  const tasks = allTasks.value.filter(t => String(t.itemId?._id || t.itemId) === id);

  const catMap = new Map();
  for (const task of tasks) {
    const catId = String(task.categoryId?._id || 'none');
    if (!catMap.has(catId)) {
      catMap.set(catId, {
        catId,
        name:  task.categoryId?.name  || 'Uncategorized',
        color: task.categoryId?.color || null,
        subMap: new Map(),
      });
    }
    const cat = catMap.get(catId);
    const subId = String(task.subcategoryId?._id || 'none');
    if (!cat.subMap.has(subId)) {
      cat.subMap.set(subId, {
        subId,
        name:  task.subcategoryId?.name || null,
        tasks: [],
      });
    }
    cat.subMap.get(subId).tasks.push(task);
  }

  return [...catMap.values()].map(cat => ({
    ...cat,
    subcategories: [...cat.subMap.values()].map(sub => ({
      ...sub,
      tasks: sub.tasks.sort((a, b) => STATUS_ORDER[a._status] - STATUS_ORDER[b._status]),
    })),
  }));
}

onMounted(async () => {
  const [overdueRes, dueSoonRes, upcomingRes, pausedRes, itemsRes] = await Promise.all([
    tasksApi.list({ status: 'overdue' }),
    tasksApi.list({ status: 'due-soon' }),
    tasksApi.list({ status: 'upcoming' }),
    tasksApi.list({ status: 'paused' }),
    itemsApi.list(),
  ]);

  allTasks.value = [
    ...overdueRes.data.map(t => ({ ...t, _status: 'overdue' })),
    ...dueSoonRes.data.map(t => ({ ...t, _status: 'due-soon' })),
    ...upcomingRes.data.map(t => ({ ...t, _status: 'upcoming' })),
    ...pausedRes.data.map(t => ({ ...t, _status: 'paused' })),
  ];

  items.value = itemsRes.data;

  counts.value = {
    overdue: overdueRes.data.length,
    dueSoon: dueSoonRes.data.length,
    upcoming: upcomingRes.data.length,
    paused: pausedRes.data.length,
  };

  loading.value = false;
});
</script>

<style scoped>
.status-segment {
  cursor: pointer;
  border-radius: 8px;
  padding: 4px 10px;
  transition: background-color 0.15s;
}
.status-segment:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.06);
}
</style>
