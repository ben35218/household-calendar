<template>
  <v-container class="py-6 px-4" style="max-width: 640px">
    <div class="d-flex align-center mb-4">
      <BackButton class="mr-2" />
      <h1 class="text-h5 font-weight-bold">{{ isEdit ? 'Edit Booking' : 'Add Booking' }}</h1>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="#5E35B1" class="mb-4" />

    <v-card rounded="lg" elevation="1">
      <v-card-text class="pa-5">
        <!-- AI auto-fill from a confirmation (create mode) -->
        <div v-if="!isEdit" class="autofill mb-4">
          <div class="d-flex align-center ga-2 mb-1">
            <v-icon size="18" color="#5E35B1">mdi-auto-fix</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Auto-fill from a confirmation</span>
          </div>
          <div class="text-caption text-medium-emphasis mb-2">Upload a booking confirmation — PDF, screenshot, or a saved <strong>.eml</strong> email — and we'll read it and pre-fill the fields below for you to review.</div>
          <div class="d-flex flex-wrap align-center ga-2">
            <v-btn size="small" variant="tonal" color="#5E35B1" prepend-icon="mdi-upload" :loading="extracting" @click="confirmFileInput?.click()">Upload confirmation</v-btn>
            <v-btn size="small" variant="text" color="#5E35B1" prepend-icon="mdi-text-box-outline" @click="showPaste = !showPaste">Paste text</v-btn>
          </div>
          <input ref="confirmFileInput" type="file" accept="application/pdf,image/*,message/rfc822,.eml" hidden @change="onConfirmationFile" />
          <div v-if="showPaste" class="mt-2">
            <v-textarea v-model="confirmText" label="Paste confirmation email / text" variant="outlined" rows="3" auto-grow hide-details class="mb-2" />
            <v-btn size="small" variant="tonal" color="#5E35B1" :loading="extracting" :disabled="!confirmText.trim()" @click="extractFromText">Extract</v-btn>
          </div>
          <v-alert v-if="extractError" type="warning" variant="tonal" density="compact" class="mt-2">{{ extractError }}</v-alert>
          <div class="text-caption text-medium-emphasis mt-2">Always double-check the extracted details before saving.</div>
          <v-divider class="mt-4" />
        </div>

        <!-- Type selector -->
        <div class="text-subtitle-2 font-weight-medium mb-2">Type</div>
        <div class="type-picker mb-4">
          <button
            v-for="t in TYPES"
            :key="t.value"
            type="button"
            class="type-option"
            :class="{ 'type-option--active': form.type === t.value }"
            :style="form.type === t.value ? { borderColor: t.color, background: t.color + '22', color: t.color } : {}"
            @click="selectType(t.value)"
          >
            <v-icon size="20">{{ t.icon }}</v-icon>
            <span>{{ t.label }}</span>
          </button>
        </div>

        <v-text-field v-model="form.title" :label="cfg.titleLabel" :placeholder="cfg.titlePlaceholder" variant="outlined" class="mb-3" />

        <!-- ── Journey types (flight / transit): per-endpoint timezone ──────────── -->
        <template v-if="isJourney">
          <div class="leg-card mb-3">
            <div class="text-caption text-medium-emphasis font-weight-medium text-uppercase mb-2">Departure</div>
            <v-combobox
              v-model="form.depRaw"
              :items="suggestions.dep"
              item-title="description"
              return-object no-filter clearable
              :loading="placesLoading.dep"
              :label="journeyLabels.dep"
              placeholder="Search airport / station / port..."
              variant="outlined" density="compact" hide-details class="mb-2"
              @update:search="searchDep"
              @update:model-value="v => onJourneyPlaceSelected('dep', v)"
            >
              <template #item="{ item, props }">
                <v-list-item v-bind="props" :title="item.raw.main_text" :subtitle="item.raw.secondary_text" />
              </template>
            </v-combobox>
            <div class="d-flex ga-3">
              <v-text-field v-model="form.depDate" label="Date" type="date" variant="outlined" density="compact" hide-details />
              <v-text-field v-model="form.depTime" label="Time" type="time" variant="outlined" density="compact" hide-details />
            </div>
            <div class="tz-line">
              <v-progress-circular v-if="tzLoading.dep" size="12" width="2" indeterminate class="mr-1" />
              <v-icon v-else size="13" class="mr-1">mdi-clock-outline</v-icon>
              <span v-if="form.departureTz">{{ form.departureTz }}</span>
              <span v-else class="text-medium-emphasis">Timezone auto-fills from the {{ form.type === 'flight' ? 'airport' : 'station/port' }}</span>
            </div>
          </div>

          <div class="leg-card mb-3">
            <div class="text-caption text-medium-emphasis font-weight-medium text-uppercase mb-2">Arrival</div>
            <v-combobox
              v-model="form.arrRaw"
              :items="suggestions.arr"
              item-title="description"
              return-object no-filter clearable
              :loading="placesLoading.arr"
              :label="journeyLabels.arr"
              placeholder="Search airport / station / port..."
              variant="outlined" density="compact" hide-details class="mb-2"
              @update:search="searchArr"
              @update:model-value="v => onJourneyPlaceSelected('arr', v)"
            >
              <template #item="{ item, props }">
                <v-list-item v-bind="props" :title="item.raw.main_text" :subtitle="item.raw.secondary_text" />
              </template>
            </v-combobox>
            <div class="d-flex ga-3">
              <v-text-field v-model="form.arrDate" label="Date" type="date" variant="outlined" density="compact" hide-details :min="form.depDate" />
              <v-text-field v-model="form.arrTime" label="Time" type="time" variant="outlined" density="compact" hide-details />
            </div>
            <div class="tz-line">
              <v-progress-circular v-if="tzLoading.arr" size="12" width="2" indeterminate class="mr-1" />
              <v-icon v-else size="13" class="mr-1">mdi-clock-outline</v-icon>
              <span v-if="form.arrivalTz">{{ form.arrivalTz }}</span>
              <span v-else class="text-medium-emphasis">Timezone auto-fills from the {{ form.type === 'flight' ? 'airport' : 'station/port' }}</span>
            </div>
          </div>

          <div class="d-flex flex-wrap ga-3 mb-1">
            <template v-if="form.type === 'flight'">
              <v-text-field v-model="form.details.airline" label="Airline" variant="outlined" density="compact" hide-details class="detail-field" />
              <v-text-field v-model="form.details.flightNumber" label="Flight #" variant="outlined" density="compact" hide-details class="detail-field" />
              <v-text-field v-model="form.details.seat" label="Seat" variant="outlined" density="compact" hide-details class="detail-field" />
            </template>
            <v-text-field v-else v-model="form.details.mode" label="Mode (train / bus / ferry / ship)" variant="outlined" density="compact" hide-details class="detail-field" />
          </div>
        </template>

        <!-- ── Standard types ──────────────────────────────────────────────────── -->
        <template v-else>
          <div class="text-caption text-medium-emphasis font-weight-medium mb-1">{{ cfg.startLabel }}</div>
          <div class="d-flex ga-3 mb-3">
            <v-text-field v-model="form.startDate" label="Date" type="date" variant="outlined" density="compact" hide-details />
            <v-text-field v-model="form.startTime" label="Time" type="time" variant="outlined" density="compact" hide-details />
          </div>

          <!-- Duration-driven types: enter a duration, end time is computed -->
          <template v-if="usesDuration">
            <div class="text-caption text-medium-emphasis font-weight-medium mb-1">Duration</div>
            <div class="d-flex ga-3 align-center mb-1">
              <v-text-field v-model.number="form.durH" label="Hours" type="number" min="0" variant="outlined" density="compact" hide-details class="dur-field" />
              <v-text-field v-model.number="form.durM" label="Minutes" type="number" min="0" max="59" variant="outlined" density="compact" hide-details class="dur-field" />
              <span v-if="endInfo" class="text-caption text-medium-emphasis">
                Ends {{ endInfo.timeStr }}<template v-if="endInfo.crossesDay"> on {{ endInfo.dateStr }}</template>
              </span>
            </div>
            <div class="text-caption text-medium-emphasis mb-3">Sets the end time automatically from the start.</div>
          </template>

          <!-- Other standard types: explicit end date/time -->
          <template v-else>
            <div class="text-caption text-medium-emphasis font-weight-medium mb-1">{{ cfg.endLabel }} (optional)</div>
            <div class="d-flex ga-3 mb-3">
              <v-text-field v-model="form.endDate" label="Date" type="date" variant="outlined" density="compact" hide-details :min="form.startDate" clearable />
              <v-text-field v-model="form.endTime" label="Time" type="time" variant="outlined" density="compact" hide-details clearable />
            </div>
          </template>

          <v-combobox
            v-if="cfg.showLocation"
            v-model="form.locationRaw"
            :items="suggestions.location"
            item-title="description"
            return-object no-filter clearable
            :loading="placesLoading.location"
            :label="cfg.locationLabel"
            placeholder="Search a place or address..."
            variant="outlined" class="mb-3"
            @update:search="searchLocation"
          >
            <template #item="{ item, props }">
              <v-list-item v-bind="props" :title="item.raw.main_text" :subtitle="item.raw.secondary_text" />
            </template>
          </v-combobox>

          <div v-if="cfg.detailFields.length" class="d-flex flex-wrap ga-3 mb-1">
            <v-text-field
              v-for="f in cfg.detailFields"
              :key="f.key"
              v-model="form.details[f.key]"
              :label="f.label"
              :type="f.type || 'text'"
              variant="outlined" density="compact" hide-details class="detail-field"
            />
          </div>
        </template>

        <v-divider class="my-4" />

        <!-- Sharing mode (only when more than one family is on the trip) -->
        <v-select
          v-if="families.length > 1"
          v-model="form.sharing"
          :items="sharingOptions"
          item-title="label"
          item-value="value"
          label="Sharing"
          variant="outlined"
          density="compact"
          hide-details
          class="mb-3"
        />

        <!-- Cost / confirmation. Privacy depends on the sharing mode. -->
        <div v-if="form.sharing === 'shared_separate'" class="text-caption text-medium-emphasis font-weight-medium mb-1">
          Your household's details — private to your family
        </div>
        <div v-else-if="form.sharing === 'shared_one_separate'" class="text-caption text-medium-emphasis font-weight-medium mb-1">
          Confirmation # is shared; your cost is private to your family
        </div>
        <div class="d-flex flex-wrap ga-3 mb-3">
          <v-text-field v-model="form.confirmation" :label="form.sharing === 'shared_one_separate' ? 'Confirmation # (shared)' : 'Confirmation #'" variant="outlined" density="compact" hide-details class="flex-field" />
          <v-text-field v-model.number="form.cost" :label="PRIVATE_BILL.includes(form.sharing) && families.length > 1 ? 'Your cost' : 'Cost'" type="number" prefix="$" variant="outlined" density="compact" hide-details class="cost-field" />
          <v-combobox v-model="form.currency" :items="CURRENCIES" label="Currency" variant="outlined" density="compact" hide-details class="currency-field" />
        </div>

        <!-- Sharing details -->
        <div v-if="families.length > 1 && form.sharing !== 'private'" class="share-box mb-3">
          <!-- Participants -->
          <div class="text-caption text-medium-emphasis font-weight-medium mb-1">
            {{ form.sharing === 'shared_shared' ? "Families & each one's share" : 'Families sharing this booking' }}
            <v-btn v-if="form.sharing === 'shared_shared'" size="x-small" variant="text" color="#5E35B1" class="ml-1" @click="splitEqually">Split equally</v-btn>
          </div>
          <div v-for="row in shareRows" :key="row.householdId" class="d-flex align-center ga-2 mb-1">
            <v-checkbox-btn v-model="row.included" density="compact" hide-details />
            <span class="share-name">{{ row.name }}</span>
            <v-text-field
              v-if="form.sharing === 'shared_shared'"
              v-model.number="row.amount"
              type="number" :disabled="!row.included"
              variant="outlined" density="compact" hide-details
              style="max-width: 120px"
            />
          </div>
          <div v-if="form.sharing === 'shared_shared'" class="text-caption mt-1" :class="shareSumMismatch ? 'text-warning' : 'text-medium-emphasis'">
            Shares total {{ shareSum }}<span v-if="form.cost != null"> of {{ form.cost }}</span>
            <span v-if="shareSumMismatch"> — doesn't match the cost</span>
          </div>

          <v-select
            v-if="form.sharing === 'shared_shared'"
            v-model="form.paidByHouseholdId"
            :items="includedFamilies"
            item-title="name"
            item-value="householdId"
            label="Paid by (fronted the bill)"
            variant="outlined"
            density="compact"
            hide-details
            class="mt-2"
          />

          <!-- Confirmation status (separate bookings) -->
          <template v-if="form.sharing === 'shared_separate'">
            <v-switch v-model="form.confirmed" :label="form.confirmed ? 'Our family has booked it' : 'Our family hasn\'t booked it yet'" color="#2E7D32" density="compact" hide-details inset class="mt-1" />
            <div v-if="otherConfirmations.length" class="mt-1">
              <div class="text-caption text-medium-emphasis mb-1">Other families</div>
              <div v-for="c in otherConfirmations" :key="c.householdId" class="d-flex align-center ga-1 text-body-2">
                <v-icon size="15" :color="c.confirmed ? '#2E7D32' : 'medium-emphasis'">{{ c.confirmed ? 'mdi-check-circle' : 'mdi-circle-outline' }}</v-icon>
                {{ c.name }} — {{ c.confirmed ? 'booked' : 'not yet' }}
              </div>
            </div>
          </template>
        </div>

        <!-- Booked toggle for private / one-shared-booking -->
        <v-switch
          v-if="families.length <= 1 || form.sharing !== 'shared_separate'"
          v-model="form.confirmed"
          :label="form.confirmed ? 'Booked' : 'Not booked yet'"
          color="#2E7D32" density="compact" hide-details inset class="mb-2"
        />
        <v-text-field v-model="form.url" label="URL (optional)" type="url" variant="outlined" density="compact" hide-details class="mb-3" />
        <v-text-field v-model="form.phone" label="Phone (optional)" type="tel" variant="outlined" density="compact" hide-details class="mb-3" />
        <v-textarea v-model="form.notes" label="Notes (optional)" variant="outlined" rows="2" auto-grow hide-details />

        <!-- Attachments -->
        <v-divider class="my-4" />
        <div class="d-flex align-center justify-space-between mb-2">
          <div class="text-subtitle-2 font-weight-medium">Confirmations &amp; documents</div>
          <v-btn size="small" variant="text" color="#5E35B1" prepend-icon="mdi-paperclip" @click="attachFileInput?.click()">Add file</v-btn>
        </div>
        <input ref="attachFileInput" type="file" accept="application/pdf,image/*,message/rfc822,.eml" hidden @change="onAttachmentFile" />
        <div v-if="!attachments.length && !pendingFiles.length" class="text-caption text-medium-emphasis">No files attached.</div>
        <div v-else class="attach-list">
          <a v-for="att in attachments" :key="att._id" class="attach-row" :href="attachmentUrl(att)" target="_blank" rel="noopener">
            <v-icon size="18" :color="fileIcon(att.fileType, att.filename).color">{{ fileIcon(att.fileType, att.filename).icon }}</v-icon>
            <span class="attach-name">{{ att.filename }}</span>
            <span class="attach-size">{{ fileSize(att.fileSizeBytes) }}</span>
            <v-btn icon="mdi-close" size="x-small" variant="text" color="medium-emphasis" @click.prevent.stop="deleteAttachment(att)" />
          </a>
          <div v-for="(f, idx) in pendingFiles" :key="`p-${idx}`" class="attach-row attach-row--pending">
            <v-icon size="18" :color="fileIcon(f.type, f.name).color">{{ fileIcon(f.type, f.name).icon }}</v-icon>
            <span class="attach-name">{{ f.name }}</span>
            <span class="attach-size">attaches on save</span>
            <v-btn icon="mdi-close" size="x-small" variant="text" color="medium-emphasis" @click="removePending(idx)" />
          </div>
        </div>
      </v-card-text>

      <v-divider />
      <v-card-actions class="pa-4">
        <v-btn v-if="isEdit && isBookingOwner" color="error" variant="text" :loading="saving" @click="remove">Delete</v-btn>
        <v-btn v-else-if="isEdit" color="error" variant="text" prepend-icon="mdi-exit-run" :loading="saving" @click="leaveBooking">Leave booking</v-btn>
        <v-spacer />
        <v-btn variant="text" @click="goBack">Cancel</v-btn>
        <v-btn color="#5E35B1" variant="elevated" :loading="saving" :disabled="!canSave" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { format } from 'date-fns';
import { tripsApi, placesApi } from '../services/api';
import { zonedWallclockToUtc, zonedParts } from '../utils/tz';
import { useSmartBack, useReturnTo } from '../composables/useSmartBack';
import { useAuthStore } from '../stores/auth';
import { useConfirm } from '../composables/useConfirm';

const { confirm } = useConfirm();

const route = useRoute();
const router = useRouter();
const goBack = useSmartBack();
const returnTo = useReturnTo();
const auth = useAuthStore();
const myFamilyId = computed(() => auth.user?.householdId || null);

const isEdit = computed(() => !!route.params.itemId);
const tripId = route.params.id;
const loading = ref(false);
const saving = ref(false);
// Destination timezone of the trip — non-journey bookings (hotel, restaurant,
// activity, …) are entered/displayed as wall-clock in this zone. Empty falls
// back to browser-local inside the tz helpers.
const destinationTz = ref('');

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'CNY', 'MXN', 'INR'];

const SHARING_OPTIONS = [
  { value: 'private',             label: 'Not shared outside household' },
  { value: 'shared_separate',     label: 'Shared with other families — separate bookings' },
  { value: 'shared_one_separate', label: 'Shared with other families — one booking, separate bills' },
  { value: 'shared_shared',       label: 'Shared with other families — one booking, one shared bill' },
];
// Modes where each family enters its own private cost.
const PRIVATE_BILL = ['shared_separate', 'shared_one_separate'];

const TYPES = [
  { value: 'flight',     label: 'Flight',     icon: 'mdi-airplane',               color: '#1565C0' },
  { value: 'hotel',      label: 'Hotel',      icon: 'mdi-bed',                    color: '#6A1B9A' },
  { value: 'car-rental', label: 'Car',        icon: 'mdi-car',                    color: '#2E7D32' },
  { value: 'restaurant', label: 'Restaurant', icon: 'mdi-silverware-fork-knife',  color: '#C62828' },
  { value: 'activity',   label: 'Activity',   icon: 'mdi-ticket-outline',         color: '#EF6C00' },
  { value: 'transit',    label: 'Transit',    icon: 'mdi-train-car',              color: '#00838F' },
  { value: 'other',      label: 'Other',      icon: 'mdi-map-marker-outline',     color: '#546E7A' },
];

// Standard-type form configuration (journey types handled separately)
const TYPE_CFG = {
  hotel: {
    titleLabel: 'Hotel name', titlePlaceholder: 'Hotel Roma',
    startLabel: 'Check-in', endLabel: 'Check-out', showLocation: true, locationLabel: 'Address',
    detailFields: [{ key: 'roomType', label: 'Room type' }],
  },
  'car-rental': {
    titleLabel: 'Rental', titlePlaceholder: 'Hertz — Compact',
    startLabel: 'Pick-up', endLabel: 'Drop-off', showLocation: true, locationLabel: 'Pick-up location',
    detailFields: [{ key: 'company', label: 'Company' }, { key: 'dropoffLocation', label: 'Drop-off location' }],
  },
  restaurant: {
    titleLabel: 'Restaurant', titlePlaceholder: 'Trattoria da Enzo',
    startLabel: 'Reservation', endLabel: 'End', showLocation: true, locationLabel: 'Location',
    detailFields: [{ key: 'partySize', label: 'Party size', type: 'number' }],
  },
  activity: {
    titleLabel: 'Activity', titlePlaceholder: 'Colosseum tour',
    startLabel: 'Start', endLabel: 'End', showLocation: true, locationLabel: 'Location',
    detailFields: [{ key: 'tickets', label: 'Tickets', type: 'number' }],
  },
  other: {
    titleLabel: 'Title', titlePlaceholder: 'Booking',
    startLabel: 'Start', endLabel: 'End', showLocation: true, locationLabel: 'Location',
    detailFields: [],
  },
  flight: { titleLabel: 'Flight', titlePlaceholder: 'Toronto to Rome' },
  transit: { titleLabel: 'Transit', titlePlaceholder: 'Train to Florence' },
};

const today = route.query.date || format(new Date(), 'yyyy-MM-dd');

const form = ref({
  type: 'activity',
  title: '',
  // standard
  startDate: today, startTime: '09:00', endDate: '', endTime: '',
  durH: 0, durM: 0,
  locationRaw: '', placeId: '',
  // journey
  depRaw: '', depPlaceId: '', departureTz: '', depDate: today, depTime: '09:00',
  arrRaw: '', arrPlaceId: '', arrivalTz: '', arrDate: today, arrTime: '12:00',
  // common
  confirmation: '', cost: null, currency: '', url: '', phone: '', notes: '',
  details: {},
  // cost sharing
  sharing: 'private', paidByHouseholdId: null, confirmed: false,
});

// Confirmation status of other families (shared_separate, read-only)
const confirmations = ref([]);
const otherConfirmations = computed(() => confirmations.value.filter(c => String(c.householdId) !== String(myFamilyId.value)));

// Booking ownership: only the creating household can delete or make it private.
const isBookingOwner = ref(true);
const sharingOptions = computed(() => isBookingOwner.value ? SHARING_OPTIONS : SHARING_OPTIONS.filter(o => o.value !== 'private'));

const isJourney = computed(() => form.value.type === 'flight' || form.value.type === 'transit');
const cfg = computed(() => TYPE_CFG[form.value.type] ?? TYPE_CFG.other);

// ── Cost sharing across families ────────────────────────────────────────────────
const families = ref([]);                 // [{ householdId, name }]
const shareRows = ref([]);                // [{ householdId, name, included, amount }]
const includedFamilies = computed(() => shareRows.value.filter(r => r.included));
const shareSum = computed(() => shareRows.value.filter(r => r.included).reduce((s, r) => s + (Number(r.amount) || 0), 0));
const shareSumMismatch = computed(() => form.value.cost != null && Math.abs(shareSum.value - Number(form.value.cost)) > 0.01);

function buildShareRows(existing = []) {
  const byId = Object.fromEntries(existing.map(s => [String(s.householdId), s.amount]));
  shareRows.value = families.value.map(f => ({
    householdId: String(f.householdId),
    name: f.name,
    included: existing.length ? Object.prototype.hasOwnProperty.call(byId, String(f.householdId)) : String(f.householdId) === String(myFamilyId.value),
    amount: byId[String(f.householdId)] ?? null,
  }));
}

function splitEqually() {
  const inc = shareRows.value.filter(r => r.included);
  if (!inc.length || form.value.cost == null) return;
  const each = Math.round((Number(form.value.cost) / inc.length) * 100) / 100;
  inc.forEach(r => { r.amount = each; });
}

// When the user first switches to a shared mode, seed the share rows.
watch(() => form.value.sharing, (val) => {
  if (val !== 'private' && !shareRows.value.some(r => r.included && r.amount != null)) {
    if (!shareRows.value.length) buildShareRows();
    if (form.value.cost != null) splitEqually();
    if (val === 'shared_shared' && !form.value.paidByHouseholdId) form.value.paidByHouseholdId = myFamilyId.value;
  }
});

// Types where the user enters a duration and the end time is derived from it.
const DURATION_TYPES = ['restaurant', 'activity', 'other'];
const usesDuration = computed(() => DURATION_TYPES.includes(form.value.type));
const durationMins = computed(() => (Number(form.value.durH) || 0) * 60 + (Number(form.value.durM) || 0));

// Derived end (instant + local label) from start + duration, in the destination zone.
const endInfo = computed(() => {
  if (!usesDuration.value || !durationMins.value || !form.value.startDate) return null;
  const startUtc = zonedWallclockToUtc(form.value.startDate, form.value.startTime, destinationTz.value);
  if (!startUtc) return null;
  const endUtc = new Date(startUtc.getTime() + durationMins.value * 60000);
  const p = zonedParts(endUtc.toISOString(), destinationTz.value);
  return { iso: endUtc.toISOString(), dateStr: p.dateStr, timeStr: p.timeStr, crossesDay: p.dateStr !== form.value.startDate };
});

const journeyLabels = computed(() => form.value.type === 'flight'
  ? { dep: 'Departure airport', arr: 'Arrival airport' }
  : { dep: 'Departure station / port', arr: 'Arrival station / port' });

const canSave = computed(() => {
  if (!form.value.title.trim()) return false;
  return isJourney.value
    ? !!(form.value.depDate && form.value.depTime)
    : !!(form.value.startDate && form.value.startTime);
});

// ── Places autocomplete (location, dep, arr) ────────────────────────────────────
const suggestions = ref({ location: [], dep: [], arr: [] });
const placesLoading = ref({ location: false, dep: false, arr: false });
const tzLoading = ref({ dep: false, arr: false });
const timers = {};

function rawFor(key) {
  return key === 'location' ? form.value.locationRaw : key === 'dep' ? form.value.depRaw : form.value.arrRaw;
}

function makeSearch(key, type) {
  return (query) => {
    clearTimeout(timers[key]);
    const cur = rawFor(key);
    if (cur && typeof cur === 'object' && cur.description === query) return;
    if (!query || query.length < 3) { suggestions.value[key] = []; return; }
    // Journey endpoints restrict to airports (flights) or stations/ports (transit)
    const reqType = type === 'journey'
      ? (form.value.type === 'flight' ? 'airport' : 'transit')
      : type;
    timers[key] = setTimeout(async () => {
      placesLoading.value[key] = true;
      try {
        const { data } = await placesApi.autocomplete(query, reqType);
        suggestions.value[key] = data.predictions ?? [];
      } catch {
        suggestions.value[key] = [];
      } finally {
        placesLoading.value[key] = false;
      }
    }, 350);
  };
}

const searchLocation = makeSearch('location');     // establishment
const searchDep = makeSearch('dep', 'journey');    // airports (flight) / stations (transit)
const searchArr = makeSearch('arr', 'journey');

async function onJourneyPlaceSelected(which, val) {
  if (!val || typeof val !== 'object' || !val.place_id) return;
  if (which === 'dep') { form.value.depPlaceId = val.place_id; form.value.departureTz = ''; tzLoading.value.dep = true; }
  else { form.value.arrPlaceId = val.place_id; form.value.arrivalTz = ''; tzLoading.value.arr = true; }
  try {
    const { data } = await placesApi.getTimezone(val.place_id);
    const tz = data.timeZoneId || '';
    if (which === 'dep') form.value.departureTz = tz; else form.value.arrivalTz = tz;
  } catch {
    /* timezone lookup unavailable — leave blank, time is still usable */
  } finally {
    if (which === 'dep') tzLoading.value.dep = false; else tzLoading.value.arr = false;
  }
}

const nameOf = (raw) => raw && typeof raw === 'object' ? (raw.description ?? '') : (raw ?? '');

// Wall-clock date+time at the destination → ISO UTC instant.
function toIso(dateStr, timeStr) {
  if (!dateStr) return undefined;
  return zonedWallclockToUtc(dateStr, timeStr, destinationTz.value)?.toISOString();
}

function prunedDetails() {
  const out = {};
  for (const [k, v] of Object.entries(form.value.details)) {
    if (v !== '' && v != null) out[k] = v;
  }
  return out;
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    let payload;
    const mode = families.value.length > 1 ? form.value.sharing : 'private';
    const common = { url: form.value.url || undefined, phone: form.value.phone || undefined, notes: form.value.notes || undefined };

    let sharePayload;
    if (mode === 'shared_separate') {
      sharePayload = {
        sharing: 'shared_separate',
        participants: shareRows.value.filter(r => r.included).map(r => r.householdId),
        myData: {
          cost: form.value.cost ?? null,
          currency: form.value.currency || undefined,
          confirmation: form.value.confirmation || undefined,
          partySize: form.value.details?.partySize ?? undefined,
          confirmed: !!form.value.confirmed,
        },
      };
    } else if (mode === 'shared_one_separate') {
      sharePayload = {
        sharing: 'shared_one_separate',
        participants: shareRows.value.filter(r => r.included).map(r => r.householdId),
        confirmation: form.value.confirmation || undefined,   // one booking → shared
        confirmed: !!form.value.confirmed,                    // shared single status
        myData: { cost: form.value.cost ?? null, currency: form.value.currency || undefined },
      };
    } else if (mode === 'shared_shared') {
      sharePayload = {
        sharing: 'shared_shared',
        cost: form.value.cost ?? undefined,
        currency: form.value.currency || undefined,
        confirmation: form.value.confirmation || undefined,
        confirmed: !!form.value.confirmed,
        shares: shareRows.value.filter(r => r.included).map(r => ({ householdId: r.householdId, amount: r.amount ?? undefined })),
        paidByHouseholdId: form.value.paidByHouseholdId || undefined,
      };
    } else {
      sharePayload = {
        sharing: 'private',
        cost: form.value.cost ?? undefined,
        currency: form.value.currency || undefined,
        confirmation: form.value.confirmation || undefined,
        confirmed: !!form.value.confirmed,
      };
    }
    Object.assign(common, sharePayload);

    if (isJourney.value) {
      const depName = nameOf(form.value.depRaw);
      const arrName = nameOf(form.value.arrRaw);
      const start = zonedWallclockToUtc(form.value.depDate, form.value.depTime, form.value.departureTz);
      const end = form.value.arrDate
        ? zonedWallclockToUtc(form.value.arrDate, form.value.arrTime, form.value.arrivalTz)
        : undefined;
      const details = prunedDetails();
      details.departureName = depName || undefined;
      details.departurePlaceId = form.value.depPlaceId || undefined;
      details.departureTz = form.value.departureTz || undefined;
      details.arrivalName = arrName || undefined;
      details.arrivalPlaceId = form.value.arrPlaceId || undefined;
      details.arrivalTz = form.value.arrivalTz || undefined;

      payload = {
        type: form.value.type,
        title: form.value.title.trim(),
        start: start.toISOString(),
        end: end ? end.toISOString() : undefined,
        location: depName || undefined,
        details: Object.keys(details).length ? details : undefined,
        ...common,
      };
    } else {
      const raw = form.value.locationRaw;
      const location = nameOf(raw);
      const placeId = raw && typeof raw === 'object' ? raw.place_id : form.value.placeId || undefined;
      const details = prunedDetails();
      if (mode === 'shared_separate') delete details.partySize;   // private per family
      // Duration-driven types derive end from start + duration; others use the end fields.
      const end = usesDuration.value
        ? (endInfo.value ? endInfo.value.iso : undefined)
        : (form.value.endDate ? toIso(form.value.endDate, form.value.endTime) : undefined);
      payload = {
        type: form.value.type,
        title: form.value.title.trim(),
        start: toIso(form.value.startDate, form.value.startTime),
        end,
        location: location || undefined,
        placeId,
        details: Object.keys(details).length ? details : undefined,
        ...common,
      };
    }

    let itemId = route.params.itemId;
    if (isEdit.value) {
      await tripsApi.updateItem(tripId, itemId, payload);
    } else {
      const { data } = await tripsApi.addItem(tripId, payload);
      itemId = data._id;
    }
    // Attach any files staged during creation
    for (const f of pendingFiles.value) {
      try { await tripsApi.addAttachment(tripId, itemId, f); } catch { /* skip a failed file */ }
    }
    returnTo(`/vacations/${tripId}`);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!(await confirm({
    title: 'Delete booking?', confirmText: 'Delete', confirmColor: 'error',
  }))) return;
  saving.value = true;
  try {
    await tripsApi.removeItem(tripId, route.params.itemId);
    returnTo(`/vacations/${tripId}`);
  } finally {
    saving.value = false;
  }
}

async function leaveBooking() {
  if (!(await confirm({
    title: 'Leave booking?',
    message: "Your family's details and files for it will be removed.",
    confirmText: 'Leave', confirmColor: 'error',
  }))) return;
  saving.value = true;
  try {
    await tripsApi.leaveItem(tripId, route.params.itemId);
    returnTo(`/vacations/${tripId}`);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    const { data } = await tripsApi.get(tripId);
    destinationTz.value = data.trip?.destinationTz || '';

    // Families on the trip (for cost sharing). Only relevant when 2+ families.
    try { families.value = (await tripsApi.families(tripId)).data || []; } catch { families.value = []; }
    buildShareRows();

    if (!isEdit.value) {
      // Prefill currency from the trip's base currency for convenience.
      if (data.trip?.baseCurrency) form.value.currency = data.trip.baseCurrency;
      return;
    }

    const item = data.items.find(i => i._id === route.params.itemId);
    if (!item) { router.replace(`/vacations/${tripId}`); return; }
    attachments.value = item.attachments ?? [];
    const d = item.details ?? {};
    // Restore cost-sharing state
    confirmations.value = item.confirmations || [];
    if (item.sharing === 'shared_separate') {
      buildShareRows((item.participants || []).map(id => ({ householdId: id })));
      if (item.myData?.partySize != null) d.partySize = item.myData.partySize;
    } else if (item.sharing === 'shared_one_separate') {
      buildShareRows((item.participants || []).map(id => ({ householdId: id })));
    } else if (item.sharing === 'shared_shared' && item.shares?.length) {
      buildShareRows(item.shares);
    }

    if (item.type === 'flight' || item.type === 'transit') {
      const dep = zonedParts(item.start, d.departureTz);
      const arr = item.end ? zonedParts(item.end, d.arrivalTz) : null;
      form.value = {
        ...form.value,
        type: item.type,
        title: item.title ?? '',
        depRaw: d.departureName ?? item.location ?? '',
        depPlaceId: d.departurePlaceId ?? '',
        departureTz: d.departureTz ?? '',
        depDate: dep.dateStr,
        depTime: dep.timeStr,
        arrRaw: d.arrivalName ?? '',
        arrPlaceId: d.arrivalPlaceId ?? '',
        arrivalTz: d.arrivalTz ?? '',
        arrDate: arr ? arr.dateStr : '',
        arrTime: arr ? arr.timeStr : '',
        confirmation: item.confirmation ?? '',
        cost: item.cost ?? null,
        currency: item.currency ?? '',
        url: item.url ?? '',
        phone: item.phone ?? '',
        notes: item.notes ?? '',
        details: item.type === 'flight'
          ? { airline: d.airline ?? '', flightNumber: d.flightNumber ?? '', seat: d.seat ?? '' }
          : { mode: d.mode ?? '' },
      };
    } else {
      const sp = item.start ? zonedParts(item.start, destinationTz.value) : null;
      const ep = item.end ? zonedParts(item.end, destinationTz.value) : null;
      // For duration-driven types, back-compute hours/minutes from the stored end.
      let durH = 0, durM = 0;
      if (DURATION_TYPES.includes(item.type) && item.start && item.end) {
        const mins = Math.max(0, Math.round((new Date(item.end) - new Date(item.start)) / 60000));
        durH = Math.floor(mins / 60);
        durM = mins % 60;
      }
      form.value = {
        ...form.value,
        type: item.type,
        title: item.title ?? '',
        startDate: sp ? sp.dateStr : '',
        startTime: sp ? sp.timeStr : '09:00',
        endDate: ep ? ep.dateStr : '',
        endTime: ep ? ep.timeStr : '',
        durH, durM,
        locationRaw: item.location ?? '',
        placeId: item.placeId ?? '',
        confirmation: item.confirmation ?? '',
        cost: item.cost ?? null,
        currency: item.currency ?? '',
        url: item.url ?? '',
        phone: item.phone ?? '',
        notes: item.notes ?? '',
        details: { ...d },
      };
    }
    form.value.sharing = item.sharing || 'private';
    form.value.paidByHouseholdId = item.paidByHouseholdId || null;
    form.value.confirmed = item.sharing === 'shared_separate' ? !!item.myData?.confirmed : !!item.confirmed;
    isBookingOwner.value = !item.householdId || String(item.householdId) === String(myFamilyId.value);
  } finally {
    loading.value = false;
  }
});

// Manual type switch clears stale detail fields (programmatic prefill must not).
function selectType(t) {
  if (t === form.value.type) return;
  form.value.type = t;
  form.value.details = {};
}

// ── Attachments + AI auto-fill from a confirmation ──────────────────────────────
const attachments = ref([]);    // saved attachments (edit mode, have _id)
const pendingFiles = ref([]);   // File[] staged for upload after the booking is created
const extracting = ref(false);
const extractError = ref('');
const confirmText = ref('');
const showPaste = ref(false);
const confirmFileInput = ref(null);
const attachFileInput = ref(null);

const attachmentUrl = (att) => tripsApi.attachmentUrl(tripId, route.params.itemId, att._id);
const fileSize = (bytes) => bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
function fileIcon(type = '', name = '') {
  if (type === 'message/rfc822' || /\.eml$/i.test(name)) return { icon: 'mdi-email-outline', color: '#5E35B1' };
  if (type.startsWith('image/')) return { icon: 'mdi-image', color: '#00838F' };
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return { icon: 'mdi-file-pdf-box', color: '#C62828' };
  return { icon: 'mdi-file-outline', color: '#546E7A' };
}

function applyDraft(d) {
  form.value.type = d.type || form.value.type;
  form.value.title = d.title || form.value.title;
  form.value.confirmation = d.confirmation || '';
  form.value.cost = d.cost ?? null;
  form.value.currency = d.currency || '';
  form.value.url = d.url || '';
  form.value.phone = d.phone || '';
  form.value.notes = d.notes || '';
  if (d.type === 'flight' || d.type === 'transit') {
    form.value.depRaw = d.departure?.name || '';
    form.value.depPlaceId = d.departure?.placeId || '';
    form.value.departureTz = d.departure?.tz || '';
    form.value.depDate = d.departure?.date || form.value.depDate;
    form.value.depTime = d.departure?.time || form.value.depTime;
    form.value.arrRaw = d.arrival?.name || '';
    form.value.arrPlaceId = d.arrival?.placeId || '';
    form.value.arrivalTz = d.arrival?.tz || '';
    form.value.arrDate = d.arrival?.date || '';
    form.value.arrTime = d.arrival?.time || '';
    form.value.details = d.details || {};
  } else {
    form.value.startDate = d.start?.date || form.value.startDate;
    form.value.startTime = d.start?.time || form.value.startTime;
    form.value.endDate = d.end?.date || '';
    form.value.endTime = d.end?.time || '';
    form.value.locationRaw = d.location || '';
    form.value.details = d.details || {};
    // For duration-driven types, convert an extracted end into a duration.
    if (DURATION_TYPES.includes(d.type) && d.start?.date && d.end?.date) {
      const s = zonedWallclockToUtc(d.start.date, d.start.time, destinationTz.value);
      const e = zonedWallclockToUtc(d.end.date, d.end.time, destinationTz.value);
      if (s && e && e > s) {
        const m = Math.round((e - s) / 60000);
        form.value.durH = Math.floor(m / 60);
        form.value.durM = m % 60;
      }
    }
  }
}

async function runExtraction({ file, text }) {
  extracting.value = true;
  extractError.value = '';
  try {
    const { data } = await tripsApi.extractConfirmation(tripId, { file, text });
    applyDraft(data);
    if (file) pendingFiles.value.push(file);  // keep the confirmation attached to the booking
    showPaste.value = false;
    confirmText.value = '';
  } catch (e) {
    extractError.value = e.response?.data?.error || 'Could not read that confirmation';
  } finally {
    extracting.value = false;
  }
}

function onConfirmationFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) runExtraction({ file });
}

function extractFromText() {
  if (confirmText.value.trim()) runExtraction({ text: confirmText.value.trim() });
}

// Add a plain attachment (not for extraction). Uploads immediately when editing.
async function onAttachmentFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (isEdit.value) {
    try {
      const { data } = await tripsApi.addAttachment(tripId, route.params.itemId, file);
      attachments.value.push(data);
    } catch (err) {
      extractError.value = err.response?.data?.error || 'Upload failed';
    }
  } else {
    pendingFiles.value.push(file);
  }
}

async function deleteAttachment(att) {
  try {
    await tripsApi.removeAttachment(tripId, route.params.itemId, att._id);
    attachments.value = attachments.value.filter(a => a._id !== att._id);
  } catch { /* ignore */ }
}

function removePending(idx) { pendingFiles.value.splice(idx, 1); }
</script>

<style scoped>
.type-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.type-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 76px;
  padding: 10px 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.type-option:hover { border-color: rgba(var(--v-theme-on-surface), 0.35); }
.leg-card {
  padding: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.tz-line {
  display: flex;
  align-items: center;
  margin-top: 8px;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.detail-field { min-width: 140px; flex: 1 1 140px; }
.dur-field { max-width: 110px; }
.share-box {
  padding: 12px;
  border: 1px solid rgba(94, 53, 177, 0.2);
  border-radius: 10px;
  background: rgba(94, 53, 177, 0.04);
}
.share-name { flex: 1; font-size: 0.85rem; }
.flex-field { flex: 1 1 160px; }
.cost-field { max-width: 110px; }
.currency-field { max-width: 100px; }

.autofill {
  padding: 12px;
  border: 1px dashed rgba(94, 53, 177, 0.4);
  border-radius: 10px;
  background: rgba(94, 53, 177, 0.04);
}
.attach-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.attach-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
}
.attach-row:hover { background: rgba(var(--v-theme-on-surface), 0.03); }
.attach-row--pending { border-style: dashed; }
.attach-name {
  flex: 1;
  font-size: 0.82rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attach-size {
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  flex-shrink: 0;
}
</style>
