<template>
  <v-container class="py-6 px-4" max-width="720">
    <div class="d-flex align-center mb-6">
      <BackButton class="mr-2" />
      <h1 class="text-h4 font-weight-bold">{{ isEdit ? 'Edit Recipe' : 'New Recipe' }}</h1>
    </div>

    <div v-if="pageLoading" class="text-center py-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
    <!-- Import options (new recipe only) -->
    <v-card v-if="!isEdit" rounded="lg" elevation="1" class="mb-4">
      <v-card-title>Import a Recipe</v-card-title>
      <v-divider />
      <v-card-text>
        <div class="d-flex flex-wrap ga-3 mb-3">
          <v-btn variant="tonal" color="#00897B" prepend-icon="mdi-link" @click="openPanel('url')">From URL</v-btn>
          <v-btn variant="tonal" color="#00897B" prepend-icon="mdi-robot" @click="openPanel('ai')">Ask AI</v-btn>
          <v-btn variant="tonal" color="#00897B" prepend-icon="mdi-camera" @click="triggerPhotoInput">From Photo</v-btn>
        </div>
        <div class="text-caption text-medium-emphasis">Or fill in the form below to add manually.</div>

        <!-- Hidden file input (camera + gallery) -->
        <input
          ref="photoInputRef"
          type="file"
          accept="image/*"
          style="display:none"
          @change="onPhotoSelected"
        />

        <!-- URL panel -->
        <v-expand-transition>
          <div v-if="activePanel === 'url'" class="mt-3">
            <!-- Before import: enter the URL -->
            <template v-if="!urlGenerated">
              <v-text-field
                v-model="urlInput"
                label="Recipe URL"
                variant="outlined"
                density="comfortable"
                placeholder="https://www.example.com/recipes/pasta"
                prepend-inner-icon="mdi-link"
                :disabled="urlLoading"
                hide-details
                class="mb-2"
              />
              <v-alert v-if="urlError" type="error" variant="tonal" class="mb-2">{{ urlError }}</v-alert>
              <div class="d-flex ga-2">
                <v-btn color="#00897B" :loading="urlLoading" :disabled="!urlInput.trim()" @click="importFromUrl">Import</v-btn>
                <v-btn variant="text" @click="closePanel">Cancel</v-btn>
              </div>
            </template>

            <!-- After import: review or refine -->
            <template v-else>
              <v-alert type="success" variant="tonal" density="comfortable" class="mb-3">
                Recipe imported! Review the form below, or request changes.
              </v-alert>
              <v-textarea
                v-model="aiRefineInput"
                label="Request changes (optional)"
                variant="outlined"
                density="comfortable"
                rows="2"
                placeholder="e.g. Convert to metric, halve the servings, simplify the steps"
                :disabled="aiRefineLoading"
                hide-details
                class="mb-2"
              />
              <v-alert v-if="aiRefineError" type="error" variant="tonal" class="mb-2">{{ aiRefineError }}</v-alert>
              <div class="d-flex ga-2">
                <v-btn color="#00897B" :loading="aiRefineLoading" :disabled="!aiRefineInput.trim()" @click="refineWithAi">Refine</v-btn>
                <v-btn variant="text" @click="resetUrlPanel">Start Over</v-btn>
                <v-btn variant="text" @click="closePanel">Done</v-btn>
              </div>
            </template>
          </div>
        </v-expand-transition>

        <!-- AI panel -->
        <v-expand-transition>
          <div v-if="activePanel === 'ai'" class="mt-3">
            <!-- Before generation: describe the recipe -->
            <template v-if="!aiGenerated">
              <v-textarea
                v-model="aiInput"
                label="Describe the recipe"
                variant="outlined"
                density="comfortable"
                rows="2"
                placeholder="e.g. A quick chicken stir-fry with vegetables, serves 4"
                :disabled="aiLoading"
                hide-details
                class="mb-2"
              />
              <v-alert v-if="aiError" type="error" variant="tonal" class="mb-2">{{ aiError }}</v-alert>
              <div class="d-flex ga-2">
                <v-btn color="#00897B" :loading="aiLoading" :disabled="!aiInput.trim()" @click="importFromAi">Generate</v-btn>
                <v-btn variant="text" @click="closePanel">Cancel</v-btn>
              </div>
            </template>

            <!-- After generation: refine or done -->
            <template v-else>
              <v-alert type="success" variant="tonal" density="comfortable" class="mb-3">
                Recipe generated! Review the form below, or request changes.
              </v-alert>
              <v-textarea
                v-model="aiRefineInput"
                label="Request changes (optional)"
                variant="outlined"
                density="comfortable"
                rows="2"
                placeholder="e.g. Make it vegetarian, double the servings, simplify the steps"
                :disabled="aiRefineLoading"
                hide-details
                class="mb-2"
              />
              <v-alert v-if="aiRefineError" type="error" variant="tonal" class="mb-2">{{ aiRefineError }}</v-alert>
              <div class="d-flex ga-2">
                <v-btn color="#00897B" :loading="aiRefineLoading" :disabled="!aiRefineInput.trim()" @click="refineWithAi">Refine</v-btn>
                <v-btn variant="text" @click="resetAiPanel">Start Over</v-btn>
                <v-btn variant="text" @click="closePanel">Done</v-btn>
              </div>
            </template>
          </div>
        </v-expand-transition>

        <!-- Photo panel -->
        <v-expand-transition>
          <div v-if="activePanel === 'photo'" class="mt-3">
            <img v-if="photoPreview" :src="photoPreview" class="photo-preview mb-2" alt="Selected photo" />

            <!-- Before extraction: choose / extract -->
            <template v-if="!photoGenerated">
              <v-alert v-if="photoError" type="error" variant="tonal" class="mb-2">{{ photoError }}</v-alert>
              <div class="d-flex ga-2 align-center">
                <v-btn color="#00897B" :loading="photoLoading" :disabled="!photoFile" @click="importFromPhoto">Extract Recipe</v-btn>
                <v-btn variant="text" size="small" prepend-icon="mdi-image" @click="triggerPhotoInput">Choose different</v-btn>
                <v-btn variant="text" @click="closePanel">Cancel</v-btn>
              </div>
            </template>

            <!-- After extraction: review or refine -->
            <template v-else>
              <v-alert type="success" variant="tonal" density="comfortable" class="mb-3">
                Recipe extracted! Review the form below, or request changes.
              </v-alert>
              <v-textarea
                v-model="aiRefineInput"
                label="Request changes (optional)"
                variant="outlined"
                density="comfortable"
                rows="2"
                placeholder="e.g. Fix any misread ingredients, convert to metric, simplify the steps"
                :disabled="aiRefineLoading"
                hide-details
                class="mb-2"
              />
              <v-alert v-if="aiRefineError" type="error" variant="tonal" class="mb-2">{{ aiRefineError }}</v-alert>
              <div class="d-flex ga-2">
                <v-btn color="#00897B" :loading="aiRefineLoading" :disabled="!aiRefineInput.trim()" @click="refineWithAi">Refine</v-btn>
                <v-btn variant="text" @click="resetPhotoPanel">Start Over</v-btn>
                <v-btn variant="text" @click="closePanel">Done</v-btn>
              </div>
            </template>
          </div>
        </v-expand-transition>
      </v-card-text>
    </v-card>

    <!-- AI Edit Assistant (edit mode only) -->
    <v-card v-if="isEdit" rounded="lg" elevation="1" class="mb-4">
      <v-card-title class="d-flex align-center">
        <v-icon color="secondary" start>mdi-chat</v-icon>
        Edit Assistant
        <v-spacer />
        <v-btn
          size="small"
          variant="text"
          :icon="editAiOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'"
          @click="editAiOpen = !editAiOpen"
        />
      </v-card-title>
      <v-expand-transition>
        <div v-if="editAiOpen">
          <v-divider />
          <v-card-text>
            <v-textarea
              v-model="editAiInput"
              label="Describe the changes you want"
              variant="outlined"
              density="comfortable"
              rows="2"
              placeholder="e.g. Make it vegan, reduce cooking time, add more spice, double the servings"
              :disabled="editAiLoading"
              hide-details
              class="mb-2"
            />
            <v-alert v-if="editAiError" type="error" variant="tonal" class="mb-2">{{ editAiError }}</v-alert>
            <div class="d-flex ga-2 mt-2">
              <v-btn color="#00897B" :loading="editAiLoading" :disabled="!editAiInput.trim()" @click="applyAiEdit">
                Apply Changes
              </v-btn>
              <v-btn variant="text" @click="editAiInput = ''; editAiError = ''">Clear</v-btn>
            </div>

            <v-divider class="my-4" />

            <div class="d-flex align-center ga-3 flex-wrap">
              <v-btn
                variant="tonal"
                color="teal"
                prepend-icon="mdi-tag-multiple"
                :loading="retagLoading"
                :disabled="!form.ingredients.length || !form.instructions.length"
                @click="retagWithAi"
              >
                Re-tag ingredient links
              </v-btn>
              <span class="text-caption text-medium-emphasis">
                AI links each ingredient to the step(s) where it's used
              </span>
            </div>
            <v-alert v-if="retagError" type="error" variant="tonal" density="compact" class="mt-2">{{ retagError }}</v-alert>
            <v-alert v-if="retagSuccess" type="success" variant="tonal" density="compact" class="mt-2">Ingredient links updated.</v-alert>
          </v-card-text>
        </div>
      </v-expand-transition>
    </v-card>

    <v-form @submit.prevent="save">
      <!-- Basic info -->
      <v-card rounded="lg" elevation="1" class="mb-4">
        <v-card-title>Details</v-card-title>
        <v-divider />
        <v-card-text>
          <v-text-field
            v-model="form.title"
            label="Recipe title"
            variant="outlined"
            density="comfortable"
            class="mb-3"
            :rules="[v => !!v || 'Title is required']"
          />
          <v-textarea
            v-model="form.description"
            label="Description (optional)"
            variant="outlined"
            rows="2"
            class="mb-3"
          />
          <v-text-field
            v-model="form.sourceUrl"
            label="Source URL (optional)"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-link"
            class="mb-3"
          />
          <v-text-field
            v-model="form.imageUrl"
            label="Image URL (optional)"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-image-outline"
            class="mb-3"
          />
          <v-row dense>
            <v-col cols="4">
              <v-text-field
                v-model.number="form.servings"
                label="Servings"
                type="number"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model.number="form.prepTimeMins"
                label="Prep (min)"
                type="number"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model.number="form.cookTimeMins"
                label="Cook (min)"
                type="number"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
          </v-row>
          <v-combobox
            v-model="form.tags"
            label="Tags (optional)"
            variant="outlined"
            multiple
            chips
            closable-chips
            hint="e.g. dinner, pasta, quick"
            persistent-hint
            class="mt-3"
          />
        </v-card-text>
      </v-card>

      <!-- Ingredients -->
      <v-card rounded="lg" elevation="1" class="mb-4">
        <v-card-title class="d-flex align-center">
          Ingredients
          <v-spacer />
          <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="addIngredient">Add</v-btn>
        </v-card-title>
        <v-divider />
        <v-card-text>
          <div
            v-for="(ing, i) in form.ingredients"
            :key="i"
            class="d-flex align-center ga-2 mb-2"
          >
            <v-text-field
              v-model="ing.amount"
              label="Amount"
              variant="outlined"
              density="compact"
              style="max-width:80px"
              hide-details
            />
            <v-text-field
              v-model="ing.unit"
              label="Unit"
              variant="outlined"
              density="compact"
              style="max-width:90px"
              hide-details
            />
            <v-text-field
              v-model="ing.name"
              label="Ingredient"
              variant="outlined"
              density="compact"
              hide-details
              class="flex-grow-1"
            />
            <v-btn icon="mdi-close" size="x-small" variant="text" color="error" @click="removeIngredient(i)" />
          </div>
          <div v-if="!form.ingredients.length" class="text-body-2 text-medium-emphasis py-2">
            No ingredients yet. Click Add to start.
          </div>
        </v-card-text>
      </v-card>

      <!-- Instructions -->
      <v-card rounded="lg" elevation="1" class="mb-4">
        <v-card-title class="d-flex align-center">
          Instructions
          <v-spacer />
          <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="addStep">Add Step</v-btn>
        </v-card-title>
        <v-divider />
        <v-card-text>
          <div
            v-for="(step, i) in form.instructions"
            :key="i"
            class="mb-5"
          >
            <div class="d-flex align-start ga-2 mb-2">
              <div class="step-num text-body-2 font-weight-bold text-medium-emphasis">{{ i + 1 }}.</div>
              <v-textarea
                v-model="form.instructions[i]"
                :label="`Step ${i + 1}`"
                variant="outlined"
                density="compact"
                rows="2"
                auto-grow
                hide-details
                class="flex-grow-1"
              />
              <v-btn icon="mdi-close" size="x-small" variant="text" color="error" @click="removeStep(i)" />
            </div>
            <StepIngredientLinker
              v-if="form.ingredients.length"
              v-model="form.linkedIds[i]"
              :ingredients="form.ingredients"
              :assignments-by-id="assignmentsById"
              :step-number="i + 1"
              :step-text="form.instructions[i]"
            />
          </div>
          <div v-if="!form.instructions.length" class="text-body-2 text-medium-emphasis py-2">
            No steps yet. Click Add Step to start.
          </div>
        </v-card-text>
      </v-card>

      <!-- Orphan warning — shown once, near Save -->
      <v-alert
        v-if="orphanIngredients.length"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-4"
      >
        {{ orphanIngredients.length === 1 ? '1 ingredient is' : `${orphanIngredients.length} ingredients are` }}
        not linked to any step:
        <strong>{{ orphanIngredients.map(i => i.name).join(', ') }}</strong>
      </v-alert>

      <v-alert v-if="saveError" type="error" variant="tonal" class="mb-4">{{ saveError }}</v-alert>

      <div class="d-flex ga-3 align-center">
        <v-btn type="submit" color="#00897B" size="large" :loading="saving">
          {{ isEdit ? 'Save Changes' : 'Create Recipe' }}
        </v-btn>
        <v-btn
          v-if="isEdit"
          type="button"
          variant="tonal"
          color="#00897B"
          size="large"
          :loading="savingAsNew"
          @click="saveAsNew"
        >
          Save as New Recipe
        </v-btn>
        <v-btn variant="text" @click="goBack">Cancel</v-btn>
        <v-spacer />
        <v-btn
          v-if="isEdit"
          variant="text"
          color="error"
          prepend-icon="mdi-delete"
          @click="deleteDialog = true"
        >
          Delete
        </v-btn>
      </div>
    </v-form>

    <!-- Delete confirmation -->
    <v-dialog v-model="deleteDialog" max-width="360">
      <v-card rounded="xl">
        <v-card-title class="pt-5">Delete recipe?</v-card-title>
        <v-card-text>
          <strong>{{ form.title || 'This recipe' }}</strong> will be permanently removed.
        </v-card-text>
        <v-alert v-if="deleteError" type="error" variant="tonal" density="compact" class="mx-4 mb-2">
          {{ deleteError }}
        </v-alert>
        <v-card-actions class="px-4 pb-4">
          <v-spacer />
          <v-btn @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" :loading="deleteLoading" @click="doDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    </template>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { recipesApi } from '../services/api';
import StepIngredientLinker from '../components/StepIngredientLinker.vue';
import { useSmartBack, useReturnTo } from '../composables/useSmartBack';

const route  = useRoute();
const router = useRouter();
const goBack = useSmartBack();
const returnTo = useReturnTo();

const isEdit      = computed(() => !!route.params.id);
const pageLoading = ref(false);
const saving      = ref(false);
const savingAsNew = ref(false);
const saveError   = ref('');

// Import panels — one active at a time
const activePanel = ref(null); // 'url' | 'ai' | 'photo' | null

function openPanel(name) { activePanel.value = name; }
function closePanel() {
  activePanel.value    = null;
  urlInput.value       = '';
  urlError.value       = '';
  urlGenerated.value   = false;
  aiInput.value        = '';
  aiError.value        = '';
  aiGenerated.value    = false;
  aiRefineInput.value  = '';
  aiRefineError.value  = '';
  photoFile.value      = null;
  photoPreview.value   = '';
  photoError.value     = '';
  photoGenerated.value = false;
  if (photoInputRef.value) photoInputRef.value.value = '';
}

// URL import — extracts recipe into the form for review (no save), like Ask AI
const urlInput     = ref('');
const urlLoading   = ref(false);
const urlError     = ref('');
const urlGenerated = ref(false);

async function importFromUrl() {
  urlError.value = '';
  urlLoading.value = true;
  try {
    const { data } = await recipesApi.fromUrl(urlInput.value.trim());
    populateForm(data);
    form.value.sourceUrl = urlInput.value.trim();
    urlGenerated.value = true;
  } catch (e) {
    urlError.value = e.response?.data?.error || 'Failed to import recipe.';
  } finally {
    urlLoading.value = false;
  }
}

function resetUrlPanel() {
  urlGenerated.value  = false;
  urlInput.value      = '';
  urlError.value      = '';
  aiRefineInput.value = '';
  aiRefineError.value = '';
}

// AI import — generates recipe into the form without saving
const aiInput        = ref('');
const aiLoading      = ref(false);
const aiError        = ref('');
const aiGenerated    = ref(false);
const aiRefineInput  = ref('');
const aiRefineLoading = ref(false);
const aiRefineError  = ref('');

async function importFromAi() {
  aiError.value = '';
  aiLoading.value = true;
  try {
    const { data } = await recipesApi.generateFromAi(aiInput.value.trim());
    populateForm(data);
    aiGenerated.value = true;
  } catch (e) {
    aiError.value = e.response?.data?.error || 'Failed to generate recipe.';
  } finally {
    aiLoading.value = false;
  }
}

function resetAiPanel() {
  aiGenerated.value   = false;
  aiInput.value       = '';
  aiError.value       = '';
  aiRefineInput.value = '';
  aiRefineError.value = '';
}

async function refineWithAi() {
  aiRefineError.value   = '';
  aiRefineLoading.value = true;
  try {
    const payload = {
      ...form.value,
      ingredients: form.value.ingredients.map(({ _lid, ...rest }) => rest),
    };
    const { data } = await recipesApi.editWithAi(payload, aiRefineInput.value.trim());
    populateForm(data);
    aiRefineInput.value = '';
  } catch (e) {
    aiRefineError.value = e.response?.data?.error || 'Failed to refine recipe.';
  } finally {
    aiRefineLoading.value = false;
  }
}

// Photo import
const photoInputRef  = ref(null);
const photoFile      = ref(null);
const photoPreview   = ref('');
const photoLoading   = ref(false);
const photoError     = ref('');
const photoGenerated = ref(false);

function triggerPhotoInput() {
  photoInputRef.value?.click();
}

function onPhotoSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  photoFile.value    = file;
  photoPreview.value = URL.createObjectURL(file);
  photoError.value   = '';
  activePanel.value  = 'photo';
}

async function importFromPhoto() {
  photoError.value   = '';
  photoLoading.value = true;
  try {
    const { data } = await recipesApi.fromPhoto(photoFile.value);
    populateForm(data);
    photoGenerated.value = true;
  } catch (e) {
    photoError.value = e.response?.data?.error || 'Failed to extract recipe from photo.';
  } finally {
    photoLoading.value = false;
  }
}

function resetPhotoPanel() {
  photoGenerated.value = false;
  photoFile.value      = null;
  photoPreview.value   = '';
  photoError.value     = '';
  aiRefineInput.value  = '';
  aiRefineError.value  = '';
  if (photoInputRef.value) photoInputRef.value.value = '';
}

// AI Edit Assistant (edit mode)
const editAiOpen    = ref(false);
const editAiInput   = ref('');
const editAiLoading = ref(false);
const editAiError   = ref('');
const retagLoading  = ref(false);
const retagError    = ref('');
const retagSuccess  = ref(false);

async function applyAiEdit() {
  editAiError.value   = '';
  editAiLoading.value = true;
  try {
    // Send plain form data (strip _lid before sending to AI)
    const payload = {
      ...form.value,
      ingredients: form.value.ingredients.map(({ _lid, ...rest }) => rest),
    };
    const { data } = await recipesApi.editWithAi(payload, editAiInput.value.trim());
    populateForm(data);
    editAiInput.value = '';
  } catch (e) {
    editAiError.value = e.response?.data?.error || 'Failed to apply changes.';
  } finally {
    editAiLoading.value = false;
  }
}

async function retagWithAi() {
  retagError.value   = '';
  retagSuccess.value = false;
  retagLoading.value = true;
  try {
    const { data } = await recipesApi.computeIngredientTags(
      form.value.ingredients,
      form.value.instructions,
    );
    // Server returns [[Number]] (indices); convert to _lid[][] for in-memory model
    const ings = form.value.ingredients;
    form.value.linkedIds = (data.instructionIngredients || []).map(indices =>
      (indices || []).map(idx => ings[idx]?._lid).filter(Boolean)
    );
    // Pad if server returned fewer step arrays than we have steps
    while (form.value.linkedIds.length < form.value.instructions.length) {
      form.value.linkedIds.push([]);
    }
    retagSuccess.value = true;
    setTimeout(() => { retagSuccess.value = false; }, 3000);
  } catch (e) {
    retagError.value = e.response?.data?.error || 'Failed to compute ingredient links.';
  } finally {
    retagLoading.value = false;
  }
}

// ---------------------------------------------------------------------------
// Stable per-ingredient link IDs (_lid) — client-side only, never persisted.
// Prevents index-corruption when ingredients are added/removed/reordered.
// At save time we convert _lid[] back to [[Number]] for the API.
// ---------------------------------------------------------------------------
let _lidCounter = 0;
function makeLid() { return `_l${++_lidCounter}`; }

function attachLids(ingredients) {
  return (ingredients || []).map(ing => ({ ...ing, _lid: makeLid() }));
}

// form.linkedIds[stepIdx] = string[] of _lid values linked to that step
const form = ref({
  title: '',
  description: '',
  sourceUrl: '',
  imageUrl: '',
  servings: null,
  prepTimeMins: null,
  cookTimeMins: null,
  tags: [],
  ingredients: [],   // items have _lid attached client-side
  instructions: [],
  linkedIds: [],     // string[][] — _lid refs per step
});

// Recipe-wide: _lid -> [1-based step numbers it appears in]
const assignmentsById = computed(() => {
  const map = {};
  form.value.ingredients.forEach(i => { map[i._lid] = []; });
  form.value.linkedIds.forEach((lids, idx) => {
    (lids || []).forEach(lid => {
      if (map[lid]) map[lid].push(idx + 1);
    });
  });
  return map;
});

const orphanIngredients = computed(() =>
  form.value.ingredients.filter(
    i => i.name.trim() && (assignmentsById.value[i._lid]?.length ?? 0) === 0
  )
);

function populateForm(data) {
  if (data.title)                     form.value.title        = data.title;
  if (data.description !== undefined) form.value.description  = data.description;
  if (data.servings !== undefined)    form.value.servings     = data.servings;
  if (data.prepTimeMins !== undefined) form.value.prepTimeMins = data.prepTimeMins;
  if (data.cookTimeMins !== undefined) form.value.cookTimeMins = data.cookTimeMins;
  if (data.imageUrl)                  form.value.imageUrl     = data.imageUrl;
  if (data.tags)                      form.value.tags         = data.tags;

  if (data.ingredients) {
    form.value.ingredients = attachLids(data.ingredients);
  }

  if (data.instructions) {
    form.value.instructions = data.instructions;
    // Convert [[Number]] → [[_lid]] using the current ingredient list
    const ingWithLids = form.value.ingredients;
    const incoming = data.instructionIngredients;
    if (Array.isArray(incoming)) {
      form.value.linkedIds = data.instructions.map((_, si) =>
        (incoming[si] || [])
          .map(idx => ingWithLids[idx]?._lid)
          .filter(Boolean)
      );
    } else {
      form.value.linkedIds = data.instructions.map(() => []);
    }
  }
}

function addIngredient() {
  form.value.ingredients.push({ amount: '', unit: '', name: '', _lid: makeLid() });
}
function removeIngredient(rmIdx) {
  const lid = form.value.ingredients[rmIdx]?._lid;
  form.value.ingredients.splice(rmIdx, 1);
  // Drop this _lid from every step's link list
  if (lid) {
    form.value.linkedIds = form.value.linkedIds.map(lids =>
      (lids || []).filter(l => l !== lid)
    );
  }
}
function addStep() {
  form.value.instructions.push('');
  form.value.linkedIds.push([]);
}
function removeStep(i) {
  form.value.instructions.splice(i, 1);
  form.value.linkedIds.splice(i, 1);
}

// Delete (edit mode only)
const deleteDialog  = ref(false);
const deleteLoading = ref(false);
const deleteError   = ref('');

async function doDelete() {
  deleteError.value = '';
  deleteLoading.value = true;
  try {
    await recipesApi.delete(route.params.id);
    returnTo('/recipes');
  } catch (e) {
    deleteError.value = e.response?.data?.error || 'Failed to delete recipe.';
  } finally {
    deleteLoading.value = false;
  }
}

// Build the API payload from the current form (strips _lid, filters empties,
// converts linkedIds → [[Number]] indices).
function buildPayload() {
  // Build index map for ingredients that survive the name-filter
  const keptIngs = form.value.ingredients.filter(i => i.name.trim());
  const lidToNewIdx = Object.fromEntries(keptIngs.map((ing, idx) => [ing._lid, idx]));

  // Build step list filtering empty text
  const keptStepIndices = form.value.instructions
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.trim())
    .map(({ i }) => i);

  return {
    title:        form.value.title,
    description:  form.value.description,
    sourceUrl:    form.value.sourceUrl,
    imageUrl:     form.value.imageUrl,
    servings:     form.value.servings,
    prepTimeMins: form.value.prepTimeMins,
    cookTimeMins: form.value.cookTimeMins,
    tags:         form.value.tags,
    // Strip _lid before sending — server schema has { _id: false }
    ingredients:  keptIngs.map(({ _lid, ...rest }) => rest),
    instructions: keptStepIndices.map(i => form.value.instructions[i]),
    // Convert _lid[][] → [[Number]] for the API
    instructionIngredients: keptStepIndices.map(i =>
      (form.value.linkedIds[i] || [])
        .filter(lid => lid in lidToNewIdx)
        .map(lid => lidToNewIdx[lid])
    ),
  };
}

async function save() {
  saveError.value = '';
  if (!form.value.title.trim()) {
    saveError.value = 'Title is required.';
    return;
  }
  saving.value = true;
  try {
    const payload = buildPayload();
    if (isEdit.value) {
      await recipesApi.update(route.params.id, payload);
      returnTo(`/recipes/${route.params.id}`);
    } else {
      const { data } = await recipesApi.create({ ...payload, source: 'manual' });
      returnTo(`/recipes/${data._id}`);
    }
  } catch (e) {
    saveError.value = e.response?.data?.error || 'Save failed.';
  } finally {
    saving.value = false;
  }
}

// Save the current form as a brand-new recipe, leaving the original untouched.
async function saveAsNew() {
  saveError.value = '';
  if (!form.value.title.trim()) {
    saveError.value = 'Title is required.';
    return;
  }
  savingAsNew.value = true;
  try {
    const { data } = await recipesApi.create({ ...buildPayload(), source: 'manual' });
    returnTo(`/recipes/${data._id}`);
  } catch (e) {
    saveError.value = e.response?.data?.error || 'Save failed.';
  } finally {
    savingAsNew.value = false;
  }
}

onMounted(async () => {
  if (!isEdit.value) return;
  pageLoading.value = true;
  try {
    const { data } = await recipesApi.get(route.params.id);
    populateForm(data);
  } finally {
    pageLoading.value = false;
  }
});
</script>

<style scoped>
.step-num {
  min-width: 20px;
  padding-top: 10px;
}
.photo-preview {
  display: block;
  max-width: 100%;
  max-height: 220px;
  border-radius: 8px;
  object-fit: contain;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
</style>
