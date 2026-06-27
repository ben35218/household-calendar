<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  modelValue:      { type: Array,  default: () => [] },    // _lid[] linked to this step
  ingredients:     { type: Array,  required: true },       // all recipe ingredients (with _lid)
  assignmentsById: { type: Object, default: () => ({}) },  // _lid -> step numbers (1-based)
  stepNumber:      { type: Number, required: true },
  stepText:        { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const showBrowse  = ref(false);
const searchQuery = ref('');

const byId = computed(() =>
  Object.fromEntries(props.ingredients.map(i => [i._lid, i]))
);

const linked = computed(() =>
  props.modelValue.map(lid => byId.value[lid]).filter(Boolean)
);

const unassigned = computed(() =>
  props.ingredients.filter(i => (props.assignmentsById[i._lid]?.length ?? 0) === 0)
);

function rootWords(name) {
  return String(name)
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function isMentioned(ing) {
  const text = props.stepText.toLowerCase();
  return rootWords(ing.name).some(w => text.includes(w));
}

const unassignedSorted = computed(() =>
  [...unassigned.value].sort((a, b) => Number(isMentioned(b)) - Number(isMentioned(a)))
);

const browseList = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  return q
    ? props.ingredients.filter(i => i.name.toLowerCase().includes(q))
    : props.ingredients;
});

function isLinked(lid) {
  return props.modelValue.includes(lid);
}

function amountLabel(ing) {
  return [ing.amount, ing.unit].filter(Boolean).join(' ');
}

function statusOf(ing) {
  const steps = props.assignmentsById[ing._lid] || [];
  if (isLinked(ing._lid)) {
    const others = steps.filter(s => s !== props.stepNumber);
    return others.length ? `also step ${others.join(', ')}` : 'in this step';
  }
  return steps.length ? `step ${steps.join(', ')}` : 'unassigned';
}

function link(lid) {
  if (!props.modelValue.includes(lid))
    emit('update:modelValue', [...props.modelValue, lid]);
}
function unlink(lid) {
  emit('update:modelValue', props.modelValue.filter(x => x !== lid));
}
function toggle(lid) {
  isLinked(lid) ? unlink(lid) : link(lid);
}
</script>

<template>
  <div class="sil">
    <!-- Zone 1: linked ingredients -->
    <div class="sil-label">In this step</div>
    <div class="sil-chips">
      <v-chip
        v-for="ing in linked"
        :key="ing._lid"
        color="primary"
        variant="tonal"
        size="small"
        closable
        :aria-label="`Remove ${ing.name} from this step`"
        @click:close="unlink(ing._lid)"
      >
        <span v-if="amountLabel(ing)" class="sil-amount">{{ amountLabel(ing) }}</span>
        {{ ing.name }}
      </v-chip>
      <span v-if="!linked.length" class="sil-empty">Nothing linked yet</span>
    </div>

    <!-- Zone 2: unassigned worklist -->
    <div class="sil-label mt-3">Unassigned</div>
    <div class="sil-chips">
      <template v-if="unassigned.length">
        <v-chip
          v-for="ing in unassignedSorted"
          :key="ing._lid"
          :color="isMentioned(ing) ? 'warning' : undefined"
          variant="outlined"
          size="small"
          :aria-label="`Add ${ing.name} to this step`"
          class="sil-addable"
          @click="link(ing._lid)"
        >
          <template #prepend>
            <v-icon size="14" class="mr-1">
              {{ isMentioned(ing) ? 'mdi-creation' : 'mdi-plus' }}
            </v-icon>
          </template>
          {{ ing.name }}
        </v-chip>
      </template>
      <span v-else class="sil-done">
        <v-icon size="16" color="success" class="mr-1">mdi-check-circle</v-icon>
        Every ingredient is used in a step
      </span>
    </div>

    <!-- Zone 3: browse all -->
    <div class="mt-3">
      <v-btn
        variant="text"
        size="x-small"
        density="compact"
        :prepend-icon="showBrowse ? 'mdi-chevron-up' : 'mdi-magnify'"
        class="sil-browse-btn"
        @click="showBrowse = !showBrowse"
      >
        Browse all ingredients
      </v-btn>

      <v-expand-transition>
        <v-card v-show="showBrowse" variant="outlined" class="mt-2">
          <v-text-field
            v-model="searchQuery"
            density="compact"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-magnify"
            placeholder="Search…"
            aria-label="Search all ingredients"
            class="ma-2"
          />
          <v-list density="compact" class="py-0">
            <v-list-item
              v-for="ing in browseList"
              :key="ing._lid"
              :aria-label="`${isLinked(ing._lid) ? 'Remove' : 'Add'} ${ing.name}`"
              class="sil-browse-row"
              @click="toggle(ing._lid)"
            >
              <template #prepend>
                <v-icon :color="isLinked(ing._lid) ? 'primary' : undefined" size="20">
                  {{ isLinked(ing._lid) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                </v-icon>
              </template>
              <template #title>
                <span :class="{ 'text-primary': isLinked(ing._lid) }">
                  <span v-if="amountLabel(ing)" class="sil-amount">{{ amountLabel(ing) }}</span>
                  {{ ing.name }}
                </span>
              </template>
              <template #append>
                <span class="sil-status" :class="{ 'sil-status--active': isLinked(ing._lid) }">
                  {{ statusOf(ing) }}
                </span>
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-expand-transition>
    </div>
  </div>
</template>

<style scoped>
.sil {
  padding-left: 28px;
}
.sil-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.55;
  margin-bottom: 6px;
}
.sil-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: 28px;
}
.sil-amount {
  opacity: 0.6;
  font-size: 11px;
  margin-right: 4px;
}
.sil-empty {
  font-size: 12px;
  font-style: italic;
  opacity: 0.45;
}
.sil-done {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: rgb(var(--v-theme-success));
}
.sil-addable {
  cursor: pointer;
}
.sil-browse-btn {
  opacity: 0.6;
}
.sil-browse-btn:hover {
  opacity: 1;
}
.sil-browse-row {
  cursor: pointer;
}
.sil-status {
  font-size: 11px;
  opacity: 0.5;
}
.sil-status--active {
  color: rgb(var(--v-theme-primary));
  opacity: 1;
}
</style>
