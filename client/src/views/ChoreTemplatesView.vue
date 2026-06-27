<template>
  <v-container class="py-6">
    <div class="d-flex align-center mb-4">
      <BackButton />
      <h1 class="text-h4 font-weight-bold ml-2">Chore Template Library</h1>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">Browse common household chores. Click a template to review and customise it before adding.</p>

    <div class="d-flex align-center ga-3 mb-4">
      <v-btn-toggle v-model="filter" mandatory density="compact" variant="outlined" color="#F57C00">
        <v-btn value="available">Available</v-btn>
        <v-btn value="all">All</v-btn>
      </v-btn-toggle>
      <v-text-field v-model="search" label="Search templates…" prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" clearable hide-details />
    </div>

    <div v-for="(group, catName) in grouped" :key="catName" class="mb-6">
      <div class="text-subtitle-1 font-weight-bold mb-2 d-flex align-center ga-2 category-header" @click="toggleCollapse(catName)">
        <v-icon color="#F57C00" size="20">{{ categoryIcon(catName) }}</v-icon>
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
            @click="!usedTemplateIds.has(tpl.id) && router.push(`/calendar/event/new?tab=chore&template=${tpl.id}`)"
          >
            <v-card-item class="pb-1">
              <v-card-title class="text-body-1 font-weight-medium">{{ tpl.title }}</v-card-title>
              <v-card-subtitle class="text-caption">{{ recurrenceLabel(tpl.recurrence) }}</v-card-subtitle>
            </v-card-item>
            <v-card-text class="pt-1 pb-2">
              <div class="d-flex flex-wrap ga-1">
                <v-chip :color="priorityColor(tpl.priority)" size="x-small" label>{{ tpl.priority }}</v-chip>
                <v-chip v-if="tpl.estimatedDurationMins" size="x-small" label prepend-icon="mdi-clock-outline" variant="outlined">
                  {{ tpl.estimatedDurationMins }} min
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
import { choresApi } from '../services/api';
import { useReturnTo } from '../composables/useSmartBack';

const router = useRouter();
const returnTo = useReturnTo();
const templates = ref([]);
const search = ref('');
const filter = ref('available');
const usedTemplateIds = ref(new Set());
const collapsed = ref(new Set());

const CATEGORY_ICONS = {
  'Kitchen':            'mdi-silverware-fork-knife',
  'Cleaning':           'mdi-spray-bottle',
  'Laundry & Linens':   'mdi-washing-machine',
  'Waste & Recycling':  'mdi-trash-can-outline',
  'Errands & Shopping': 'mdi-cart-outline',
  'Outdoor':            'mdi-tree-outline',
};

function categoryIcon(name) {
  return CATEGORY_ICONS[name] || 'mdi-broom';
}

function priorityColor(p) {
  return { high: 'error', medium: 'warning', low: 'success' }[p] || 'grey';
}

const filtered = computed(() => {
  let list = templates.value;
  if (filter.value === 'available') list = list.filter(t => !usedTemplateIds.value.has(t.id));
  if (!search.value) return list;
  const q = search.value.toLowerCase();
  return list.filter(t => t.title.toLowerCase().includes(q) || t.category?.toLowerCase().includes(q));
});

const grouped = computed(() => {
  const g = {};
  for (const t of filtered.value) {
    const cat = t.category || 'General';
    if (!g[cat]) g[cat] = [];
    g[cat].push(t);
  }
  return g;
});

function toggleCollapse(catName) {
  if (collapsed.value.has(catName)) collapsed.value.delete(catName);
  else collapsed.value.add(catName);
  collapsed.value = new Set(collapsed.value);
}

function recurrenceLabel(r) {
  if (!r) return '';
  if (r.type === 'one-time') return 'One-time';
  if (r.type === 'interval') {
    const n = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit?.replace(/s$/, '') : r.intervalUnit;
    return `Every ${n} ${unit}`;
  }
  return '';
}

async function addSelected() {
  adding.value = true;
  try {
    await choresApi.fromTemplate({ templateIds: selected.value });
    selected.value = [];
    returnTo('/calendar');
  } finally {
    adding.value = false;
  }
}

onMounted(async () => {
  const [tplRes, choreRes] = await Promise.all([choresApi.templates(), choresApi.list()]);
  templates.value = tplRes.data;
  usedTemplateIds.value = new Set(choreRes.data.filter(c => c.templateId).map(c => c.templateId));
});
</script>

<style scoped>
.category-header { cursor: pointer; user-select: none; }
.template-card { cursor: pointer; transition: transform 0.1s; }
.template-card:hover { transform: translateY(-1px); }
.template-card--used { cursor: default; opacity: 0.65; }
.template-card--used:hover { transform: none; }
</style>
