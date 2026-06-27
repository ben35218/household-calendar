<template>
  <v-dialog v-model="model" fullscreen :scrim="false" transition="fade-transition">
    <div
      class="cooking-overlay d-flex flex-column"
      @touchstart.passive="onSwipeTouchStart"
      @touchend.passive="onSwipeTouchEnd"
    >
      <!-- Top bar: wake indicator + close -->
      <div class="d-flex align-center justify-space-between px-5 pt-5 pb-2 flex-shrink-0">
        <div class="d-flex align-center ga-2">
          <v-icon size="16" color="#26A69A">mdi-brightness-5</v-icon>
          <span class="text-caption co-muted">Screen stays on</span>
        </div>
        <v-btn icon="mdi-close" variant="text" color="white" density="comfortable" @click="exit" />
      </div>

      <!-- Progress: Step X of N + segmented bar -->
      <div class="px-5 pt-1 pb-3 flex-shrink-0">
        <div class="d-flex align-center justify-space-between mb-2">
          <span class="text-body-2 font-weight-bold co-white">Step {{ currentStep + 1 }}</span>
          <span class="text-caption co-muted">of {{ steps.length }}</span>
        </div>
        <div class="co-progress-bar">
          <div
            v-for="(_, i) in steps"
            :key="i"
            class="co-segment"
            :class="{
              'co-segment--done': i < currentStep,
              'co-segment--active': i === currentStep,
            }"
          />
        </div>
      </div>

      <!-- Ingredient chips for this step -->
      <div v-if="stepIngredients.length" class="px-5 pb-3 d-flex flex-wrap ga-2 flex-shrink-0">
        <v-chip
          v-for="ing in stepIngredients"
          :key="ing.name"
          :color="checkedIngredients.has(ing.name) ? 'default' : 'warning'"
          :variant="checkedIngredients.has(ing.name) ? 'outlined' : 'tonal'"
          size="small"
          :prepend-icon="checkedIngredients.has(ing.name) ? 'mdi-check-circle' : 'mdi-checkbox-blank-outline'"
          :class="{ 'text-decoration-line-through': checkedIngredients.has(ing.name) }"
          style="opacity: 1; cursor: pointer"
          @click="toggleIngredient(ing.name)"
        >
          {{ formatIngredient(ing) }}
        </v-chip>
      </div>

      <!-- Step text (grows to fill available space) -->
      <div class="co-step-body px-5 flex-grow-1 d-flex align-center">
        <p class="co-step-text">{{ steps[currentStep] }}</p>
      </div>

      <!-- Current step inline timer -->
      <div v-if="currentTimer" class="co-timer d-flex align-center mx-5 mb-4 px-4 py-3 rounded-lg flex-shrink-0">
        <v-icon color="white" class="mr-3" size="20">mdi-timer-outline</v-icon>
        <input
          v-if="editingTimer"
          ref="timerInputRef"
          v-model="editingTimerValue"
          class="co-timer-input"
          @blur="commitEditTimer"
          @keydown.enter.prevent="commitEditTimer"
          @keydown.escape="editingTimer = false"
        />
        <span
          v-else
          class="co-timer-display co-white"
          :class="{ 'co-timer-editable': !currentTimer.running && !currentTimer.done }"
          :title="!currentTimer.running && !currentTimer.done ? 'Click to edit time' : undefined"
          @click="startEditTimer"
        >{{ formatSeconds(currentTimer.secondsLeft) }}</span>
        <span v-if="currentTimer.label && !editingTimer" class="text-caption co-muted ml-2">{{ currentTimer.label }}</span>
        <v-spacer />
        <v-btn
          :color="currentTimer.done ? 'success' : '#00897B'"
          size="small"
          rounded="lg"
          @click="toggleTimer(currentStep)"
        >
          <v-icon start size="14">{{ currentTimer.done ? 'mdi-check' : currentTimer.running ? 'mdi-pause' : 'mdi-play' }}</v-icon>
          {{ currentTimer.done ? 'Done!' : currentTimer.running ? 'Pause' : currentTimer.secondsLeft < currentTimer.totalSeconds ? 'Resume' : 'Start' }}
        </v-btn>
      </div>

      <!-- Persistent timers from other steps -->
      <div v-if="otherActiveTimers.length" class="co-running-timers px-5 pb-3 flex-shrink-0">
        <div class="d-flex flex-wrap ga-2">
          <div
            v-for="t in otherActiveTimers"
            :key="t.stepIdx"
            class="co-persist-timer d-flex align-center ga-2 px-3 py-2 rounded-lg"
            :class="{ 'co-persist-timer--done': t.done }"
          >
            <div class="co-persist-jump d-flex align-center ga-2" title="Go to this step" @click="currentStep = t.stepIdx">
              <v-icon size="14" :color="t.done ? '#66BB6A' : '#26A69A'">
                {{ t.done ? 'mdi-check-circle' : 'mdi-timer-outline' }}
              </v-icon>
              <span class="text-caption co-muted">Step {{ t.stepIdx + 1 }}</span>
              <span class="co-persist-time" :class="{ 'co-persist-time--done': t.done }">
                {{ t.done ? 'Done!' : formatSeconds(t.secondsLeft) }}
              </span>
            </div>
            <v-btn
              density="compact"
              variant="text"
              size="x-small"
              :color="t.done ? 'success' : t.running ? '#26A69A' : 'grey'"
              :icon="t.done ? 'mdi-refresh' : t.running ? 'mdi-pause' : 'mdi-play'"
              @click="toggleTimer(t.stepIdx)"
            />
          </div>
        </div>
      </div>

      <!-- Navigation: prev | dots | next -->
      <div class="co-nav d-flex align-center justify-space-between px-5 flex-shrink-0" style="padding-bottom: 68px; padding-top: 16px;">
        <v-btn
          icon
          variant="outlined"
          :style="{ borderColor: currentStep === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)' }"
          :disabled="currentStep === 0"
          size="large"
          @click="prevStep"
        >
          <v-icon color="white">mdi-chevron-left</v-icon>
        </v-btn>

        <div class="d-flex align-center ga-1">
          <div
            v-for="idx in dotIndices"
            :key="idx"
            class="co-dot"
            :class="{ 'co-dot--active': idx === currentStep }"
          />
        </div>

        <v-btn
          color="#00897B"
          size="large"
          rounded="lg"
          class="px-5"
          @click="nextOrFinish"
        >
          {{ currentStep < steps.length - 1 ? 'Next step' : 'Finish' }}
          <v-icon end size="18">mdi-chevron-right</v-icon>
        </v-btn>
      </div>

      <!-- Scrim: covers step content when sheet is expanded -->
      <div
        v-if="sheetExpanded && sheetLiveY === null"
        class="sheet-scrim"
        @click="sheetExpanded = false"
      />

      <!-- Ingredient bottom sheet -->
      <div
        ref="sheetRef"
        class="ingredient-sheet"
        :style="sheetStyle"
        @touchstart.stop
        @touchend.stop
      >
        <!-- Drag handle -->
        <div
          class="sheet-handle"
          @pointerdown="onHandlePointerDown"
          @pointermove="onHandlePointerMove"
          @pointerup="onHandlePointerUp"
          @pointercancel="onHandlePointerUp"
        >
          <div class="sheet-drag-bar" />
          <div class="d-flex align-center justify-space-between px-5 pb-3">
            <span class="text-body-2 font-weight-bold co-white">Ingredients</span>
            <span v-if="checkedIngredients.size > 0" class="text-caption co-muted">
              {{ checkedIngredients.size }}/{{ ingredients.length }} prepped
            </span>
            <v-icon size="18" :color="sheetExpanded ? '#26A69A' : 'rgba(255,255,255,0.4)'">
              {{ sheetExpanded ? 'mdi-chevron-down' : 'mdi-chevron-up' }}
            </v-icon>
          </div>
        </div>

        <!-- Scrollable ingredient list -->
        <div class="sheet-content">
          <div
            v-for="ing in ingredients"
            :key="ing.name"
            class="sheet-ing-row"
            @click="toggleIngredient(ing.name)"
          >
            <v-icon
              size="20"
              :color="checkedIngredients.has(ing.name) ? '#00897B' : 'rgba(255,255,255,0.3)'"
              class="flex-shrink-0"
            >
              {{ checkedIngredients.has(ing.name) ? 'mdi-check-circle' : 'mdi-circle-outline' }}
            </v-icon>
            <span
              class="sheet-ing-text"
              :class="{ 'sheet-ing-text--done': checkedIngredients.has(ing.name) }"
            >
              {{ formatIngredient(ing) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<script setup>
import { ref, computed, reactive, watch, onUnmounted, nextTick } from 'vue';

const props = defineProps({
  recipe: { type: Object, default: null },
});

const model = defineModel({ type: Boolean, default: false });

const steps = computed(() => props.recipe?.instructions ?? []);
const ingredients = computed(() => props.recipe?.ingredients ?? []);

const currentStep = ref(0);

// --- Ingredient matching ---
function matchIngredients(stepText, allIngredients) {
  const text = stepText.toLowerCase();
  return allIngredients.filter(ing => {
    const name = ing.name.toLowerCase();
    if (text.includes(name)) return true;
    const words = name.split(/\s+/).filter(w => w.length > 3);
    return words.length > 0 && words.some(w => text.includes(w));
  });
}

const stepIngredients = computed(() => {
  const stepIdx = currentStep.value;
  const tagged = props.recipe?.instructionIngredients?.[stepIdx];
  if (Array.isArray(tagged)) {
    // Use AI-tagged indices (may be [] for steps with no specific ingredients)
    return tagged.map(i => ingredients.value[i]).filter(Boolean);
  }
  // Tags not yet available — fall back to text matching
  return steps.value[stepIdx]
    ? matchIngredients(steps.value[stepIdx], ingredients.value)
    : [];
});

function formatIngredient(ing) {
  const qty = [ing.amount, ing.unit].filter(Boolean).join(' ');
  return qty ? `${qty} ${ing.name}` : ing.name;
}

// --- Ingredient check state (session-persisted) ---
const checkedIngredients = reactive(new Set());

function toggleIngredient(name) {
  if (checkedIngredients.has(name)) {
    checkedIngredients.delete(name);
  } else {
    checkedIngredients.add(name);
  }
}

// --- Timer parsing ---
function parseTimer(stepText) {
  const match = stepText.match(/(\d+(?:\.\d+)?)\s*(hour|hr|minute|min|second|sec)s?/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'hour' || unit === 'hr') return Math.round(val * 3600);
  if (unit === 'minute' || unit === 'min') return Math.round(val * 60);
  return Math.round(val);
}

function extractTimerLabel(stepText) {
  const m = stepText.match(/\b(\w+)\s+for\s+\d/i);
  if (m) return m[1].toLowerCase();
  const m2 = stepText.match(/\d+\s*(?:minute|hour|second)s?\s+(?:to|until)\s+(\w+)/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

// --- Timer state ---
const timers = reactive({});

function initTimer(stepIdx) {
  if (stepIdx in timers) return;
  const total = parseTimer(steps.value[stepIdx] ?? '');
  if (total !== null) {
    timers[stepIdx] = {
      totalSeconds: total,
      secondsLeft: total,
      running: false,
      done: false,
      label: extractTimerLabel(steps.value[stepIdx] ?? ''),
    };
  }
}

watch(currentStep, (idx) => initTimer(idx));

const currentTimer = computed(() => timers[currentStep.value] ?? null);

const otherActiveTimers = computed(() =>
  Object.entries(timers)
    .filter(([i, t]) => Number(i) !== currentStep.value && (t.running || t.done))
    .map(([i, t]) => ({ stepIdx: Number(i), ...t }))
    .sort((a, b) => a.stepIdx - b.stepIdx)
);

let globalInterval = null;

function ensureInterval() {
  if (globalInterval) return;
  globalInterval = setInterval(() => {
    let anyRunning = false;
    for (const t of Object.values(timers)) {
      if (t.running) {
        anyRunning = true;
        if (t.secondsLeft <= 1) {
          t.secondsLeft = 0;
          t.running = false;
          t.done = true;
        } else {
          t.secondsLeft--;
        }
      }
    }
    if (!anyRunning) {
      clearInterval(globalInterval);
      globalInterval = null;
    }
  }, 1000);
}

function stopInterval() {
  clearInterval(globalInterval);
  globalInterval = null;
}

function toggleTimer(stepIdx) {
  const t = timers[stepIdx];
  if (!t) return;
  if (t.done) {
    t.secondsLeft = t.totalSeconds;
    t.done = false;
    t.running = false;
    return;
  }
  t.running = !t.running;
  if (t.running) ensureInterval();
}

// --- Timer editing ---
const editingTimer = ref(false);
const editingTimerValue = ref('');
const timerInputRef = ref(null);

function parseTimeInput(str) {
  const s = str.trim();
  const colonMatch = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colonMatch) {
    const a = parseInt(colonMatch[1]);
    const b = parseInt(colonMatch[2]);
    const c = colonMatch[3] !== undefined ? parseInt(colonMatch[3]) : null;
    return c !== null ? a * 3600 + b * 60 + c : a * 60 + b;
  }
  const num = parseFloat(s);
  return !isNaN(num) && num > 0 ? Math.round(num * 60) : 0;
}

async function startEditTimer() {
  const t = currentTimer.value;
  if (!t || t.running || t.done) return;
  editingTimerValue.value = formatSeconds(t.secondsLeft);
  editingTimer.value = true;
  await nextTick();
  timerInputRef.value?.focus();
  timerInputRef.value?.select();
}

function commitEditTimer() {
  const t = currentTimer.value;
  if (t) {
    const secs = parseTimeInput(editingTimerValue.value);
    if (secs > 0) {
      t.totalSeconds = secs;
      t.secondsLeft = secs;
    }
  }
  editingTimer.value = false;
}

watch(currentStep, () => { editingTimer.value = false; });

function formatSeconds(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// --- Navigation ---
function prevStep() {
  if (currentStep.value > 0) currentStep.value--;
}

function nextOrFinish() {
  if (currentStep.value < steps.value.length - 1) {
    currentStep.value++;
  } else {
    exit();
  }
}

// --- Sliding dot window ---
const MAX_DOTS = 5;
const dotIndices = computed(() => {
  const n = steps.value.length;
  if (n <= MAX_DOTS) return Array.from({ length: n }, (_, i) => i);
  const half = Math.floor(MAX_DOTS / 2);
  let start = Math.max(0, currentStep.value - half);
  const end = Math.min(n - 1, start + MAX_DOTS - 1);
  start = Math.max(0, end - MAX_DOTS + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
});

// --- Step swipe gestures (horizontal only, ignored when sheet is dragging) ---
let swipeTouchStartX = 0;
let swipeTouchStartY = 0;
let sheetIsDragging = false;

function onSwipeTouchStart(e) {
  swipeTouchStartX = e.touches[0].clientX;
  swipeTouchStartY = e.touches[0].clientY;
}

function onSwipeTouchEnd(e) {
  if (sheetIsDragging) return;
  const dx = e.changedTouches[0].clientX - swipeTouchStartX;
  const dy = e.changedTouches[0].clientY - swipeTouchStartY;
  // Only treat as horizontal swipe if it's more horizontal than vertical
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx < 0) nextOrFinish();
    else prevStep();
  }
}

// --- Ingredient bottom sheet ---
const PEEK_H = 52; // px visible when collapsed

const sheetRef = ref(null);
const sheetExpanded = ref(false);
const sheetLiveY = ref(null); // null = snapped; number = live drag translateY

// Distance from fully expanded (translateY=0) to peeking (only PEEK_H visible)
function sheetTravel() {
  const el = sheetRef.value;
  return el ? el.offsetHeight - PEEK_H : window.innerHeight * 0.65 - PEEK_H;
}

const sheetStyle = computed(() => {
  if (sheetLiveY.value !== null) {
    return { transform: `translateY(${sheetLiveY.value}px)`, transition: 'none' };
  }
  return {
    transform: sheetExpanded.value
      ? 'translateY(0)'
      : `translateY(calc(100% - ${PEEK_H}px))`,
    transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
  };
});

let _dragStartClientY = 0;
let _dragStartSheetY = 0;
let _didDrag = false;
let _lastY = 0;
let _lastT = 0;
let _velocityY = 0; // px/ms, positive = downward

function onHandlePointerDown(e) {
  e.currentTarget.setPointerCapture(e.pointerId);
  sheetIsDragging = true;
  _dragStartClientY = e.clientY;
  _dragStartSheetY = sheetExpanded.value ? 0 : sheetTravel();
  sheetLiveY.value = _dragStartSheetY;
  _didDrag = false;
  _lastY = e.clientY;
  _lastT = Date.now();
  _velocityY = 0;
}

function onHandlePointerMove(e) {
  if (sheetLiveY.value === null) return;
  const now = Date.now();
  const dt = now - _lastT;
  if (dt > 0) _velocityY = (e.clientY - _lastY) / dt;
  _lastY = e.clientY;
  _lastT = now;

  const delta = e.clientY - _dragStartClientY;
  if (Math.abs(delta) > 4) _didDrag = true;
  sheetLiveY.value = Math.max(0, Math.min(sheetTravel(), _dragStartSheetY + delta));
}

function onHandlePointerUp() {
  sheetIsDragging = false;
  if (sheetLiveY.value === null) return;
  const travel = sheetTravel();
  const current = sheetLiveY.value;
  sheetLiveY.value = null;

  if (!_didDrag) {
    sheetExpanded.value = !sheetExpanded.value;
    return;
  }
  // Velocity snap: > 0.4 px/ms downward = collapse, > 0.4 upward = expand
  if (_velocityY > 0.4) sheetExpanded.value = false;
  else if (_velocityY < -0.4) sheetExpanded.value = true;
  else sheetExpanded.value = current < travel * 0.5;
}

// --- Wake Lock ---
let wakeLock = null;
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

watch(model, async (val) => {
  if (val) {
    currentStep.value = 0;
    Object.keys(timers).forEach(k => delete timers[k]);
    checkedIngredients.clear();
    sheetExpanded.value = false;
    sheetLiveY.value = null;
    stopInterval();
    initTimer(0);
    await requestWakeLock();
  } else {
    releaseWakeLock();
    stopInterval();
  }
});

function exit() {
  model.value = false;
}

onUnmounted(() => {
  releaseWakeLock();
  stopInterval();
});
</script>

<style scoped>
.cooking-overlay {
  background: #111111;
  min-height: 100vh;
  min-height: 100dvh;
  color: white;
  position: relative;
  overflow: hidden;
}

.co-white { color: white; }
.co-muted { color: rgba(255, 255, 255, 0.5); }

.co-progress-bar {
  display: flex;
  gap: 4px;
  height: 4px;
}
.co-segment {
  flex: 1;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.3s;
}
.co-segment--done  { background: rgba(0, 137, 123, 0.6); }
.co-segment--active { background: #00897B; }

.co-step-body { min-height: 160px; }

.co-step-text {
  font-size: clamp(1.5rem, 5vw, 2rem);
  font-weight: 700;
  line-height: 1.4;
  color: white;
  margin: 0;
}

.co-timer { background: rgba(255, 255, 255, 0.07); }

.co-timer-display {
  font-size: 1.4rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.05em;
}
.co-timer-editable {
  cursor: text;
  border-bottom: 2px dashed rgba(255, 255, 255, 0.35);
  padding-bottom: 1px;
}
.co-timer-input {
  font-size: 1.4rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.05em;
  color: white;
  background: transparent;
  border: none;
  border-bottom: 2px solid #00897B;
  outline: none;
  width: 76px;
  padding-bottom: 1px;
}

/* Persistent timers */
.co-running-timers {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 12px;
}
.co-persist-timer {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.co-persist-timer--done {
  background: rgba(102, 187, 106, 0.1);
  border-color: rgba(102, 187, 106, 0.3);
}
.co-persist-jump { cursor: pointer; }
.co-persist-time {
  font-size: 0.85rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: white;
  min-width: 36px;
}
.co-persist-time--done { color: #66BB6A; }

.co-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  transition: all 0.2s ease;
  flex-shrink: 0;
}
.co-dot--active {
  background: #00897B;
  width: 24px;
  border-radius: 4px;
}

/* ── Bottom sheet ────────────────────────────────────── */

.sheet-scrim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 10;
}

.ingredient-sheet {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 65vh;
  height: 65dvh;
  background: #1c1c1c;
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  z-index: 11;
  /* default: collapsed (translateY set via :style) */
}

.sheet-handle {
  flex-shrink: 0;
  padding-top: 10px;
  touch-action: none;
  cursor: grab;
  user-select: none;
}
.sheet-handle:active { cursor: grabbing; }

.sheet-drag-bar {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.25);
  margin: 0 auto 10px;
}

/* Ingredient list */
.sheet-content {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.sheet-ing-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.sheet-ing-row:active { background: rgba(255, 255, 255, 0.04); }

.sheet-ing-text {
  font-size: 0.95rem;
  line-height: 1.4;
  color: white;
  transition: color 0.2s, text-decoration 0.2s;
}
.sheet-ing-text--done {
  text-decoration: line-through;
  color: rgba(255, 255, 255, 0.35);
}
</style>
