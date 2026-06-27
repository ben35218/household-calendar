<template>
  <v-container class="py-6">
    <div class="d-flex align-center mb-4">
      <BackButton />
      <h1 class="text-h4 font-weight-bold ml-2">Task Template Library</h1>
      <v-spacer />
      <v-btn variant="outlined" color="#1976D2" to="/maintenance">Items</v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">Browse the household maintenance catalog. Click a template to review and customise it before adding.</p>

    <div class="d-flex align-center ga-3 mb-4">
      <v-btn-toggle v-model="filter" mandatory density="compact" variant="outlined" color="#1976D2">
        <v-btn value="available">Available</v-btn>
        <v-btn value="all">All</v-btn>
      </v-btn-toggle>
      <v-text-field v-model="search" label="Search templates…" prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" clearable hide-details />
    </div>

    <div v-for="(group, catName) in grouped" :key="catName" class="mb-6">
      <div class="text-subtitle-1 font-weight-bold mb-2 d-flex align-center ga-2 category-header" @click="toggleCollapse(catName)">
        <v-icon :color="categoryMeta(catName)?.color" size="20">{{ categoryMeta(catName)?.icon || 'mdi-shape' }}</v-icon>
        {{ catName }}
        <v-chip size="x-small" variant="tonal" class="ml-1">{{ group.length }}</v-chip>
        <v-spacer />
        <v-icon size="18" class="ml-1">{{ collapsed.has(catName) ? 'mdi-chevron-down' : 'mdi-chevron-up' }}</v-icon>
      </div>
      <v-row dense v-if="!collapsed.has(catName)">
        <v-col v-for="tpl in group" :key="tpl.id" cols="12" sm="6" md="4">
          <v-card
            variant="outlined"
            rounded="lg"
            :class="['template-card h-100', { 'template-card--used': usedTemplateIds.has(tpl.id) }]"
            @click="!usedTemplateIds.has(tpl.id) && router.push(`/calendar/event/new?tab=task&template=${tpl.id}`)"
          >
            <v-card-item class="pb-1">
              <v-card-title class="text-body-1 font-weight-medium">{{ tpl.title }}</v-card-title>
              <v-card-subtitle class="text-caption">{{ recurrenceLabel(tpl.recurrence) }}</v-card-subtitle>
            </v-card-item>
            <v-card-text class="pt-1 pb-2">
              <div class="d-flex flex-wrap ga-1">
                <v-chip
                  :color="priorityColor(tpl.priority)"
                  size="x-small"
                  label
                >{{ tpl.priority }}</v-chip>
                <v-chip v-if="tpl.estimatedDurationMins" size="x-small" label prepend-icon="mdi-clock-outline" variant="outlined">
                  {{ tpl.estimatedDurationMins }} min
                </v-chip>
                <v-chip v-if="tpl.estimatedCost" size="x-small" label prepend-icon="mdi-currency-usd" variant="outlined">
                  ~${{ tpl.estimatedCost }}
                </v-chip>
                <v-chip v-if="tpl.intervalKm" size="x-small" label prepend-icon="mdi-gauge" variant="outlined">
                  {{ tpl.intervalKm.toLocaleString() }} km
                </v-chip>
                <v-chip v-if="usedTemplateIds.has(tpl.id)" size="x-small" label color="success" prepend-icon="mdi-check-circle-outline">
                  In Use
                </v-chip>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </div>

  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { tasksApi, categoriesApi } from '../services/api';

const router = useRouter();
const templates = ref([]);
const categories = ref([]);
const search = ref('');
const filter = ref('available');
const usedTemplateIds = ref(new Set());
const collapsed = ref(new Set());

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const filtered = computed(() => {
  let list = templates.value;
  if (filter.value === 'available') list = list.filter(t => !usedTemplateIds.value.has(t.id));
  if (!search.value) return list;
  const q = search.value.toLowerCase();
  return list.filter(t => t.title.toLowerCase().includes(q) || t.defaultCategoryName?.toLowerCase().includes(q));
});

const grouped = computed(() => {
  const g = {};
  for (const t of filtered.value) {
    const cat = t.defaultCategoryName || 'General';
    if (!g[cat]) g[cat] = [];
    g[cat].push(t);
  }
  return g;
});

function categoryMeta(name) {
  return categories.value.find(c => c.name === name);
}

function priorityColor(p) {
  return { high: 'error', medium: 'warning', low: 'success' }[p] || 'grey';
}

function toggleCollapse(catName) {
  if (collapsed.value.has(catName)) collapsed.value.delete(catName);
  else collapsed.value.add(catName);
  collapsed.value = new Set(collapsed.value);
}

function recurrenceLabel(r) {
  if (!r) return '';
  if (r.type === 'one-time') return 'One-time';
  if (r.type === 'calendar') {
    const months = r.months?.map(m => MONTH_NAMES[m - 1]).join(' & ');
    const day = r.dayOfMonth ? ` on the ${r.dayOfMonth}${ordSuffix(r.dayOfMonth)}` : '';
    return `Every year in ${months}${day}`;
  }
  if (r.type === 'interval') {
    const n = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit?.replace(/s$/, '') : r.intervalUnit;
    return `Every ${n} ${unit}`;
  }
  return '';
}

function ordSuffix(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

onMounted(async () => {
  const [tplRes, catRes, taskRes] = await Promise.all([tasksApi.templates(), categoriesApi.list(), tasksApi.list()]);
  templates.value = tplRes.data;
  categories.value = catRes.data;
  usedTemplateIds.value = new Set(taskRes.data.filter(t => t.templateId).map(t => t.templateId));
});
</script>

<style scoped>
.category-header { cursor: pointer; user-select: none; }
.template-card { cursor: pointer; transition: transform 0.1s; }
.template-card:hover { transform: translateY(-1px); }
.template-card--used { cursor: default; opacity: 0.65; }
.template-card--used:hover { transform: none; }
</style>
