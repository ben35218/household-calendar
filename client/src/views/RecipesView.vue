<template>
  <v-container class="py-6 px-4" max-width="900">
    <div class="d-flex align-center mb-4">
      <BackButton color="#00897B" class="mr-1" />
      <h1 class="text-h4 font-weight-bold">Recipes</h1>
      <v-spacer />
      <v-btn icon="mdi-plus" color="#00897B" to="/recipes/new" />
    </div>

    <!-- Search + Filter -->
    <div class="d-flex align-center ga-2 mb-4">
      <v-text-field
        v-model="search"
        placeholder="Search recipes…"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        variant="solo-filled"
        hide-details
        flat
        clearable
      />
      <v-badge :model-value="activeCount > 0" :content="activeCount" color="info">
        <v-btn icon="mdi-tune-variant" variant="tonal" @click="showFilters = true" />
      </v-badge>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!filteredRecipes.length" class="text-center py-16">
      <v-icon size="72" color="grey-lighten-1" class="mb-4">mdi-silverware-fork-knife</v-icon>
      <div class="text-h6 text-medium-emphasis mb-1">No recipes yet</div>
      <div class="text-body-2 text-medium-emphasis mb-6">Add your first recipe to get started</div>
      <v-btn color="#00897B" prepend-icon="mdi-plus" to="/recipes/new">Add Recipe</v-btn>
    </div>

    <!-- Recipe grid -->
    <v-row v-else>
      <v-col
        v-for="recipe in filteredRecipes"
        :key="recipe._id"
        cols="12"
        sm="6"
        md="4"
      >
        <v-card
          rounded="lg"
          elevation="1"
          class="recipe-card"
          @click="router.push(`/recipes/${recipe._id}`)"
        >
          <div v-if="recipe.imageUrl" class="recipe-img-wrap">
            <img :src="recipe.imageUrl" class="recipe-img" :alt="recipe.title" />
          </div>
          <div v-else class="recipe-img-placeholder d-flex align-center justify-center">
            <v-icon size="40" color="grey-lighten-2">mdi-silverware-fork-knife</v-icon>
          </div>
          <v-card-text class="pb-2">
            <div class="font-weight-semibold text-body-1 recipe-title mb-1">{{ recipe.title }}</div>
            <div class="d-flex align-center ga-2 text-caption text-medium-emphasis flex-wrap">
              <span v-if="recipe.prepTimeMins || recipe.cookTimeMins">
                <v-icon size="12" class="mr-0">mdi-clock-outline</v-icon>
                {{ (recipe.prepTimeMins || 0) + (recipe.cookTimeMins || 0) }} min
              </span>
              <span v-if="recipe.servings">
                <v-icon size="12">mdi-account-multiple</v-icon>
                {{ recipe.servings }}
              </span>
              <v-chip
                v-if="recipe.source === 'ai'"
                size="x-small"
                color="secondary"
                variant="tonal"
                class="ml-auto"
              >AI</v-chip>
              <v-chip
                v-else-if="recipe.source === 'url'"
                size="x-small"
                color="info"
                variant="tonal"
                class="ml-auto"
              >URL</v-chip>
              <v-chip
                v-else-if="recipe.source === 'photo'"
                size="x-small"
                color="success"
                variant="tonal"
                class="ml-auto"
              >Photo</v-chip>
            </div>
          </v-card-text>
          <v-card-actions class="pt-0 px-3 pb-2">
            <v-btn
              size="small"
              variant="text"
              color="#00897B"
              prepend-icon="mdi-calendar-plus"
              @click.stop="openScheduleDialog(recipe)"
            >Schedule</v-btn>
            <v-spacer />
            <v-btn
              size="small"
              icon="mdi-pencil"
              variant="text"
              color="medium-emphasis"
              @click.stop="router.push(`/recipes/${recipe._id}/edit`)"
            />
            <v-btn
              size="small"
              icon="mdi-delete"
              variant="text"
              color="error"
              @click.stop="confirmDelete(recipe)"
            />
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>

  <!-- Filter bottom sheet -->
  <v-bottom-sheet v-model="showFilters">
    <v-card rounded="t-xl" class="pa-4">
      <div class="d-flex justify-space-between align-center mb-4">
        <span class="text-subtitle-1">Filters</span>
        <v-btn variant="text" size="small" color="info" @click="resetFilters">Reset</v-btn>
      </div>

      <div class="text-caption text-medium-emphasis mb-2">Cook time</div>
      <v-btn-toggle v-model="cookTime" divided density="comfortable" class="w-100 mb-4">
        <v-btn :value="null" class="flex-1-1">Any</v-btn>
        <v-btn value="<30" class="flex-1-1">&lt; 30</v-btn>
        <v-btn value="30-60" class="flex-1-1">30–60</v-btn>
        <v-btn value="60+" class="flex-1-1">60+</v-btn>
      </v-btn-toggle>

      <div class="text-caption text-medium-emphasis mb-2">Tags</div>
      <v-chip-group v-model="selectedTags" multiple filter column class="mb-4">
        <v-chip v-for="tag in allTags" :key="tag" :value="tag" size="small">{{ tag }}</v-chip>
      </v-chip-group>

      <v-btn block color="info" @click="showFilters = false">
        Show {{ filteredRecipes.length }} recipes
      </v-btn>
    </v-card>
  </v-bottom-sheet>

  <!-- Schedule dialog -->
  <v-dialog v-model="scheduleDialog" max-width="400">
    <v-card rounded="xl">
      <v-card-title class="pt-5 pb-1">Schedule Recipe</v-card-title>
      <v-card-subtitle class="pb-3">{{ scheduleRecipe?.title }}</v-card-subtitle>
      <v-card-text>
        <v-text-field
          v-model="scheduleDate"
          label="Date"
          type="date"
          variant="outlined"
          density="comfortable"
          class="mb-3"
        />
        <v-text-field
          v-model.number="scheduleServings"
          label="Servings (optional)"
          type="number"
          variant="outlined"
          density="comfortable"
          class="mb-2"
        />
        <v-alert v-if="scheduleError" type="error" variant="tonal" class="mt-2">{{ scheduleError }}</v-alert>
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn @click="scheduleDialog = false">Cancel</v-btn>
        <v-btn color="#00897B" :loading="scheduleLoading" @click="doSchedule">Schedule</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Delete confirm -->
  <v-dialog v-model="deleteDialog" max-width="360">
    <v-card rounded="xl">
      <v-card-title class="pt-5">Delete recipe?</v-card-title>
      <v-card-text>
        <strong>{{ deleteTarget?.title }}</strong> will be permanently removed.
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn @click="deleteDialog = false">Cancel</v-btn>
        <v-btn color="error" :loading="deleteLoading" @click="doDelete">Delete</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { format } from 'date-fns';
import { recipesApi, recipeScheduleApi } from '../services/api';

const router = useRouter();

const recipes      = ref([]);
const loading      = ref(true);
const search       = ref('');
const selectedTags = ref([]);
const cookTime     = ref(null); // null | '<30' | '30-60' | '60+'
const showFilters  = ref(false);

const allTags = computed(() => {
  const set = new Set();
  for (const r of recipes.value) r.tags?.forEach(t => set.add(t));
  return [...set].sort();
});

const activeCount = computed(() =>
  (cookTime.value ? 1 : 0) + selectedTags.value.length
);

function resetFilters() {
  cookTime.value     = null;
  selectedTags.value = [];
}

function totalMins(r) {
  return (r.prepTimeMins || 0) + (r.cookTimeMins || 0);
}

const filteredRecipes = computed(() => {
  return recipes.value.filter(r => {
    if (search.value) {
      const q = search.value.toLowerCase();
      if (!r.title.toLowerCase().includes(q) && !r.tags?.some(t => t.toLowerCase().includes(q))) return false;
    }
    if (selectedTags.value.length) {
      if (!selectedTags.value.every(t => r.tags?.includes(t))) return false;
    }
    if (cookTime.value) {
      const mins = totalMins(r);
      if (cookTime.value === '<30'   && !(mins > 0 && mins < 30))    return false;
      if (cookTime.value === '30-60' && !(mins >= 30 && mins <= 60)) return false;
      if (cookTime.value === '60+'   && !(mins > 60))                return false;
    }
    return true;
  });
});

async function loadRecipes() {
  loading.value = true;
  try {
    const { data } = await recipesApi.list();
    recipes.value = data;
  } finally {
    loading.value = false;
  }
}

// Schedule
const scheduleDialog   = ref(false);
const scheduleRecipe   = ref(null);
const scheduleDate     = ref('');
const scheduleServings = ref(null);
const scheduleLoading  = ref(false);
const scheduleError    = ref('');

function openScheduleDialog(recipe) {
  scheduleRecipe.value   = recipe;
  scheduleDate.value     = format(new Date(), 'yyyy-MM-dd');
  scheduleServings.value = recipe.servings ?? null;
  scheduleError.value    = '';
  scheduleDialog.value   = true;
}

async function doSchedule() {
  scheduleError.value = '';
  scheduleLoading.value = true;
  try {
    await recipeScheduleApi.schedule({
      recipeId:      scheduleRecipe.value._id,
      scheduledDate: scheduleDate.value,
      servings:      scheduleServings.value || undefined,
    });
    scheduleDialog.value = false;
  } catch (e) {
    scheduleError.value = e.response?.data?.error || 'Failed to schedule.';
  } finally {
    scheduleLoading.value = false;
  }
}

// Delete
const deleteDialog  = ref(false);
const deleteTarget  = ref(null);
const deleteLoading = ref(false);

function confirmDelete(recipe) {
  deleteTarget.value = recipe;
  deleteDialog.value = true;
}

async function doDelete() {
  deleteLoading.value = true;
  try {
    await recipesApi.delete(deleteTarget.value._id);
    deleteDialog.value = false;
    await loadRecipes();
  } finally {
    deleteLoading.value = false;
  }
}

onMounted(loadRecipes);
</script>

<style scoped>
.recipe-card {
  cursor: pointer;
  transition: opacity 0.15s;
}
.recipe-card:hover { opacity: 0.88; }
.recipe-img-wrap {
  height: 140px;
  overflow: hidden;
}
.recipe-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.recipe-img-placeholder {
  height: 100px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.recipe-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
