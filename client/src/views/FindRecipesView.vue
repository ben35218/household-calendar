<template>
  <v-container class="py-6 px-4" max-width="720">
    <div class="d-flex align-center mb-6">
      <BackButton color="#00897B" class="mr-2" />
      <h1 class="text-h4 font-weight-bold">Find Recipes</h1>
    </div>

    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="#00897B" />
    </div>

    <template v-else>
      <!-- Ingredient selector + mode (only shown before results) -->
      <template v-if="!recipeSuggestions && !libraryResults">
        <v-card rounded="lg" elevation="1" class="mb-4">
          <v-card-title>Search Mode</v-card-title>
          <v-divider />
          <v-card-text>
            <v-btn-toggle
              v-model="recipeSearchMode"
              mandatory
              divided
              density="comfortable"
              class="w-100"
            >
              <v-btn value="generate" class="flex-1-1" prepend-icon="mdi-chef-hat">Generate</v-btn>
              <v-btn value="library" class="flex-1-1" prepend-icon="mdi-bookshelf">My Library</v-btn>
            </v-btn-toggle>
          </v-card-text>
        </v-card>

        <v-card rounded="lg" elevation="1" class="mb-4">
          <v-card-title class="d-flex align-center">
            {{ recipeSearchMode === 'library' ? 'Filter by ingredients you have' : 'Choose ingredients to build recipes around' }}
            <v-spacer />
            <v-btn variant="text" size="x-small" color="#00897B" @click="recipeSelectedIds = items.map(i => i._id)">All</v-btn>
            <v-btn variant="text" size="x-small" color="medium-emphasis" @click="recipeSelectedIds = []">None</v-btn>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <div v-if="!items.length" class="text-center py-6 text-medium-emphasis">
              <v-icon size="40" class="mb-2">mdi-fridge-outline</v-icon>
              <div class="text-body-2">No items in your inventory yet.</div>
            </div>
            <div v-else class="d-flex flex-wrap ga-2">
              <v-chip
                v-for="item in items"
                :key="item._id"
                :color="recipeSelectedIds.includes(item._id) ? '#00897B' : undefined"
                :variant="recipeSelectedIds.includes(item._id) ? 'tonal' : 'outlined'"
                size="small"
                style="cursor:pointer"
                @click="toggleRecipeSelect(item._id)"
              >{{ item.name }}</v-chip>
            </div>
            <div class="text-caption text-medium-emphasis mt-3">
              <template v-if="recipeSearchMode === 'library'">
                {{ recipeSelectedIds.length }} of {{ items.length }} selected — your library will be filtered to recipes using these ingredients
              </template>
              <template v-else>
                {{ recipeSelectedIds.length }} of {{ items.length }} selected — Claude will build recipes around these ingredients
              </template>
            </div>
          </v-card-text>
        </v-card>

        <!-- Generate mode: ingredient constraint options -->
        <v-card v-if="recipeSearchMode === 'generate'" rounded="lg" elevation="1" class="mb-4">
          <v-card-title>Ingredient Constraint</v-card-title>
          <v-divider />
          <v-card-text>
            <v-radio-group v-model="ingredientMode" density="compact" hide-details>
              <v-radio value="focus" color="#00897B">
                <template #label>
                  <div>
                    <div class="text-body-2">Selected items are the focus</div>
                    <div class="text-caption text-medium-emphasis">Recipes are built around these ingredients; common staples also allowed</div>
                  </div>
                </template>
              </v-radio>
              <v-radio value="included" color="#00897B" class="mt-2">
                <template #label>
                  <div>
                    <div class="text-body-2">Selected items are included, not the focus</div>
                    <div class="text-caption text-medium-emphasis">Recipes must use these items as supporting ingredients, not the star</div>
                  </div>
                </template>
              </v-radio>
              <v-radio value="strict" color="#00897B" class="mt-2">
                <template #label>
                  <div>
                    <div class="text-body-2">Strictly inventory only</div>
                    <div class="text-caption text-medium-emphasis">Only suggest recipes that use nothing outside the selected list</div>
                  </div>
                </template>
              </v-radio>
            </v-radio-group>
          </v-card-text>
        </v-card>

        <v-alert v-if="recipeError" type="error" variant="tonal" class="mb-4">{{ recipeError }}</v-alert>

        <v-btn
          v-if="recipeSearchMode === 'generate'"
          color="#00897B"
          :loading="recipeLoading"
          :disabled="recipeSelectedIds.length === 0"
          size="large"
          block
          prepend-icon="mdi-chef-hat"
          @click="doSuggestRecipes"
        >Suggest Recipes</v-btn>

        <v-btn
          v-else
          color="#00897B"
          :loading="libraryLoading"
          size="large"
          block
          prepend-icon="mdi-bookshelf"
          @click="doSearchLibrary"
        >Search My Library</v-btn>
      </template>

      <!-- Generate results -->
      <template v-if="recipeSuggestions">
        <div class="d-flex align-center mb-4">
          <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="recipeSuggestions = null" />
          <span class="text-h6 font-weight-medium ml-1">Recipe Suggestions</span>
        </div>
        <div class="d-flex flex-column ga-3">
          <v-card
            v-for="(recipe, i) in recipeSuggestions"
            :key="i"
            rounded="lg"
            elevation="1"
          >
            <v-card-text class="pb-1">
              <div class="font-weight-semibold text-body-1 mb-1">{{ recipe.title }}</div>
              <div class="text-body-2 text-medium-emphasis mb-2">{{ recipe.description }}</div>
              <div class="d-flex align-center ga-1 mb-2">
                <v-icon size="14" color="medium-emphasis">mdi-clock-outline</v-icon>
                <span class="text-caption text-medium-emphasis">{{ recipe.time }}</span>
              </div>
              <div class="d-flex flex-wrap ga-1">
                <v-chip v-for="ing in recipe.usedIngredients" :key="ing" size="x-small" color="success" variant="tonal">{{ ing }}</v-chip>
                <v-chip v-for="ing in recipe.needsOther" :key="ing" size="x-small" color="grey" variant="tonal">{{ ing }}</v-chip>
              </div>
            </v-card-text>
            <v-card-actions class="pt-0 px-3 pb-2">
              <v-spacer />
              <v-btn
                v-if="savedRecipeIds[i]"
                size="small"
                variant="text"
                color="success"
                prepend-icon="mdi-check"
                :to="`/recipes/${savedRecipeIds[i]}`"
              >View Recipe</v-btn>
              <v-btn
                v-else
                size="small"
                variant="tonal"
                color="#00897B"
                prepend-icon="mdi-content-save-outline"
                :loading="savingRecipeIndex === i"
                @click="saveRecipeToLibrary(recipe, i)"
              >Save to Library</v-btn>
            </v-card-actions>
          </v-card>
        </div>
      </template>

      <!-- Library results -->
      <template v-if="libraryResults">
        <div class="d-flex align-center mb-4">
          <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="libraryResults = null" />
          <span class="text-h6 font-weight-medium ml-1">
            {{ libraryResults.length }} recipe{{ libraryResults.length === 1 ? '' : 's' }} found
          </span>
        </div>
        <div v-if="!libraryResults.length" class="text-center py-12 text-medium-emphasis">
          <v-icon size="72" class="mb-4">mdi-bookshelf</v-icon>
          <div class="text-body-1 mb-1">No saved recipes match those ingredients.</div>
          <div class="text-caption">Try selecting fewer ingredients or switch to Generate mode.</div>
        </div>
        <div v-else class="d-flex flex-column ga-3">
          <v-card
            v-for="recipe in libraryResults"
            :key="recipe._id"
            rounded="lg"
            elevation="1"
          >
            <v-card-text class="pb-1">
              <div class="font-weight-semibold text-body-1 mb-1">{{ recipe.title }}</div>
              <div v-if="recipe.description" class="text-body-2 text-medium-emphasis mb-2">{{ recipe.description }}</div>
              <div v-if="recipe.matchedIngredients.length" class="d-flex flex-wrap ga-1">
                <v-chip v-for="ing in recipe.matchedIngredients" :key="ing" size="x-small" color="success" variant="tonal">{{ ing }}</v-chip>
              </div>
            </v-card-text>
            <v-card-actions class="pt-0 px-3 pb-2">
              <span class="text-caption text-medium-emphasis ml-1">
                {{ recipe.matchedIngredients.length }} ingredient{{ recipe.matchedIngredients.length === 1 ? '' : 's' }} match
              </span>
              <v-spacer />
              <v-btn
                size="small"
                variant="tonal"
                color="#00897B"
                prepend-icon="mdi-open-in-new"
                :to="`/recipes/${recipe._id}`"
              >View Recipe</v-btn>
            </v-card-actions>
          </v-card>
        </div>
      </template>
    </template>
  </v-container>

  <v-snackbar v-model="snackbar" :timeout="3000" color="success">{{ snackbarText }}</v-snackbar>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { inventoryApi, recipesApi } from '../services/api';

const loading          = ref(true);
const items            = ref([]);
const recipeSearchMode = ref('generate');
const recipeSelectedIds = ref([]);
const ingredientMode   = ref('focus');
const recipeLoading    = ref(false);
const libraryLoading   = ref(false);
const recipeError      = ref('');
const recipeSuggestions = ref(null);
const libraryResults   = ref(null);
const savingRecipeIndex = ref(null);
const savedRecipeIds   = ref({});
const snackbar         = ref(false);
const snackbarText     = ref('');

function showSnack(msg) {
  snackbarText.value = msg;
  snackbar.value = true;
}

function toggleRecipeSelect(id) {
  const i = recipeSelectedIds.value.indexOf(id);
  if (i === -1) recipeSelectedIds.value.push(id);
  else recipeSelectedIds.value.splice(i, 1);
}

async function doSuggestRecipes() {
  recipeError.value = '';
  recipeLoading.value = true;
  savedRecipeIds.value = {};
  try {
    const selectedNames = items.value
      .filter(item => recipeSelectedIds.value.includes(item._id))
      .map(item => item.name);
    const { data } = await inventoryApi.suggestRecipes(selectedNames, ingredientMode.value);
    recipeSuggestions.value = data.recipes;
  } catch (e) {
    recipeError.value = e.response?.data?.error || 'Failed to suggest recipes';
  } finally {
    recipeLoading.value = false;
  }
}

async function doSearchLibrary() {
  recipeError.value = '';
  libraryLoading.value = true;
  try {
    const { data: allRecipes } = await recipesApi.list();
    const selectedNames = items.value
      .filter(item => recipeSelectedIds.value.includes(item._id))
      .map(item => item.name.toLowerCase());

    const scored = allRecipes.map(recipe => {
      const recipeIngNames = (recipe.ingredients || []).map(i => i.name.toLowerCase());
      const matched = selectedNames.filter(name =>
        recipeIngNames.some(ri => ri.includes(name) || name.includes(ri))
      );
      return { ...recipe, matchedIngredients: matched, matchCount: matched.length };
    });

    libraryResults.value = scored
      .filter(r => selectedNames.length === 0 || r.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount);
  } catch {
    recipeError.value = 'Failed to search library';
  } finally {
    libraryLoading.value = false;
  }
}

async function saveRecipeToLibrary(suggestion, i) {
  savingRecipeIndex.value = i;
  try {
    const description = [
      `Recipe: ${suggestion.title}.`,
      suggestion.description,
      suggestion.usedIngredients?.length ? `Main ingredients: ${suggestion.usedIngredients.join(', ')}.` : '',
      suggestion.needsOther?.length ? `Also needs: ${suggestion.needsOther.join(', ')}.` : '',
      suggestion.time ? `Estimated time: ${suggestion.time}.` : '',
    ].filter(Boolean).join(' ');
    const { data } = await recipesApi.fromAi(description);
    savedRecipeIds.value = { ...savedRecipeIds.value, [i]: data._id };
    showSnack(`"${data.title}" saved to Recipe Library`);
  } catch {
    showSnack('Failed to save recipe — please try again');
  } finally {
    savingRecipeIndex.value = null;
  }
}

onMounted(async () => {
  try {
    const { data } = await inventoryApi.list({ status: 'active' });
    items.value = data;
  } finally {
    loading.value = false;
  }
});
</script>
