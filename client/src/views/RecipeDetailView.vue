<template>
  <v-container class="py-6 px-4" max-width="720" style="padding-bottom: 96px">
    <div class="d-flex align-center mb-6">
      <BackButton class="mr-2" />
      <h1 class="text-h4 font-weight-bold flex-grow-1">{{ recipe?.title ?? '' }}</h1>
      <v-btn icon="mdi-export-variant" variant="text" @click="shareRecipe" />
      <v-btn icon="mdi-pencil" variant="text" :to="`/recipes/${route.params.id}/edit`" />
    </div>

    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="recipe">
      <!-- Image -->
      <div v-if="recipe.imageUrl" class="recipe-hero mb-4">
        <img :src="recipe.imageUrl" :alt="recipe.title" />
      </div>

      <!-- Meta row -->
      <div class="d-flex flex-wrap ga-3 mb-4">
        <v-chip v-if="totalMins" prepend-icon="mdi-clock-outline" size="small">
          {{ totalMins }} min
        </v-chip>
        <v-chip v-if="recipe.servings" prepend-icon="mdi-account-multiple" size="small">
          {{ recipe.servings }} servings
        </v-chip>
        <v-chip v-if="recipe.prepTimeMins" size="small" color="info" variant="tonal">
          Prep: {{ recipe.prepTimeMins }} min
        </v-chip>
        <v-chip v-if="recipe.cookTimeMins" size="small" color="warning" variant="tonal">
          Cook: {{ recipe.cookTimeMins }} min
        </v-chip>
        <v-chip
          v-for="tag in recipe.tags"
          :key="tag"
          size="small"
          variant="outlined"
        >{{ tag }}</v-chip>
      </div>

      <p v-if="recipe.description" class="text-body-1 text-medium-emphasis mb-4">{{ recipe.description }}</p>

      <a v-if="recipe.sourceUrl" :href="recipe.sourceUrl" target="_blank" rel="noopener" class="text-body-2 text-primary mb-4 d-inline-flex align-center ga-1">
        <v-icon size="14">mdi-open-in-new</v-icon> Original source
      </a>

      <!-- Scheduling card: always visible, single home for schedule actions -->
      <v-card rounded="lg" elevation="0" variant="tonal" :color="featuredSchedule ? 'teal' : 'surface-variant'" class="mb-4">
        <v-card-text class="py-3 px-4">
          <div class="d-flex align-center">
            <v-icon :color="featuredSchedule ? 'teal' : undefined" class="mr-3" size="20">
              {{ featuredSchedule ? 'mdi-calendar-check' : 'mdi-calendar-clock' }}
            </v-icon>
            <div class="flex-grow-1">
              <template v-if="featuredSchedule">
                <div class="text-caption text-medium-emphasis">{{ featuredSchedule.isUpcoming ? 'Next scheduled' : 'Last scheduled' }}</div>
                <div class="text-body-1 font-weight-medium">{{ featuredSchedule.dateLabel }}</div>
              </template>
              <template v-else>
                <div class="text-caption text-medium-emphasis">Scheduling</div>
                <div class="text-body-1 font-weight-medium text-medium-emphasis">Not yet scheduled</div>
              </template>
            </div>
            <v-btn
              v-if="featuredSchedule"
              size="small"
              variant="tonal"
              color="teal"
              prepend-icon="mdi-calendar-edit"
              @click="openAdjustDialog"
            >
              Adjust
            </v-btn>
            <v-btn
              v-else
              size="small"
              variant="tonal"
              prepend-icon="mdi-calendar-plus"
              @click="scheduleDialog = true"
            >
              Schedule
            </v-btn>
          </div>
        </v-card-text>
      </v-card>

      <!-- Ingredients -->
      <v-card rounded="lg" elevation="1" class="mb-4">
        <v-card-title>Ingredients</v-card-title>
        <v-divider />
        <v-list density="compact">
          <v-list-item
            v-for="(ing, i) in recipe.ingredients"
            :key="i"
            :subtitle="ing.name"
          >
            <template #prepend>
              <span class="text-body-2 font-weight-medium mr-3 ingredient-amount">
                {{ [ing.amount, ing.unit].filter(Boolean).join(' ') }}
              </span>
            </template>
          </v-list-item>
        </v-list>
      </v-card>

      <!-- Instructions -->
      <v-card rounded="lg" elevation="1" class="mb-4">
        <v-card-title>Instructions</v-card-title>
        <v-divider />
        <v-card-text>
          <div
            v-for="(step, i) in recipe.instructions"
            :key="i"
            class="step-row mb-4"
          >
            <div class="step-badge">{{ i + 1 }}</div>
            <p class="text-body-1 step-text">{{ step }}</p>
          </div>
        </v-card-text>
      </v-card>
    </template>
  </v-container>

  <!-- Sticky action bar -->
  <div v-if="recipe" class="sticky-action-bar">
    <v-btn
      color="#00897B"
      size="large"
      prepend-icon="mdi-chef-hat"
      class="flex-grow-1"
      :disabled="!recipe.instructions?.length"
      @click="cookingMode = true"
    >
      Start Cooking
    </v-btn>
    <v-btn
      variant="outlined"
      color="#00897B"
      size="large"
      prepend-icon="mdi-calendar-week"
      to="/meal-planner"
    >
      Meal Planner
    </v-btn>
  </div>

  <!-- Schedule dialog (add new) -->
  <v-dialog v-model="scheduleDialog" max-width="400">
    <v-card rounded="xl">
      <v-card-title class="pt-5 pb-1">Schedule Recipe</v-card-title>
      <v-card-subtitle class="pb-3">{{ recipe?.title }}</v-card-subtitle>
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

  <!-- Adjust date dialog (edit existing) -->
  <v-dialog v-model="adjustDialog" max-width="400">
    <v-card rounded="xl">
      <v-card-title class="pt-5 pb-1">Adjust Date</v-card-title>
      <v-card-subtitle class="pb-3">{{ recipe?.title }}</v-card-subtitle>
      <v-card-text>
        <v-text-field
          v-model="adjustDate"
          label="New date"
          type="date"
          variant="outlined"
          density="comfortable"
          class="mb-3"
        />
        <v-text-field
          v-model.number="adjustServings"
          label="Servings (optional)"
          type="number"
          variant="outlined"
          density="comfortable"
        />
        <v-alert v-if="adjustError" type="error" variant="tonal" class="mt-2">{{ adjustError }}</v-alert>
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn @click="adjustDialog = false">Cancel</v-btn>
        <v-btn color="#00897B" :loading="adjustLoading" @click="doAdjust">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Snackbar for confirm messages -->
  <v-snackbar v-model="snackbar" :timeout="4000" location="bottom center" :color="snackbarColor">
    {{ snackbarText }}
  </v-snackbar>

  <!-- Cooking mode overlay -->
  <CookingModeOverlay v-model="cookingMode" :recipe="recipe" />
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { format, parseISO } from 'date-fns';
import { recipesApi, recipeScheduleApi } from '../services/api';
import CookingModeOverlay from '../components/CookingModeOverlay.vue';

const route = useRoute();

const recipe  = ref(null);
const loading = ref(true);

const totalMins = computed(() =>
  (recipe.value?.prepTimeMins || 0) + (recipe.value?.cookTimeMins || 0) || null
);

// --- Cooking mode ---
const cookingMode = ref(false);

// --- Share ---
async function shareRecipe() {
  const url = window.location.href;
  const shareData = {
    title: recipe.value?.title || 'Recipe',
    text: recipe.value?.title ? `Check out this recipe: ${recipe.value.title}` : 'Check out this recipe',
    url,
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard.writeText(url);
    snackbarText.value  = 'Link copied to clipboard';
    snackbarColor.value = 'success';
    snackbar.value      = true;
  } catch (e) {
    // User cancelled the native share sheet — ignore that, surface real errors.
    if (e?.name === 'AbortError') return;
    snackbarText.value  = 'Could not share recipe.';
    snackbarColor.value = 'error';
    snackbar.value      = true;
  }
}

// --- Schedule (add new) ---
const scheduleDialog   = ref(false);
const scheduleDate     = ref(format(new Date(), 'yyyy-MM-dd'));
const scheduleServings = ref(null);
const scheduleLoading  = ref(false);
const scheduleError    = ref('');

async function doSchedule() {
  scheduleError.value = '';
  scheduleLoading.value = true;
  try {
    await recipeScheduleApi.schedule({
      recipeId:      recipe.value._id,
      scheduledDate: scheduleDate.value,
      servings:      scheduleServings.value || undefined,
    });
    scheduleDialog.value = false;
    await loadSchedules();
  } catch (e) {
    scheduleError.value = e.response?.data?.error || 'Failed to schedule.';
  } finally {
    scheduleLoading.value = false;
  }
}

// --- Recipe schedules & featured schedule ---
const recipeSchedules = ref([]);

function findFeaturedSchedule(schedules) {
  if (!schedules.length) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const upcoming = schedules.filter(s => new Date(s.scheduledDate) >= now);
  if (upcoming.length) {
    return { schedule: upcoming[0], isUpcoming: true };
  }
  return { schedule: schedules[schedules.length - 1], isUpcoming: false };
}

const featuredSchedule = computed(() => {
  const found = findFeaturedSchedule(recipeSchedules.value);
  if (!found) return null;
  const d = parseISO(new Date(found.schedule.scheduledDate).toISOString().slice(0, 10));
  return {
    ...found,
    dateLabel: format(d, 'EEEE, MMMM d, yyyy'),
    dateValue: new Date(found.schedule.scheduledDate).toISOString().slice(0, 10),
    scheduleId: found.schedule._id,
    servings: found.schedule.servings,
  };
});

async function loadSchedules() {
  const { data } = await recipeScheduleApi.forRecipe(route.params.id);
  recipeSchedules.value = data;
}

// --- Adjust date ---
const adjustDialog   = ref(false);
const adjustDate     = ref('');
const adjustServings = ref(null);
const adjustLoading  = ref(false);
const adjustError    = ref('');

function openAdjustDialog() {
  if (!featuredSchedule.value) return;
  adjustDate.value     = featuredSchedule.value.dateValue;
  adjustServings.value = featuredSchedule.value.servings ?? null;
  adjustError.value    = '';
  adjustDialog.value   = true;
}

const snackbar      = ref(false);
const snackbarText  = ref('');
const snackbarColor = ref('success');

async function doAdjust() {
  adjustError.value = '';
  adjustLoading.value = true;
  try {
    const { data } = await recipeScheduleApi.update(featuredSchedule.value.scheduleId, {
      scheduledDate: adjustDate.value,
      servings:      adjustServings.value || null,
    });
    adjustDialog.value = false;
    await loadSchedules();
    if (data.weekChanged) {
      const oldShopPassed = new Date(data.oldWeekStart) < new Date(new Date().toDateString());
      snackbarText.value  = oldShopPassed
        ? `Date moved to ${format(parseISO(adjustDate.value), 'MMM d')} — added to new week's grocery list.`
        : `Date moved to ${format(parseISO(adjustDate.value), 'MMM d')} — grocery lists for both weeks updated.`;
      snackbarColor.value = 'info';
    } else {
      snackbarText.value  = `Date updated to ${format(parseISO(adjustDate.value), 'EEEE, MMM d')}.`;
      snackbarColor.value = 'success';
    }
    snackbar.value = true;
  } catch (e) {
    adjustError.value = e.response?.data?.error || 'Failed to update date.';
  } finally {
    adjustLoading.value = false;
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    const [recipeRes] = await Promise.all([
      recipesApi.get(route.params.id),
      loadSchedules(),
    ]);
    recipe.value = recipeRes.data;
    scheduleServings.value = recipeRes.data.servings ?? null;
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.recipe-hero {
  border-radius: 12px;
  overflow: hidden;
  max-height: 280px;
}
.recipe-hero img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ingredient-amount {
  min-width: 72px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.step-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.step-badge {
  min-width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  color: white;
  font-size: 0.8rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}
.step-text {
  line-height: 1.6;
}
.sticky-action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  padding-bottom: max(12px, env(safe-area-inset-bottom, 12px));
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  z-index: 10;
}
</style>
