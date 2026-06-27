<template>
  <v-container class="py-6 px-4" style="max-width: 720px">
    <!-- Header -->
    <div class="d-flex align-center mb-4">
      <BackButton class="mr-2" />
      <div>
        <h1 class="text-h5 font-weight-bold">Settle up</h1>
        <div class="text-body-2 text-medium-emphasis">{{ trip?.name ?? '...' }}</div>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="#5E35B1" />
    </div>

    <template v-else>
      <!-- Who owes whom -->
      <v-card rounded="lg" elevation="1" class="mb-5">
        <v-card-text class="py-4 px-4">
          <div class="section-label" style="color:#5E35B1">Balances</div>

          <template v-if="balances.length">
            <div v-for="(b, i) in balances" :key="i" class="balance-group" :class="{ 'mt-3': i > 0 }">
              <div class="d-flex align-center">
                <v-icon size="18" color="#5E35B1" class="mr-2">mdi-account-arrow-right-outline</v-icon>
                <span class="flex-grow-1 text-body-2">
                  <strong>{{ b.fromName }}</strong> owes <strong>{{ b.toName }}</strong>
                </span>
                <span class="font-weight-bold mr-2">{{ money(b.amount) }}</span>
                <v-btn size="x-small" variant="tonal" color="#2E7D32" @click="prefillFromBalance(b)">Pay</v-btn>
              </div>

              <!-- What makes up this balance -->
              <div class="breakdown">
                <component
                  :is="line.itemId ? 'router-link' : 'div'"
                  v-for="(line, li) in b.lines"
                  :key="li"
                  :to="line.itemId ? `/vacations/${tripId}/items/${line.itemId}/edit` : undefined"
                  class="breakdown-row"
                  :class="{ 'breakdown-row--link': line.itemId }"
                >
                  <v-icon size="14" :color="lineMeta(line).color" class="mr-2 flex-shrink-0">{{ lineMeta(line).icon }}</v-icon>
                  <span class="flex-grow-1 text-truncate">{{ lineMeta(line).label }}</span>
                  <span class="flex-shrink-0" :class="line.amount < 0 ? 'text-success' : 'text-medium-emphasis'">
                    {{ line.amount < 0 ? '−' : '+' }}{{ money(abs(line.amount)) }}
                  </span>
                  <v-icon v-if="line.itemId" size="13" color="medium-emphasis" class="ml-1 flex-shrink-0">mdi-chevron-right</v-icon>
                </component>
              </div>
            </div>
            <div class="text-caption text-medium-emphasis mt-3">
              Estimated, in {{ baseCurrency }} · tap a booking to open it, or “Pay” to record a payment
            </div>
          </template>

          <div v-else class="d-flex align-center text-body-2 text-medium-emphasis py-2">
            <v-icon color="success" class="mr-2">mdi-check-circle</v-icon>
            Everyone is settled up.
          </div>

          <div v-if="!ratesAvailable" class="text-caption text-warning mt-2">
            <v-icon size="12" class="mr-1">mdi-alert</v-icon>Exchange rates unavailable — only same-currency costs are totalled.
          </div>
        </v-card-text>
      </v-card>

      <!-- Record a payment -->
      <v-card rounded="lg" elevation="1" class="mb-5">
        <v-card-text class="py-4 px-4">
          <div class="section-label" style="color:#2E7D32">Record a payment</div>

          <div class="d-flex ga-2">
            <v-select
              v-model="form.from"
              :items="householdOptions"
              item-title="name"
              item-value="householdId"
              label="From"
              variant="outlined"
              density="compact"
              hide-details
            />
            <v-icon class="align-self-center" color="medium-emphasis">mdi-arrow-right</v-icon>
            <v-select
              v-model="form.to"
              :items="householdOptions"
              item-title="name"
              item-value="householdId"
              label="To"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>

          <div class="d-flex ga-2 mt-3">
            <v-text-field
              v-model.number="form.amount"
              label="Amount"
              type="number"
              min="0"
              :prefix="form.currency"
              variant="outlined"
              density="compact"
              hide-details
              class="flex-grow-1"
            />
            <v-select
              v-model="form.currency"
              :items="CURRENCIES"
              label="Currency"
              variant="outlined"
              density="compact"
              hide-details
              style="max-width: 120px"
            />
          </div>

          <v-text-field
            v-model="form.note"
            label="Note (optional)"
            variant="outlined"
            density="compact"
            hide-details
            class="mt-3"
          />

          <v-alert v-if="error" type="warning" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>

          <v-btn
            color="#2E7D32"
            variant="flat"
            block
            class="mt-4"
            :loading="saving"
            prepend-icon="mdi-cash-check"
            @click="savePayment"
          >
            Record payment
          </v-btn>
        </v-card-text>
      </v-card>

      <!-- Payment history -->
      <div v-if="payments.length">
        <div class="section-label mb-2">Recorded payments</div>
        <div v-for="p in payments" :key="p._id" class="payment-row">
          <div class="flex-grow-1 min-w-0">
            <div class="text-body-2">
              <strong>{{ p.fromName }}</strong> paid <strong>{{ p.toName }}</strong>
            </div>
            <div class="text-caption text-medium-emphasis">
              {{ fmtDate(p.date) }}<template v-if="p.note"> · {{ p.note }}</template>
            </div>
          </div>
          <span class="font-weight-medium mr-2">{{ money(p.amount, p.currency) }}</span>
          <v-btn icon="mdi-delete-outline" size="x-small" variant="text" color="medium-emphasis" :loading="deletingId === p._id" @click="removePayment(p)" />
        </div>
      </div>
    </template>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { format } from 'date-fns';
import { tripsApi } from '../services/api';

const route = useRoute();
const tripId = route.params.id;

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'CNY', 'MXN', 'INR'];
const TYPE_META = {
  flight:       { icon: 'mdi-airplane',              color: '#1565C0' },
  hotel:        { icon: 'mdi-bed',                   color: '#6A1B9A' },
  'car-rental': { icon: 'mdi-car',                   color: '#2E7D32' },
  restaurant:   { icon: 'mdi-silverware-fork-knife', color: '#C62828' },
  activity:     { icon: 'mdi-ticket-outline',        color: '#EF6C00' },
  transit:      { icon: 'mdi-train-car',             color: '#00838F' },
  other:        { icon: 'mdi-map-marker-outline',    color: '#546E7A' },
};
// Display meta for a breakdown line — a booking (links out) or a recorded payment.
function lineMeta(line) {
  if (line.kind === 'payment') {
    return { icon: 'mdi-cash-check', color: '#2E7D32', label: 'Payment recorded' };
  }
  const m = TYPE_META[line.type] || TYPE_META.other;
  return { icon: m.icon, color: m.color, label: line.title };
}

const loading = ref(true);
const saving = ref(false);
const deletingId = ref(null);
const error = ref('');

const trip = ref(null);
const baseCurrency = ref('CAD');
const ratesAvailable = ref(true);
const balances = ref([]);
const payments = ref([]);
const households = ref([]);
const myHouseholdId = ref(null);

const householdOptions = computed(() => households.value);

const abs = Math.abs;
function money(amount, cur) {
  const c = cur || baseCurrency.value;
  if (amount == null) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${c} ${Math.round(amount)}`; }
}
function fmtDate(d) {
  const dt = d ? new Date(d) : null;
  return dt && !Number.isNaN(dt.getTime()) ? format(dt, 'MMM d, yyyy') : '';
}

const form = ref({ from: null, to: null, amount: null, currency: 'CAD', note: '' });

function resetForm() {
  form.value = { from: myHouseholdId.value, to: null, amount: null, currency: baseCurrency.value, note: '' };
}
function prefillFromBalance(b) {
  form.value = { from: b.from, to: b.to, amount: b.amount, currency: baseCurrency.value, note: '' };
  error.value = '';
}

async function load() {
  loading.value = true;
  try {
    const [{ data: t }, { data: s }] = await Promise.all([
      tripsApi.get(tripId),
      tripsApi.settlement(tripId),
    ]);
    trip.value = t;
    baseCurrency.value = s.baseCurrency || 'CAD';
    ratesAvailable.value = s.ratesAvailable;
    balances.value = s.balances || [];
    payments.value = s.payments || [];
    households.value = s.households || [];
    myHouseholdId.value = s.myHouseholdId || null;
    resetForm();
  } finally {
    loading.value = false;
  }
}

async function savePayment() {
  error.value = '';
  if (!form.value.from || !form.value.to) { error.value = 'Pick who paid and who they paid.'; return; }
  if (form.value.from === form.value.to) { error.value = 'Pick two different families.'; return; }
  if (!(Number(form.value.amount) > 0)) { error.value = 'Enter an amount greater than zero.'; return; }
  saving.value = true;
  try {
    await tripsApi.addPayment(tripId, {
      from: form.value.from,
      to: form.value.to,
      amount: Number(form.value.amount),
      currency: form.value.currency,
      note: form.value.note,
    });
    await load();
  } catch (e) {
    error.value = e.response?.data?.error || 'Could not record that payment.';
  } finally {
    saving.value = false;
  }
}

async function removePayment(p) {
  deletingId.value = p._id;
  try {
    await tripsApi.removePayment(tripId, p._id);
    await load();
  } catch (e) {
    error.value = e.response?.data?.error || 'Could not delete that payment.';
  } finally {
    deletingId.value = null;
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
  margin-bottom: 10px;
}
.balance-group + .balance-group {
  border-top: 1px solid rgba(var(--v-theme-on-surface), .08);
  padding-top: 12px;
}
.breakdown {
  margin-top: 6px;
  margin-left: 26px;
}
.breakdown-row {
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), .7);
  padding: 3px 0;
  text-decoration: none;
}
.breakdown-row--link { cursor: pointer; }
.breakdown-row--link:hover { color: rgba(var(--v-theme-on-surface), 1); }
.payment-row {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), .08);
  border-radius: 10px;
  margin-bottom: 8px;
}
</style>
