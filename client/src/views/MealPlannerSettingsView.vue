<template>
  <v-container class="py-6 px-4" max-width="600">
    <div class="d-flex align-center mb-6">
      <BackButton class="mr-2" />
      <h1 class="text-h5 font-weight-bold">Meal Planner Settings</h1>
    </div>

    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Grocery Shopping Day -->
      <v-card rounded="lg" class="mb-4">
        <v-card-title class="text-body-1 font-weight-semibold pt-4 px-4 pb-1">Grocery Shopping Day</v-card-title>
        <v-card-subtitle class="px-4 pb-3">The week starts on this day in the meal planner.</v-card-subtitle>
        <v-divider />
        <v-list density="compact" nav class="py-1">
          <v-list-item
            v-for="opt in groceryDayOptions"
            :key="opt.value"
            :title="opt.title"
            :active="groceryShoppingDay === opt.value"
            active-color="primary"
            rounded="lg"
            :disabled="dayLoading"
            @click="setGroceryDay(opt.value)"
          >
            <template #append>
              <v-progress-circular v-if="dayLoading && groceryShoppingDay === opt.value" indeterminate size="16" width="2" color="primary" />
              <v-icon v-else-if="groceryShoppingDay === opt.value" color="primary">mdi-check</v-icon>
            </template>
          </v-list-item>
        </v-list>
      </v-card>

      <!-- Grocery Section Order -->
      <v-card rounded="lg">
        <v-card-title class="text-body-1 font-weight-semibold pt-4 px-4 pb-1">Grocery Section Order</v-card-title>
        <v-card-subtitle class="px-4 pb-3">Set your preferred shopping order. Claude uses these sections when organizing your list.</v-card-subtitle>
        <v-divider />
        <v-list density="compact" class="py-1">
          <v-list-item
            v-for="(section, i) in editingSections"
            :key="section"
            class="pr-2"
          >
            <template #prepend>
              <span class="text-caption text-medium-emphasis mr-3 section-num">{{ i + 1 }}</span>
            </template>
            <v-list-item-title>{{ section }}</v-list-item-title>
            <template #append>
              <v-btn icon size="x-small" variant="text" :disabled="i === 0" @click="moveSectionUp(i)">
                <v-icon size="16">mdi-chevron-up</v-icon>
              </v-btn>
              <v-btn icon size="x-small" variant="text" :disabled="i === editingSections.length - 1" @click="moveSectionDown(i)">
                <v-icon size="16">mdi-chevron-down</v-icon>
              </v-btn>
              <v-btn icon size="x-small" variant="text" color="error" @click="removeSection(i)">
                <v-icon size="16">mdi-close</v-icon>
              </v-btn>
            </template>
          </v-list-item>
        </v-list>
        <v-divider />
        <div class="d-flex align-center ga-2 px-4 py-3">
          <v-text-field
            v-model="newSectionName"
            density="compact"
            variant="outlined"
            placeholder="Add section…"
            hide-details
            @keyup.enter="addSection"
          />
          <v-btn icon variant="tonal" color="#00897B" size="small" @click="addSection">
            <v-icon>mdi-plus</v-icon>
          </v-btn>
        </div>
        <v-card-actions class="px-4 pb-4">
          <v-btn variant="text" @click="resetSections">Reset to defaults</v-btn>
          <v-spacer />
          <v-btn color="#00897B" :loading="sectionSaving" @click="saveSectionOrder">Save Order</v-btn>
        </v-card-actions>
      </v-card>
    </template>

    <v-snackbar v-model="snackbar" :timeout="2500" color="success" location="bottom center">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { settingsApi } from '../services/api';

const DEFAULT_SECTIONS = ['Produce', 'Deli', 'Bakery', 'Meat & Seafood', 'Dairy', 'Frozen', 'Pantry', 'Other'];

const loading            = ref(true);
const groceryShoppingDay = ref(6);
const dayLoading         = ref(false);
const editingSections    = ref([...DEFAULT_SECTIONS]);
const newSectionName     = ref('');
const sectionSaving      = ref(false);
const snackbar           = ref(false);
const snackbarText       = ref('');

const groceryDayOptions = [
  { title: 'Sunday',    value: 0 },
  { title: 'Monday',    value: 1 },
  { title: 'Tuesday',   value: 2 },
  { title: 'Wednesday', value: 3 },
  { title: 'Thursday',  value: 4 },
  { title: 'Friday',    value: 5 },
  { title: 'Saturday',  value: 6 },
];

function showSnack(msg) {
  snackbarText.value = msg;
  snackbar.value = true;
}

async function setGroceryDay(day) {
  if (groceryShoppingDay.value === day) return;
  dayLoading.value = true;
  groceryShoppingDay.value = day;
  try {
    await settingsApi.update({ groceryShoppingDay: day });
    showSnack('Shopping day updated');
  } finally {
    dayLoading.value = false;
  }
}

function moveSectionUp(i) {
  if (i === 0) return;
  const s = [...editingSections.value];
  [s[i - 1], s[i]] = [s[i], s[i - 1]];
  editingSections.value = s;
}

function moveSectionDown(i) {
  if (i === editingSections.value.length - 1) return;
  const s = [...editingSections.value];
  [s[i], s[i + 1]] = [s[i + 1], s[i]];
  editingSections.value = s;
}

function addSection() {
  const name = newSectionName.value.trim();
  if (!name || editingSections.value.includes(name)) return;
  editingSections.value = [...editingSections.value, name];
  newSectionName.value  = '';
}

function removeSection(i) {
  editingSections.value = editingSections.value.filter((_, idx) => idx !== i);
}

function resetSections() {
  editingSections.value = [...DEFAULT_SECTIONS];
}

async function saveSectionOrder() {
  sectionSaving.value = true;
  try {
    await settingsApi.update({ grocerySections: editingSections.value });
    showSnack('Section order saved');
  } finally {
    sectionSaving.value = false;
  }
}

onMounted(async () => {
  try {
    const { data } = await settingsApi.get();
    groceryShoppingDay.value = data.groceryShoppingDay ?? 6;
    editingSections.value    = data.grocerySections?.length ? data.grocerySections : [...DEFAULT_SECTIONS];
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.section-num {
  min-width: 18px;
  text-align: right;
}
</style>
