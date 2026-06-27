<template>
  <v-container class="py-6 px-4" style="max-width: 720px">
    <!-- Header -->
    <div class="d-flex align-center mb-3">
      <v-btn v-if="view === 'day'" icon="mdi-arrow-left" variant="text" class="mr-2" @click="view = 'calendar'" />
      <BackButton v-else class="mr-2" />
      <div class="flex-grow-1">
        <div class="d-flex align-center ga-2">
          <h1 class="text-h5 font-weight-bold">{{ trip?.name ?? '...' }}</h1>
          <v-chip v-if="trip" size="x-small" :color="statusColor" variant="flat" label>{{ statusLabel }}</v-chip>
          <v-btn v-if="trip" icon="mdi-pencil" variant="text" size="small" color="medium-emphasis" :to="`/vacations/${tripId}/edit`" />
          <v-btn v-if="trip" icon="mdi-account-multiple-plus-outline" variant="text" size="small" :color="trip.collaborators?.length ? '#5E35B1' : 'medium-emphasis'" @click="shareOpen = true" />
          <v-btn v-if="trip" icon="mdi-chat" variant="text" size="small" color="#5E35B1" :to="`/vacations/${tripId}/assistant`" aria-label="Vacation Assistant" />
        </div>
        <div v-if="trip?.destination" class="text-body-2 text-medium-emphasis">
          <v-icon size="13" class="mr-1">mdi-map-marker-outline</v-icon>{{ trip.destination }}
          <span v-if="trip.destinationTz" class="ml-1">· times shown in {{ trip.destinationTz }}</span>
        </div>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="#5E35B1" />
    </div>

    <template v-else-if="trip">
      <!-- Considering: option comparison -->
      <div v-if="trip.status === 'considering' && trip.candidateRanges?.length" class="mb-5">
        <div class="section-label">Date options under consideration</div>
        <div class="d-flex flex-wrap ga-2">
          <v-card v-for="(r, i) in trip.candidateRanges" :key="i" variant="tonal" color="#5E35B1" rounded="lg" class="option-card">
            <v-card-text class="py-2 px-3">
              <div class="font-weight-bold">{{ r.label || `Option ${i + 1}` }}</div>
              <div class="text-body-2">{{ fmt(r.start) }} – {{ fmt(r.end) }}</div>
              <div class="text-caption text-medium-emphasis">{{ nights(r.start, r.end) }} nights</div>
              <div v-if="r.note" class="text-caption mt-1">{{ r.note }}</div>
            </v-card-text>
          </v-card>
        </div>
      </div>

      <!-- ── Trip days (only the actual travel dates) ────────────────────────── -->
      <template v-if="view === 'calendar'">
        <div class="section-label">{{ dayList.length }}-day trip — tap a day for the hour-by-hour plan</div>
        <div class="trip-days-grid">
          <div
            v-for="cell in tripDays"
            :key="cell.date"
            class="trip-day-card"
            :class="{ 'trip-day-card--today': cell.isToday }"
            @click="openDay(cell.date)"
          >
            <div class="tdc-index">Day {{ cell.index + 1 }}</div>
            <div class="tdc-weekday">{{ cell.weekday }}</div>
            <div class="tdc-daynum">{{ cell.dayNum }}</div>
            <div class="tdc-month">{{ cell.month }}</div>
            <div class="tdc-markers">
              <span v-if="cell.lodging" class="lodge-dot" title="Lodging"><v-icon size="12" color="#6A1B9A">mdi-bed</v-icon></span>
              <v-icon v-for="(b, bi) in cell.bookings.slice(0, 4)" :key="bi" size="13" :color="b.color">{{ b.icon }}</v-icon>
            </div>
          </div>
        </div>

        <!-- Budget roll-up -->
        <v-card v-if="budget && (budget.costedCount || budget.budget != null || uncostedItems.length)" rounded="lg" elevation="1" class="mt-6">
          <v-card-text class="py-3 px-4">
            <div class="d-flex align-center mb-1">
              <v-icon size="18" color="#5E35B1" class="mr-2">mdi-wallet-outline</v-icon>
              <span class="text-subtitle-2 font-weight-bold">Your budget</span>
              <v-btn icon="mdi-pencil" size="x-small" variant="text" color="medium-emphasis" @click="openBudgetDialog" />
              <v-spacer />
              <span class="text-body-2 font-weight-medium">
                {{ money(budget.total, budget.baseCurrency) }}<span v-if="budget.budget != null" class="text-medium-emphasis"> / {{ money(budget.budget, budget.baseCurrency) }}</span>
              </span>
            </div>

            <template v-if="budget.budget != null">
              <v-progress-linear :model-value="budgetPct" :color="budgetColor" height="8" rounded class="mb-1" />
              <div class="text-caption" :class="budget.remaining < 0 ? 'text-error font-weight-medium' : 'text-medium-emphasis'">
                {{ budget.remaining < 0 ? money(-budget.remaining, budget.baseCurrency) + ' over budget' : money(budget.remaining, budget.baseCurrency) + ' remaining' }}
              </div>
            </template>

            <!-- Bookings missing a cost -->
            <div v-if="uncostedItems.length" class="mt-2">
              <button type="button" class="uncosted-toggle" @click="showUncosted = !showUncosted">
                <v-icon size="14" class="mr-1">mdi-alert-circle-outline</v-icon>
                {{ uncostedItems.length }} booking{{ uncostedItems.length > 1 ? 's have' : ' has' }} no cost set
                <v-icon size="15" class="ml-1">{{ showUncosted ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
              </button>
              <div v-if="showUncosted" class="uncosted-list mt-1">
                <div v-for="i in uncostedItems" :key="i._id" class="uncosted-row" @click="editItem(i._id)">
                  <v-icon size="14" :color="typeMeta(i.type).color" class="mr-2 flex-shrink-0">{{ typeMeta(i.type).icon }}</v-icon>
                  <span class="flex-grow-1 text-truncate">{{ i.title }}</span>
                  <v-icon size="14" color="medium-emphasis" class="flex-shrink-0">mdi-pencil</v-icon>
                </div>
              </div>
            </div>

            <div v-if="budget.byType.length" class="mt-3">
              <div v-for="b in budget.byType" :key="b.type" class="bt-row">
                <v-icon size="14" :color="typeMeta(b.type).color" class="mr-2 flex-shrink-0">{{ typeMeta(b.type).icon }}</v-icon>
                <span class="bt-label">{{ typeLabel(b.type) }}</span>
                <div class="bt-bar"><div class="bt-fill" :style="{ width: barWidth(b.amount), background: typeMeta(b.type).color }"></div></div>
                <span class="bt-amount">{{ money(b.amount, budget.baseCurrency) }}</span>
              </div>
            </div>

            <!-- Settle up between families (shared-bill bookings) — tap to open the
                 full breakdown and record payments. -->
            <div v-if="canSettle" class="settle-block mt-3" @click="goSettle">
              <div class="d-flex align-center">
                <span class="section-label mb-0" style="color:#5E35B1">Settle up</span>
                <v-spacer />
                <v-icon size="18" color="#5E35B1">mdi-chevron-right</v-icon>
              </div>
              <div v-if="settlement.balances.length">
                <div v-for="(b, i) in settlement.balances" :key="i" class="text-body-2 mb-1">
                  <strong>{{ b.fromName }}</strong> owes <strong>{{ b.toName }}</strong> {{ money(b.amount, settlement.baseCurrency) }}
                </div>
                <div class="text-caption text-medium-emphasis">Estimated, in {{ settlement.baseCurrency }} · tap to record a payment</div>
              </div>
              <div v-else class="text-caption text-medium-emphasis">
                <v-icon size="13" color="success" class="mr-1">mdi-check-circle</v-icon>All settled up · tap to record a payment
              </div>
            </div>

            <div v-if="budget.unconverted.length" class="text-caption text-medium-emphasis mt-2">
              Not converted (unknown currency): <template v-for="(u, i) in budget.unconverted" :key="u.currency">{{ i ? ', ' : '' }}{{ money(u.amount, u.currency) }}</template>
            </div>
            <div v-if="!budget.ratesAvailable" class="text-caption text-warning mt-1">
              <v-icon size="12" class="mr-1">mdi-alert</v-icon>Exchange rates unavailable — only same-currency costs are totalled.
            </div>
            <div v-else class="text-caption text-medium-emphasis mt-2">
              Estimated, converted to {{ budget.baseCurrency }}<template v-if="rateDateShort"> · rates {{ rateDateShort }}</template>
            </div>
          </v-card-text>
        </v-card>

        <!-- Bookings outside the trip's date range -->
        <div v-if="outOfRangeItems.length" class="mt-6">
          <div class="section-label" style="color:#C62828">Outside your trip dates</div>
          <div class="text-caption text-medium-emphasis mb-2">
            These bookings fall outside {{ rangeLabel }}. Edit a booking, or change the trip dates to include it.
          </div>
          <div
            v-for="o in outOfRangeItems"
            :key="o.item._id"
            class="oor-card"
            @click="editItem(o.item._id)"
          >
            <div class="oor-bar" :style="{ background: typeMeta(o.item.type).color }" />
            <v-icon size="16" :color="typeMeta(o.item.type).color" class="mr-2">{{ typeMeta(o.item.type).icon }}</v-icon>
            <div class="flex-grow-1 min-w-0">
              <div class="font-weight-medium text-truncate">{{ o.item.title }}</div>
              <div class="text-caption text-medium-emphasis">{{ o.label }}</div>
            </div>
            <v-icon v-if="o.item.attachments?.length" size="13" color="medium-emphasis" class="mr-1">mdi-paperclip</v-icon>
            <v-icon size="16" color="medium-emphasis">mdi-pencil</v-icon>
          </div>
        </div>
      </template>

      <!-- ── Hour-by-hour day view ───────────────────────────────────────────── -->
      <template v-else>
      <!-- Day navigation -->
      <div class="day-nav mb-3">
        <v-btn icon="mdi-chevron-left" variant="tonal" color="#5E35B1" size="small" :disabled="dayIndex <= 0" @click="dayIndex--" />
        <div class="text-center flex-grow-1">
          <div class="text-caption text-medium-emphasis text-uppercase font-weight-medium">{{ selectedWeekday }}</div>
          <div class="text-subtitle-1 font-weight-bold">{{ selectedLabel }}</div>
          <div v-if="dayList.length > 1" class="text-caption text-medium-emphasis">Day {{ dayIndex + 1 }} of {{ dayList.length }}</div>
        </div>
        <v-btn icon="mdi-chevron-right" variant="tonal" color="#5E35B1" size="small" :disabled="dayIndex >= dayList.length - 1" @click="dayIndex++" />
      </div>

      <div class="d-flex align-center justify-space-between mb-2 flex-wrap ga-2">
        <v-btn variant="text" size="small" color="#5E35B1" prepend-icon="mdi-calendar-month" @click="view = 'calendar'">Back to trip calendar</v-btn>
        <span v-if="travelPills.length" class="text-caption text-medium-emphasis">Tap a travel pill to change its mode</span>
      </div>

      <!-- Lodging banner -->
      <div v-for="h in lodgingForDay" :key="`lodge-${h._id}`" class="lodging-banner mb-2">
        <v-icon size="18" color="#6A1B9A" class="mr-2">mdi-bed</v-icon>
        <span class="font-weight-medium">{{ h.title }}</span>
        <span class="text-body-2 text-medium-emphasis ml-2">{{ lodgingNote(h) }}</span>
        <v-spacer />
        <v-btn icon="mdi-pencil" size="x-small" variant="text" color="medium-emphasis" @click="editItem(h._id)" />
      </div>

      <!-- Hour-to-hour timeline -->
      <div v-if="dayLayout.length" class="timeline" :style="{ height: timelineHeight + 'px' }">
        <div v-for="hr in hourMarks" :key="hr.hour" class="hour-line" :style="{ top: hr.top + 'px' }">
          <span class="hour-label">{{ hr.label }}</span>
        </div>
        <div
          v-for="b in dayLayout"
          :key="b.seg.key"
          class="event-block"
          :style="{
            top: b.top + 'px', height: b.height + 'px',
            left: `calc(48px + ${b.leftPct}% )`,
            width: `calc(${b.widthPct}% - 6px)`,
            borderColor: typeMeta(b.seg.item.type).color,
            background: typeMeta(b.seg.item.type).color + '14',
          }"
          @click="editItem(b.seg.item._id)"
        >
          <div class="d-flex align-center ga-1">
            <v-icon size="13" :color="typeMeta(b.seg.item.type).color">{{ typeMeta(b.seg.item.type).icon }}</v-icon>
            <span class="block-title">{{ b.seg.title }}</span>
            <v-icon v-if="itemBooked(b.seg.item)" size="11" color="#2E7D32" class="flex-shrink-0" title="Booked">mdi-check-circle</v-icon>
            <v-icon v-if="b.seg.item.attachments?.length" size="11" color="medium-emphasis" class="flex-shrink-0">mdi-paperclip</v-icon>
          </div>
          <div class="block-time">{{ b.seg.timeLabel }}</div>
          <div v-if="b.seg.subtitle && b.height >= 56" class="block-loc">{{ b.seg.subtitle }}</div>
          <div v-if="trip?.collaborators?.length && b.seg.item.userId?.firstName && b.height >= 74" class="block-added">added by {{ b.seg.item.userId.firstName }}</div>
        </div>

        <!-- Travel-time pills between consecutive bookings -->
        <div
          v-for="p in travelPills"
          :key="p.key"
          class="travel-pill"
          :class="{ 'travel-pill--tight': p.tight, 'travel-pill--error': p.error }"
          :style="{ top: Math.max(0, p.top - 20) + 'px', left: `calc(50px + ${p.leftPct}% )` }"
          :title="p.title"
          @click.stop="cycleLegMode(p.baseKey)"
        >
          <v-progress-circular v-if="p.pending" size="9" width="2" indeterminate />
          <template v-else-if="p.minutes != null">
            <v-icon size="11">{{ p.icon }}</v-icon>
            <span>{{ p.durationLabel }}</span>
            <span class="pill-leave">· leave {{ p.leaveBy }}</span>
            <v-icon v-if="p.tight" size="11" class="ml-1">mdi-alert</v-icon>
          </template>
          <template v-else>
            <v-icon size="11">{{ p.icon }}</v-icon>
            <span>—</span>
          </template>
        </div>
      </div>

      <!-- Empty day -->
      <div v-else-if="!lodgingForDay.length" class="text-center py-10">
        <v-icon size="48" color="grey-lighten-1" class="mb-3">mdi-calendar-blank-outline</v-icon>
        <div class="text-body-1 text-medium-emphasis">Nothing booked this day</div>
        <v-btn color="#5E35B1" variant="tonal" class="mt-3" prepend-icon="mdi-plus" :to="`/vacations/${tripId}/items/new?date=${selectedDate}`">Add booking</v-btn>
      </div>
      </template>

      <div v-if="trip.notes" class="mt-5">
        <div class="section-label">Notes</div>
        <div class="text-body-2 text-medium-emphasis" style="white-space: pre-wrap">{{ trip.notes }}</div>
      </div>
    </template>
  </v-container>

  <!-- Add-booking FAB -->
  <div class="top-right-fabs">
    <v-btn icon="mdi-plus" variant="tonal" color="#5E35B1" :to="`/vacations/${tripId}/items/new?date=${selectedDate}`" />
  </div>

  <!-- Share dialog -->
  <v-dialog v-model="shareOpen" max-width="440">
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold">Share this trip</v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-3">Anyone with the code can view and help build this itinerary, even outside your household.</p>

        <template v-if="isOwner">
          <div v-if="trip?.shareCode" class="mb-3">
            <div class="text-caption text-medium-emphasis mb-1">Invite code</div>
            <div class="d-flex align-center ga-2">
              <code class="share-code">{{ trip.shareCode }}</code>
              <v-btn size="small" variant="tonal" color="#5E35B1" :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'" @click="copyShareCode">{{ copied ? 'Copied' : 'Copy' }}</v-btn>
            </div>
          </div>
          <v-btn v-else color="#5E35B1" variant="elevated" :loading="sharing" prepend-icon="mdi-share-variant" @click="enableShare" class="mb-3">Create invite code</v-btn>

          <div v-if="trip?.collaborators?.length" class="mb-2">
            <div class="text-caption text-medium-emphasis mb-1">Collaborators</div>
            <div v-for="c in trip.collaborators" :key="c._id" class="d-flex align-center ga-2 mb-1">
              <v-icon size="16" color="medium-emphasis">mdi-account</v-icon>
              <span class="text-body-2 flex-grow-1">{{ [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email }}</span>
              <v-btn icon="mdi-close" size="x-small" variant="text" color="medium-emphasis" @click="removeCollaborator(c._id)" />
            </div>
          </div>

          <v-btn v-if="trip?.shareCode" variant="text" size="small" color="error" @click="disableShare">Stop sharing</v-btn>
        </template>

        <template v-else>
          <p class="text-body-2">You're a guest collaborator on this trip.</p>
          <v-btn variant="text" size="small" color="error" prepend-icon="mdi-exit-run" @click="leaveShare">Leave this shared trip</v-btn>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="shareOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Your-family budget dialog -->
  <v-dialog v-model="budgetDialog" max-width="380">
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold">Your family's budget</v-card-title>
      <v-card-text>
        <div class="d-flex ga-3">
          <v-text-field v-model.number="budgetForm.budget" label="Budget" type="number" :prefix="budgetForm.baseCurrency" variant="outlined" density="compact" hide-details clearable />
          <v-combobox v-model="budgetForm.baseCurrency" :items="CURRENCIES" label="Currency" variant="outlined" density="compact" hide-details style="max-width: 120px" />
        </div>
        <div class="text-caption text-medium-emphasis mt-2">Only your family sees this. Bookings in other currencies are converted into it.</div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="budgetDialog = false">Cancel</v-btn>
        <v-btn color="#5E35B1" variant="elevated" :loading="savingBudget" @click="saveMyBudget">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { format, parseISO, eachDayOfInterval, differenceInCalendarDays } from 'date-fns';
import { tripsApi, placesApi } from '../services/api';
import { zonedParts, zonedTimeLabel } from '../utils/tz';

// Journey bookings (flights, trains, ships) span two zones; each leg lands on
// its own local day.
const isJourney = (item) => item.type === 'flight' || item.type === 'transit';
const hasZones = (item) => isJourney(item) && (item.details?.departureTz || item.details?.arrivalTz);

const route = useRoute();
const router = useRouter();
const tripId = route.params.id;

const loading = ref(true);
const trip = ref(null);
const items = ref([]);
const dayIndex = ref(0);
const view = ref('calendar');   // 'calendar' (full trip) | 'day' (hour-by-hour)
const todayStr = new Date().toISOString().slice(0, 10);

// Sharing
const shareOpen = ref(false);
const isOwner = ref(true);
const sharing = ref(false);
const copied = ref(false);

async function enableShare() {
  sharing.value = true;
  try {
    const { data } = await tripsApi.share(tripId);
    if (trip.value) trip.value.shareCode = data.shareCode;
  } finally { sharing.value = false; }
}
async function disableShare() {
  await tripsApi.unshare(tripId);
  if (trip.value) { trip.value.shareCode = null; trip.value.collaborators = []; }
}
async function copyShareCode() {
  try {
    await navigator.clipboard.writeText(trip.value.shareCode);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch { /* clipboard unavailable */ }
}
async function removeCollaborator(userId) {
  await tripsApi.removeCollaborator(tripId, userId);
  if (trip.value) trip.value.collaborators = trip.value.collaborators.filter(c => String(c._id) !== String(userId));
}
async function leaveShare() {
  await tripsApi.leaveShare(tripId);
  router.push('/vacations');
}

const TYPE_META = {
  flight:       { icon: 'mdi-airplane',              color: '#1565C0' },
  hotel:        { icon: 'mdi-bed',                   color: '#6A1B9A' },
  'car-rental': { icon: 'mdi-car',                   color: '#2E7D32' },
  restaurant:   { icon: 'mdi-silverware-fork-knife', color: '#C62828' },
  activity:     { icon: 'mdi-ticket-outline',        color: '#EF6C00' },
  transit:      { icon: 'mdi-train-car',             color: '#00838F' },
  other:        { icon: 'mdi-map-marker-outline',    color: '#546E7A' },
};
function typeMeta(t) { return TYPE_META[t] ?? TYPE_META.other; }
// Booked? (per-family for separate-booking mode, otherwise the single shared flag)
function itemBooked(item) { return item.sharing === 'shared_separate' ? !!item.myData?.confirmed : !!item.confirmed; }

// All non-journey bookings (hotel, restaurant, activity, …) are interpreted in
// the trip's destination timezone, so the itinerary reads the same from any
// browser. Empty tz falls back to browser-local inside the tz helpers.
const destinationTz = computed(() => trip.value?.destinationTz || '');

// Local calendar date ('yyyy-MM-dd') of an instant in the destination zone.
function localDate(instant) { return instant ? zonedParts(instant, destinationTz.value).dateStr : null; }

const statusLabel = computed(() => ({ considering: 'Considering', booked: 'Booked', completed: 'Past' }[trip.value?.status] ?? ''));
const statusColor = computed(() => ({ considering: '#FB8C00', booked: '#5E35B1', completed: '#757575' }[trip.value?.status] ?? '#757575'));

function fmt(d) { return d ? format(new Date(d), 'MMM d') : ''; }
function nights(s, e) { return Math.max(0, differenceInCalendarDays(new Date(e), new Date(s))); }

// ── Day window ──────────────────────────────────────────────────────────────────
const windowRange = computed(() => {
  const t = trip.value;
  if (!t) return null;
  let start, end;
  if (t.startDate) {
    start = new Date(t.startDate);
    end = new Date(t.endDate || t.startDate);
  } else if (t.candidateRanges?.length) {
    start = new Date(t.candidateRanges[0].start);
    end = new Date(t.candidateRanges[0].end);
  } else if (items.value.length) {
    const ds = items.value.map(i => new Date(i.start));
    start = new Date(Math.min(...ds));
    end = new Date(Math.max(...items.value.map(i => new Date(i.end || i.start))));
  } else {
    const today = new Date();
    return { start: today, end: today };
  }
  if (end < start) end = start;
  return { start, end };
});

const dayList = computed(() => {
  const r = windowRange.value;
  if (!r) return [];
  return eachDayOfInterval({ start: r.start, end: r.end }).map(d => format(d, 'yyyy-MM-dd'));
});

// ── Trip days (only the actual travel dates) ────────────────────────────────────
const tripDays = computed(() =>
  dayList.value.map((dateStr, idx) => {
    const d = parseISO(dateStr);
    return {
      date: dateStr,
      index: idx,
      weekday: format(d, 'EEE'),
      dayNum: format(d, 'd'),
      month: format(d, 'MMM'),
      isToday: dateStr === todayStr,
      bookings: bookingsForDate(dateStr),
      lodging: lodgingForDate(dateStr),
    };
  })
);

// All local calendar dates a booking touches (used to detect out-of-range items).
function itemDates(item) {
  if (item.type === 'hotel') {
    const ci = localDate(item.start);
    const co = localDate(item.end || item.start);
    if (!ci) return [];
    return eachDayOfInterval({ start: parseISO(ci), end: parseISO(co || ci) }).map(d => format(d, 'yyyy-MM-dd'));
  }
  if (hasZones(item)) {
    const ds = [zonedParts(item.start, item.details.departureTz).dateStr];
    if (item.end) ds.push(zonedParts(item.end, item.details.arrivalTz).dateStr);
    return ds;
  }
  const ds = [localDate(item.start)];
  if (item.end) ds.push(localDate(item.end));
  return ds.filter(Boolean);
}

function outLabel(item) {
  const tz = hasZones(item) ? item.details.departureTz : destinationTz.value;
  const p = zonedParts(item.start, tz);
  return `${format(parseISO(p.dateStr), 'EEE, MMM d, yyyy')} · ${zonedTimeLabel(item.start, tz)}`;
}

// Bookings whose dates fall entirely outside the trip window.
const outOfRangeItems = computed(() => {
  const inWindow = new Set(dayList.value);
  return items.value
    .filter(i => {
      const dates = itemDates(i);
      return dates.length && !dates.some(d => inWindow.has(d));
    })
    .map(i => ({ item: i, label: outLabel(i) }))
    .sort((a, b) => new Date(a.item.start) - new Date(b.item.start));
});

const rangeLabel = computed(() => {
  if (!dayList.value.length) return '';
  const a = format(parseISO(dayList.value[0]), 'MMM d');
  const b = format(parseISO(dayList.value.at(-1)), 'MMM d, yyyy');
  return `${a} – ${b}`;
});

// Distinct booking-type icons for a date (non-hotel), capped for display.
// Journey legs count on both their departure and arrival local dates.
function bookingsForDate(dateStr) {
  const seen = new Map();
  for (const i of items.value) {
    if (i.type === 'hotel') continue;
    let touches = false;
    if (hasZones(i)) {
      if (zonedParts(i.start, i.details.departureTz).dateStr === dateStr) touches = true;
      if (i.end && zonedParts(i.end, i.details.arrivalTz).dateStr === dateStr) touches = true;
    } else {
      touches = localDate(i.start) === dateStr;
    }
    if (touches && !seen.has(i.type)) seen.set(i.type, typeMeta(i.type));
  }
  return [...seen.values()];
}

function lodgingForDate(dateStr) {
  return items.value.some(i => {
    if (i.type !== 'hotel') return false;
    return dateStr >= localDate(i.start) && dateStr <= localDate(i.end || i.start);
  });
}

function openDay(dateStr) {
  const idx = dayList.value.indexOf(dateStr);
  if (idx < 0) return;
  dayIndex.value = idx;
  view.value = 'day';
}

const selectedDate = computed(() => dayList.value[dayIndex.value] ?? new Date().toISOString().slice(0, 10));
const selectedWeekday = computed(() => format(parseISO(selectedDate.value), 'EEEE'));
const selectedLabel = computed(() => format(parseISO(selectedDate.value), 'MMMM d, yyyy'));

// ── Lodging (hotels covering the selected night) ────────────────────────────────
const lodgingForDay = computed(() =>
  items.value.filter(i => {
    if (i.type !== 'hotel') return false;
    const ci = localDate(i.start);
    const co = localDate(i.end || i.start);
    // You're lodged there from check-in date up to (but not including) check-out date,
    // and we also surface the banner on the check-out day itself.
    return selectedDate.value >= ci && selectedDate.value <= co;
  })
);

function lodgingNote(h) {
  const ci = localDate(h.start);
  const co = localDate(h.end || h.start);
  if (selectedDate.value === ci) return `Check in ${zonedTimeLabel(h.start, destinationTz.value)}`;
  if (selectedDate.value === co) return `Check out ${zonedTimeLabel(h.end || h.start, destinationTz.value)}`;
  return 'Overnight';
}

const PX_PER_MIN = 1;
const MIN_BLOCK = 40;

// Timed segments that land on the selected day. Journey legs are placed by their
// LOCAL time in the relevant zone (departure tz for take-off, arrival tz for
// landing), so a flight shows on the right day in each city.
const daySegments = computed(() => {
  const date = selectedDate.value;
  const segs = [];
  for (const i of items.value) {
    if (i.type === 'hotel') continue;

    if (hasZones(i)) {
      const dep = zonedParts(i.start, i.details.departureTz);
      if (dep.dateStr === date) {
        const place = i.details.departureName || i.details.from;
        segs.push({
          key: `${i._id}-dep`, item: i,
          startMin: dep.minutes, endMin: dep.minutes + MIN_BLOCK,
          title: i.title,
          subtitle: place ? `Depart ${place}` : 'Departure',
          timeLabel: zonedTimeLabel(i.start, i.details.departureTz),
          journeyId: i._id,
          anchorPlaceId: i.details.departurePlaceId || '',
          anchorAddress: i.details.departureName || '',
          anchorTz: i.details.departureTz || '',
          startInstant: i.start, endInstant: i.start,
        });
      }
      if (i.end) {
        const arr = zonedParts(i.end, i.details.arrivalTz);
        if (arr.dateStr === date) {
          const place = i.details.arrivalName || i.details.to;
          segs.push({
            key: `${i._id}-arr`, item: i,
            startMin: arr.minutes, endMin: arr.minutes + MIN_BLOCK,
            title: i.title,
            subtitle: place ? `Arrive ${place}` : 'Arrival',
            timeLabel: zonedTimeLabel(i.end, i.details.arrivalTz),
            journeyId: i._id,
            anchorPlaceId: i.details.arrivalPlaceId || '',
            anchorAddress: i.details.arrivalName || '',
            anchorTz: i.details.arrivalTz || '',
            startInstant: i.end, endInstant: i.end,
          });
        }
      }
    } else {
      const sp = zonedParts(i.start, destinationTz.value);
      if (sp.dateStr !== date) continue;
      const s = sp.minutes;
      const e = i.end ? Math.max(zonedParts(i.end, destinationTz.value).minutes, s + MIN_BLOCK) : s + MIN_BLOCK;
      segs.push({
        key: i._id, item: i,
        startMin: s, endMin: e,
        title: i.title,
        subtitle: i.location || '',
        timeLabel: timeRange(i),
        journeyId: null,
        anchorPlaceId: i.placeId || '',
        anchorAddress: i.location || i.address || '',
        anchorTz: destinationTz.value,
        startInstant: i.start, endInstant: i.end || i.start,
      });
    }
  }
  return segs.sort((a, b) => a.startMin - b.startMin);
});

// Grid bounds derived from the day's segments (with sensible defaults)
const gridBounds = computed(() => {
  const segs = daySegments.value;
  if (!segs.length) return { start: 8 * 60, end: 20 * 60 };
  let lo = Math.min(...segs.map(s => s.startMin));
  let hi = Math.max(...segs.map(s => s.endMin));
  lo = Math.max(0, Math.floor(lo / 60) * 60);
  hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  if (hi - lo < 120) hi = Math.min(24 * 60, lo + 120);
  return { start: lo, end: hi };
});

const timelineHeight = computed(() => (gridBounds.value.end - gridBounds.value.start) * PX_PER_MIN + 8);

const hourMarks = computed(() => {
  const marks = [];
  const { start, end } = gridBounds.value;
  for (let m = start; m <= end; m += 60) {
    const h = (m / 60) % 24;
    const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
    marks.push({ hour: m, top: (m - start) * PX_PER_MIN, label });
  }
  return marks;
});

// Lane-packing for overlapping blocks
const dayLayout = computed(() => {
  const segs = daySegments.value;
  if (!segs.length) return [];
  const { start } = gridBounds.value;

  const blocks = segs.map(seg => ({ seg, s: seg.startMin, e: seg.endMin, lane: 0, lanes: 1 }));

  // Assign lanes greedily within overlap clusters
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds = [];
    for (const b of cluster) {
      let placed = false;
      for (let l = 0; l < laneEnds.length; l++) {
        if (b.s >= laneEnds[l]) { b.lane = l; laneEnds[l] = b.e; placed = true; break; }
      }
      if (!placed) { b.lane = laneEnds.length; laneEnds.push(b.e); }
    }
    const total = laneEnds.length;
    cluster.forEach(b => { b.lanes = total; });
    cluster = [];
  };
  for (const b of blocks.slice().sort((a, z) => a.s - z.s)) {
    if (cluster.length && b.s >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.e);
  }
  flush();

  return blocks.map(b => ({
    seg: b.seg,
    top: (b.s - start) * PX_PER_MIN,
    height: (b.e - b.s) * PX_PER_MIN,
    leftPct: (b.lane / b.lanes) * 100,
    widthPct: (1 / b.lanes) * 100,
  }));
});

function timeRange(item) {
  const s = zonedTimeLabel(item.start, destinationTz.value);
  if (!item.end) return s;
  return `${s} – ${zonedTimeLabel(item.end, destinationTz.value)}`;
}

// ── Auto travel-time between consecutive bookings (mode per leg) ────────────────
const TRAVEL_MODES = [
  { value: 'DRIVE',   icon: 'mdi-car',   label: 'Drive' },
  { value: 'WALK',    icon: 'mdi-walk',  label: 'Walk' },
  { value: 'TRANSIT', icon: 'mdi-train', label: 'Transit' },
];
const legModes = ref({});     // baseKey (origin|dest) -> mode
const legResults = ref({});   // `${baseKey}|${mode}` -> { minutes, distanceKm } | null (pending) | { error }

function refKey(placeId, address) {
  return placeId ? `place:${placeId}` : (address ? `addr:${address.toLowerCase().trim()}` : null);
}
function legModeFor(baseKey) { return legModes.value[baseKey] || 'DRIVE'; }
function modeIconFor(mode) { return TRAVEL_MODES.find(m => m.value === mode)?.icon ?? 'mdi-car'; }
function cycleLegMode(baseKey) {
  const idx = TRAVEL_MODES.findIndex(m => m.value === legModeFor(baseKey));
  legModes.value = { ...legModes.value, [baseKey]: TRAVEL_MODES[(idx + 1) % TRAVEL_MODES.length].value };
}
function fmtDuration(min) {
  if (min == null) return '';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// One connector per consecutive pair of timed blocks (skipping the two legs of
// the same flight, missing locations, and same-place transitions).
const connectors = computed(() => {
  const blocks = dayLayout.value;
  const out = [];
  for (let i = 1; i < blocks.length; i++) {
    const A = blocks[i - 1].seg;
    const B = blocks[i].seg;
    if (A.journeyId && A.journeyId === B.journeyId) continue;      // the flight itself
    const oKey = refKey(A.anchorPlaceId, A.anchorAddress);
    const dKey = refKey(B.anchorPlaceId, B.anchorAddress);
    if (!oKey || !dKey || oKey === dKey) continue;
    const baseKey = `${oKey}|${dKey}`;
    const mode = legModeFor(baseKey);
    const gapMin = Math.round((new Date(B.startInstant) - new Date(A.endInstant)) / 60000);
    out.push({
      baseKey, mode, key: `${baseKey}|${mode}`,
      top: blocks[i].top, leftPct: blocks[i].leftPct,
      origin: { placeId: A.anchorPlaceId, address: A.anchorAddress },
      dest:   { placeId: B.anchorPlaceId, address: B.anchorAddress },
      departAt: A.endInstant,
      originTz: A.anchorTz || destinationTz.value,
      destStartInstant: B.startInstant,
      fromTitle: A.title, toTitle: B.title,
      gapMin,
    });
  }
  return out;
});

// Fetch any uncomputed legs (in-session cache via legResults; server caches too).
watch(connectors, (list) => {
  for (const c of list) {
    if (c.key in legResults.value) continue;
    legResults.value = { ...legResults.value, [c.key]: null };
    placesApi.routeLeg({
      originPlaceId: c.origin.placeId || undefined,
      originAddress: c.origin.address || undefined,
      destPlaceId:   c.dest.placeId || undefined,
      destAddress:   c.dest.address || undefined,
      mode: c.mode,
      departureTime: c.departAt || undefined,
    })
      .then(({ data }) => { legResults.value = { ...legResults.value, [c.key]: data }; })
      .catch(() => { legResults.value = { ...legResults.value, [c.key]: { error: true } }; });
  }
}, { immediate: true });

// Connector enriched with its (possibly pending) result, for the template.
const travelPills = computed(() =>
  connectors.value.map(c => {
    const r = legResults.value[c.key];
    const minutes = r && !r.error ? r.minutes : null;
    const tight = minutes != null && c.gapMin >= 0 && c.gapMin < minutes;
    const leaveBy = minutes != null
      ? zonedTimeLabel(new Date(new Date(c.destStartInstant).getTime() - minutes * 60000), c.originTz)
      : null;
    return {
      key: c.key, baseKey: c.baseKey, top: c.top, leftPct: c.leftPct,
      mode: c.mode, icon: modeIconFor(c.mode),
      pending: r === null,
      error: !!(r && r.error),
      minutes, durationLabel: fmtDuration(minutes), distanceKm: r && !r.error ? r.distanceKm : null,
      tight, gapMin: c.gapMin, leaveBy,
      title: minutes != null
        ? `${c.fromTitle} → ${c.toTitle}: ~${fmtDuration(minutes)} · ${r.distanceKm} km by ${c.mode.toLowerCase()} · leave by ${leaveBy}${c.gapMin >= 0 ? ` · you have ${fmtDuration(c.gapMin)}` : ''} — tap to change mode`
        : (r && r.error ? `No ${c.mode.toLowerCase()} route found — tap to change mode` : `${c.fromTitle} → ${c.toTitle}`),
    };
  })
);

function editItem(itemId) {
  router.push(`/vacations/${tripId}/items/${itemId}/edit`);
}

// ── Budget roll-up ──────────────────────────────────────────────────────────────
const budget = ref(null);
const TYPE_LABELS = {
  flight: 'Flights', hotel: 'Lodging', 'car-rental': 'Car rental',
  restaurant: 'Food & dining', activity: 'Activities', transit: 'Transit', other: 'Other',
};
function typeLabel(t) { return TYPE_LABELS[t] ?? t; }
function money(amount, cur) {
  if (amount == null) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${cur} ${Math.round(amount)}`; }
}
const budgetPct = computed(() => budget.value?.budget ? Math.min(100, (budget.value.total / budget.value.budget) * 100) : 0);
const budgetColor = computed(() => {
  const p = budget.value?.budget ? budget.value.total / budget.value.budget : 0;
  return p >= 1 ? '#C62828' : p >= 0.8 ? '#F9A825' : '#2E7D32';
});
const maxType = computed(() => Math.max(1, ...((budget.value?.byType ?? []).map(b => b.amount))));
function barWidth(a) { return `${Math.max(4, (a / maxType.value) * 100)}%`; }
const rateDateShort = computed(() => {
  const d = budget.value?.rateDate ? new Date(budget.value.rateDate) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, 'MMM d') : '';
});

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'CNY', 'MXN', 'INR'];
const settlement = ref(null);
// Show the settle-up entry point whenever two or more families are on the trip,
// even once everyone is square (so they can still record/view payments).
const canSettle = computed(() => (settlement.value?.households?.length || 0) >= 2);
function goSettle() { router.push(`/vacations/${tripId}/settle`); }

async function loadBudget() {
  try { const { data } = await tripsApi.budget(tripId); budget.value = data; }
  catch { budget.value = null; }
  try { const { data } = await tripsApi.settlement(tripId); settlement.value = data; }
  catch { settlement.value = null; }
}

// Your-family budget editing
const budgetDialog = ref(false);
const savingBudget = ref(false);
const budgetForm = ref({ budget: null, baseCurrency: 'CAD' });
function openBudgetDialog() {
  budgetForm.value = { budget: budget.value?.budget ?? null, baseCurrency: budget.value?.baseCurrency || 'CAD' };
  budgetDialog.value = true;
}
async function saveMyBudget() {
  savingBudget.value = true;
  try {
    await tripsApi.setMyBudget(tripId, {
      budget: budgetForm.value.budget,
      baseCurrency: (budgetForm.value.baseCurrency || 'CAD').toUpperCase(),
    });
    budgetDialog.value = false;
    await loadBudget();
  } finally {
    savingBudget.value = false;
  }
}

// Bookings with no cost entered (cost 0 is a valid "free" cost, so only null/undefined count).
const uncostedItems = computed(() => items.value.filter(i => i.cost == null));
const showUncosted = ref(false);

async function load() {
  loading.value = true;
  try {
    const { data } = await tripsApi.get(tripId);
    trip.value = data.trip;
    items.value = data.items;
    isOwner.value = data.isOwner !== false;
    loadBudget();
    // Start on today if today falls inside the window, else day 1
    const todayStr = new Date().toISOString().slice(0, 10);
    const idx = dayList.value.indexOf(todayStr);
    dayIndex.value = idx >= 0 ? idx : 0;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.section-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), .45);
  margin-bottom: 8px;
}
.option-card { min-width: 150px; }
.settle-block {
  cursor: pointer;
  border-radius: 8px;
  padding: 8px;
  margin-left: -8px;
  margin-right: -8px;
  transition: background-color .15s ease;
}
.settle-block:hover { background: rgba(94, 53, 177, .06); }
.settle-block .section-label { margin-bottom: 4px; }

/* ── Trip days (only travel dates) ──────────────────────────────────────────── */
.trip-days-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 8px;
}
.trip-day-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 6px 10px;
  border-radius: 12px;
  background: rgba(94, 53, 177, 0.06);
  border: 1px solid rgba(94, 53, 177, 0.15);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.trip-day-card:hover {
  background: rgba(94, 53, 177, 0.14);
  border-color: rgba(94, 53, 177, 0.35);
}
.trip-day-card--today {
  border-color: #5E35B1;
  box-shadow: 0 0 0 1px #5E35B1 inset;
}
.tdc-index {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #5E35B1;
}
.tdc-weekday {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), .55);
  margin-top: 2px;
}
.tdc-daynum {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.1;
  color: rgba(var(--v-theme-on-surface), .85);
}
.tdc-month {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), .5);
}
.bt-row {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.bt-label {
  font-size: 0.78rem;
  width: 96px;
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.bt-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  overflow: hidden;
  margin: 0 10px;
}
.bt-fill { height: 100%; border-radius: 3px; }

.uncosted-toggle {
  display: inline-flex;
  align-items: center;
  font-size: 0.74rem;
  font-weight: 600;
  color: #B26A00;
  background: none;
  border: none;
  padding: 2px 0;
  cursor: pointer;
}
.uncosted-toggle:hover { color: #8F5500; }
.uncosted-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.uncosted-row {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  border: 1px solid rgba(178, 106, 0, 0.2);
  background: rgba(178, 106, 0, 0.05);
}
.uncosted-row:hover { background: rgba(178, 106, 0, 0.12); }
.bt-amount {
  font-size: 0.78rem;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 64px;
  text-align: right;
}

.oor-card {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid rgba(198, 40, 40, 0.25);
  border-radius: 10px;
  background: rgba(198, 40, 40, 0.04);
  cursor: pointer;
  overflow: hidden;
  transition: background 0.15s;
}
.oor-card:hover { background: rgba(198, 40, 40, 0.09); }
.oor-bar {
  width: 4px;
  align-self: stretch;
  border-radius: 2px;
  margin: -10px 10px -10px -12px;
  flex-shrink: 0;
}
.min-w-0 { min-width: 0; }

.tdc-markers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 16px;
  margin-top: 6px;
}
.lodge-dot { display: inline-flex; }

.day-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(94, 53, 177, 0.06);
  border-radius: 12px;
  padding: 8px 10px;
}

.lodging-banner {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(106, 27, 154, 0.08);
  border: 1px solid rgba(106, 27, 154, 0.18);
}

.timeline {
  position: relative;
  margin-top: 4px;
}
.hour-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  height: 0;
}
.hour-label {
  position: absolute;
  top: -7px;
  left: 0;
  width: 40px;
  text-align: right;
  font-size: 0.65rem;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.travel-pill {
  position: absolute;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  font-size: 0.64rem;
  font-weight: 600;
  color: #fff;
  background: #607D8B;
  border: 1px solid #607D8B;
  white-space: nowrap;
  cursor: pointer;
}
.travel-pill:hover { background: #546E7A; border-color: #546E7A; }
.pill-leave { font-weight: 500; opacity: 0.85; }
.block-added {
  font-size: 0.6rem;
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.share-code {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  background: rgba(94, 53, 177, 0.1);
  color: #5E35B1;
  padding: 6px 12px;
  border-radius: 8px;
}
.travel-pill--tight {
  color: #fff;
  background: #C62828;
  border-color: #C62828;
}
.travel-pill--tight:hover { background: #B71C1C; }
.travel-pill--error {
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-color: rgba(var(--v-theme-on-surface), 0.2);
}
.event-block {
  position: absolute;
  border-left: 3px solid;
  border-radius: 6px;
  padding: 3px 6px;
  overflow: hidden;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  transition: opacity 0.15s;
}
.event-block:hover { opacity: 0.85; }
.block-title {
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.block-time {
  font-size: 0.64rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.block-loc {
  font-size: 0.62rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.top-right-fabs {
  position: fixed;
  top: 16px;
  right: 24px;
  z-index: 200;
  padding: 8px;
  border-radius: 999px;
}
.top-right-fabs :deep(.v-icon) { font-size: 1.4rem !important; }
</style>
