<template>
  <v-container class="py-6 px-4" max-width="900">
    <!-- Header -->
    <div class="d-flex align-center mb-4">
      <BackButton color="#00897B" class="mr-1" />
      <h1 class="text-h4 font-weight-bold">Food Inventory</h1>
      <v-spacer />
      <v-btn
        :icon="true"
        variant="flat"
        color="#00897B"
        class="mr-2"
        to="/find-recipes"
      >
        <div class="find-recipes-icon">
          <v-icon size="20" color="white">mdi-book-open-page-variant-outline</v-icon>
          <v-icon size="11" color="white" class="find-recipes-badge">mdi-magnify</v-icon>
        </div>
      </v-btn>
      <v-btn
        icon="mdi-plus"
        color="#00897B"
        @click="openAddDialog"
      />
    </div>

    <!-- Search + Filter -->
    <div class="d-flex align-center ga-2" :class="selectedCategories.length ? 'mb-2' : 'mb-4'">
      <v-text-field
        v-model="search"
        placeholder="Search items…"
        variant="solo-filled"
        density="compact"
        prepend-inner-icon="mdi-magnify"
        clearable
        hide-details
        flat
      />
      <v-badge :model-value="activeFilterCount > 0" :content="activeFilterCount" color="primary">
        <v-btn icon="mdi-tune-variant" variant="tonal" @click="showFilters = true" />
      </v-badge>
    </div>

    <!-- Active category chips -->
    <div v-if="selectedCategories.length" class="d-flex flex-wrap align-center ga-2 mb-4">
      <v-chip
        v-for="c in selectedCategories"
        :key="c"
        size="small"
        color="primary"
        closable
        @click:close="removeCategory(c)"
      >{{ c }}</v-chip>
      <v-btn variant="text" size="small" @click="resetFilters">Clear all</v-btn>
    </div>

    <!-- Tabs -->
    <v-tabs v-model="activeTab" color="primary" class="mb-4">
      <v-tab value="active">In Stock</v-tab>
      <v-tab value="history">Used Up / Thrown Out</v-tab>
    </v-tabs>

    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <!-- In Stock Tab -->
    <v-window v-model="activeTab">
      <v-window-item value="active">
        <div v-if="!loading && !filteredItems.length" class="text-center py-16">
          <v-icon size="72" color="grey-lighten-1" class="mb-4">mdi-fridge-outline</v-icon>
          <div class="text-h6 text-medium-emphasis mb-1">No items in stock</div>
          <div class="text-body-2 text-medium-emphasis mb-6">Add items manually or scan a receipt</div>
          <v-btn color="#00897B" prepend-icon="mdi-plus" @click="openAddDialog">Add Item</v-btn>
        </div>

        <div v-else class="d-flex flex-column ga-5">
          <div v-for="group in groupedItems" :key="group.key">
            <div class="d-flex align-center justify-space-between mb-2 px-1">
              <span class="text-caption font-weight-bold text-uppercase" :style="{ color: group.accentColor }">{{ group.label }}</span>
              <span class="text-caption text-medium-emphasis">{{ group.items.length }} item{{ group.items.length === 1 ? '' : 's' }}</span>
            </div>
            <div class="d-flex flex-column ga-2">
              <v-card
                v-for="item in group.items"
                :key="item._id"
                rounded="lg"
                elevation="1"
                class="inventory-card"
                :style="{ borderLeft: `3px solid ${group.accentColor}` }"
                @click="openEditDialog(item)"
              >
                <v-card-text class="py-3 px-4">
                  <div class="d-flex align-center justify-space-between ga-3">
                    <div class="flex-1 min-width-0">
                      <div class="d-flex align-center ga-2 mb-1 flex-wrap">
                        <span class="font-weight-bold text-body-1">{{ item.name }}</span>
                        <span v-if="item.quantity" class="qty-badge">{{ item.quantity }}</span>
                      </div>
                      <div class="text-caption">
                        <span :style="{ color: group.accentColor }">{{ item.expirationDate ? expiryLabel(daysUntilExpiry(item.expirationDate)) : 'No expiry set' }}</span>
                        <span class="text-medium-emphasis mx-1">·</span>
                        <span class="text-medium-emphasis">{{ item.category }}</span>
                      </div>
                    </div>
                    <div class="d-flex align-center ga-2 flex-shrink-0" @click.stop>
                      <v-btn
                        icon
                        size="32"
                        variant="outlined"
                        color="success"
                        rounded="lg"
                        title="Mark as used"
                        @click="quickConsume(item, 'used')"
                      >
                        <v-icon size="16">mdi-check</v-icon>
                      </v-btn>
                      <v-btn
                        icon
                        size="32"
                        variant="outlined"
                        color="medium-emphasis"
                        rounded="lg"
                        title="Throw out"
                        @click="openThrowOutDialog(item)"
                      >
                        <v-icon size="16">mdi-trash-can-outline</v-icon>
                      </v-btn>
                    </div>
                  </div>
                </v-card-text>
              </v-card>
            </div>
          </div>
        </div>

      </v-window-item>

      <!-- History Tab -->
      <v-window-item value="history">
        <div v-if="!loading && !filteredHistoryItems.length" class="text-center py-16">
          <v-icon size="72" color="grey-lighten-1" class="mb-4">mdi-history</v-icon>
          <div class="text-h6 text-medium-emphasis mb-1">No history yet</div>
          <div class="text-body-2 text-medium-emphasis">Items you've used or thrown out will appear here</div>
        </div>

        <div v-else class="d-flex flex-column ga-5">
          <div v-for="group in groupedHistory" :key="group.key">
            <div class="d-flex align-center justify-space-between mb-2 px-1">
              <span class="text-caption font-weight-bold text-uppercase text-medium-emphasis">{{ group.label }}</span>
              <span class="text-caption text-medium-emphasis">{{ group.items.length }} item{{ group.items.length === 1 ? '' : 's' }}</span>
            </div>
            <div class="d-flex flex-column ga-2">
              <v-card
                v-for="item in group.items"
                :key="item._id"
                rounded="lg"
                elevation="1"
                class="inventory-card history-card"
                :style="{ borderLeft: `3px solid ${historyAccentColor(item.status)}` }"
                @click="openEditDialog(item)"
              >
                <v-card-text class="py-3 px-4">
                  <div class="d-flex align-center justify-space-between ga-3">
                    <div class="flex-1 min-width-0">
                      <div class="d-flex align-center ga-2 mb-1 flex-wrap">
                        <span class="font-weight-bold text-body-1">{{ item.name }}</span>
                        <span v-if="item.quantity" class="qty-badge qty-badge--dim">{{ item.quantity }}</span>
                      </div>
                      <div class="text-caption text-medium-emphasis">
                        <span :style="{ color: historyAccentColor(item.status) }">{{ item.status === 'used' ? 'Used up' : 'Thrown out' }}</span>
                        <span class="mx-1">·</span>
                        <span>{{ item.category }}</span>
                        <template v-if="item.statusDate">
                          <span class="mx-1">·</span>
                          <span>{{ formatDate(item.statusDate) }}</span>
                        </template>
                      </div>
                      <div v-if="item.wasteReason" class="text-caption text-medium-emphasis mt-1 font-italic">{{ item.wasteReason }}</div>
                    </div>
                    <div v-if="item.status === 'used'" @click.stop>
                      <v-btn
                        size="small"
                        variant="outlined"
                        color="error"
                        rounded="lg"
                        @click="quickMarkThrown(item)"
                      >
                        <v-icon size="14" start>mdi-trash-can-outline</v-icon>
                        Thrown out
                      </v-btn>
                    </div>
                  </div>
                </v-card-text>
              </v-card>
            </div>
          </div>
        </div>

        <!-- Waste stats -->
        <div v-if="thrownOutThisMonth > 0" class="text-center mt-6 pa-4 rounded-lg" style="background: rgba(var(--v-theme-error), 0.08)">
          <v-icon color="error" class="mr-1">mdi-trash-can-outline</v-icon>
          <span class="text-body-2 text-medium-emphasis">
            {{ thrownOutThisMonth }} item{{ thrownOutThisMonth === 1 ? '' : 's' }} thrown out this month
          </span>
        </div>
      </v-window-item>
    </v-window>
  </v-container>

  <!-- Filter Bottom Sheet -->
  <v-bottom-sheet v-model="showFilters">
    <v-card rounded="t-xl" class="pa-4">
      <div class="d-flex justify-space-between align-center mb-4">
        <span class="text-subtitle-1 font-weight-medium">Filters</span>
        <v-btn variant="text" size="small" color="#00897B" @click="resetFilters">Reset</v-btn>
      </div>

      <div class="text-caption text-medium-emphasis mb-2">Category</div>
      <v-chip-group v-model="selectedCategories" multiple filter column class="mb-4">
        <v-chip
          v-for="cat in categoryOptions.filter(c => c.value !== 'all')"
          :key="cat.value"
          :value="cat.value"
          size="small"
        >{{ cat.label }}</v-chip>
      </v-chip-group>

      <div class="text-caption text-medium-emphasis mb-2">Sort by</div>
      <v-btn-toggle v-model="sortBy" mandatory divided density="comfortable" class="mb-5 w-100">
        <v-btn value="expiry" class="flex-1-1">Expiry</v-btn>
        <v-btn value="name" class="flex-1-1">Name</v-btn>
        <v-btn value="added" class="flex-1-1">Added</v-btn>
      </v-btn-toggle>

      <v-btn block color="#00897B" @click="showFilters = false">
        Show {{ filteredItems.length }} item{{ filteredItems.length === 1 ? '' : 's' }}
      </v-btn>
    </v-card>
  </v-bottom-sheet>

  <!-- Add/Edit Item Dialog -->
  <v-dialog v-model="itemDialog" :max-width="editingItem ? 480 : 600" rounded="xl">
    <v-card rounded="xl">
      <v-card-title class="pt-5 pb-1">{{ editingItem ? 'Edit Item' : 'Add Item' }}</v-card-title>
      <template v-if="!editingItem">
        <v-tabs v-model="addTab" color="primary" class="px-2">
          <v-tab value="manual">Manually</v-tab>
          <v-tab value="receipt">From Receipt</v-tab>
        </v-tabs>
        <v-divider />
      </template>
      <v-card-text>
        <!-- Manual form -->
        <template v-if="editingItem || addTab === 'manual'">
          <v-text-field
            v-model="itemForm.name"
            label="Name *"
            variant="outlined"
            density="comfortable"
            class="mb-3 mt-2"
            autofocus
          />
          <v-text-field
            v-model="itemForm.quantity"
            label="Quantity"
            placeholder="e.g. 2 lbs, 500g, 1 dozen"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />
          <v-select
            v-model="itemForm.category"
            label="Category"
            :items="categorySelectOptions"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />
          <v-text-field
            v-model="itemForm.purchaseDate"
            label="Purchase Date"
            type="date"
            variant="outlined"
            density="comfortable"
            class="mb-3"
          />
          <v-text-field
            v-model="itemForm.expirationDate"
            label="Expiration Date (optional)"
            type="date"
            variant="outlined"
            density="comfortable"
            class="mb-1"
          />
          <div v-if="!itemForm.expirationDate" class="text-caption text-medium-emphasis mb-3">
            Leave blank and we'll estimate the expiry automatically
          </div>
          <v-textarea
            v-model="itemForm.notes"
            label="Notes"
            variant="outlined"
            density="comfortable"
            rows="2"
            auto-grow
          />
          <v-alert v-if="itemError" type="error" variant="tonal" class="mt-2">{{ itemError }}</v-alert>
        </template>

        <!-- Receipt tab -->
        <template v-if="!editingItem && addTab === 'receipt'">
          <v-tabs v-model="receiptTab" color="primary" class="mb-4">
            <v-tab value="photo">Photo</v-tab>
            <v-tab value="text">Paste Text</v-tab>
          </v-tabs>

          <template v-if="receiptItems !== null">
            <div v-if="receiptStoreName" class="text-caption text-medium-emphasis mb-2">
              Store: <strong>{{ receiptStoreName }}</strong>
            </div>
            <div v-if="!receiptItems.length" class="text-center py-6 text-medium-emphasis">
              <v-icon size="40" class="mb-2">mdi-receipt-text-outline</v-icon>
              <div>No items could be extracted from this receipt.</div>
              <div class="text-caption mt-1">Try a clearer photo or paste the receipt text instead.</div>
            </div>
            <template v-else>
              <div class="text-body-2 font-weight-medium mb-2">
                {{ receiptSelectedCount }} of {{ receiptItems.length }} item{{ receiptItems.length === 1 ? '' : 's' }} selected:
              </div>
              <div class="d-flex flex-column mb-2" style="max-height:360px;overflow-y:auto">
                <div
                  v-for="(item, i) in receiptItems"
                  :key="i"
                  class="receipt-item-row pa-2 rounded-lg mb-1"
                  :style="item.selected ? 'background:rgba(var(--v-theme-primary),0.06)' : 'opacity:0.45'"
                >
                  <div class="d-flex align-center ga-2">
                    <v-checkbox
                      :model-value="item.selected"
                      density="compact"
                      hide-details
                      class="flex-shrink-0"
                      @update:model-value="toggleReceiptItem(i)"
                    />
                    <v-text-field
                      v-model="receiptItems[i].name"
                      density="compact"
                      variant="underlined"
                      hide-details
                      placeholder="Item name"
                      class="font-weight-medium flex-1"
                    />
                    <v-btn icon size="x-small" variant="text" color="#00897B" title="Insert item below" @click="insertReceiptItem(i)">
                      <v-icon size="14">mdi-plus</v-icon>
                    </v-btn>
                    <v-btn icon size="x-small" variant="text" color="error" title="Remove item" @click="removeReceiptItem(i)">
                      <v-icon size="14">mdi-close</v-icon>
                    </v-btn>
                  </div>
                  <div class="d-flex align-center ga-2 mt-1 ml-8">
                    <v-text-field
                      v-model="receiptItems[i].quantity"
                      density="compact"
                      variant="outlined"
                      hide-details
                      placeholder="Qty"
                      style="max-width:80px"
                    />
                    <v-select
                      v-model="receiptItems[i].category"
                      :items="categorySelectOptions"
                      density="compact"
                      variant="outlined"
                      hide-details
                      style="max-width:130px"
                    />
                    <v-text-field
                      v-model.number="receiptItems[i].estimated_days_until_expiry"
                      density="compact"
                      variant="outlined"
                      hide-details
                      placeholder="Days"
                      type="number"
                      min="1"
                      style="max-width:80px"
                    >
                      <template #append-inner><span class="text-caption text-medium-emphasis">d</span></template>
                    </v-text-field>
                  </div>
                </div>
              </div>
              <v-btn variant="text" size="small" prepend-icon="mdi-plus" color="#00897B" class="mb-3" @click="insertReceiptItem(receiptItems.length - 1)">
                Add item
              </v-btn>
            </template>
            <v-alert v-if="receiptError" type="error" variant="tonal" class="mb-3">{{ receiptError }}</v-alert>
            <div class="d-flex ga-2">
              <v-btn variant="text" @click="receiptItems = null">Back</v-btn>
              <v-spacer />
              <v-btn
                color="#00897B"
                :loading="receiptSaving"
                :disabled="receiptSelectedCount === 0"
                @click="doSaveReceipt"
              >Add {{ receiptSelectedCount }} item{{ receiptSelectedCount === 1 ? '' : 's' }}</v-btn>
            </div>
          </template>

          <v-window v-else v-model="receiptTab">
            <v-window-item value="photo">
              <v-file-input
                v-model="receiptPhotoFile"
                label="Receipt photo"
                accept="image/*"
                variant="outlined"
                density="comfortable"
                prepend-icon="mdi-camera"
                class="mb-3"
                hide-details
              />
              <div v-if="receiptPhotoPreview" class="mb-3 text-center">
                <img :src="receiptPhotoPreview" style="max-height:200px;max-width:100%;border-radius:8px" />
              </div>
              <v-alert v-if="receiptError" type="error" variant="tonal" class="mb-3">{{ receiptError }}</v-alert>
              <v-btn
                color="#00897B"
                :loading="receiptLoading"
                :disabled="!receiptPhotoSelected"
                block
                @click="extractFromPhoto"
              >Extract Items</v-btn>
            </v-window-item>

            <v-window-item value="text">
              <v-textarea
                v-model="receiptText"
                label="Paste receipt text"
                placeholder="Paste the text from your email receipt or type it manually…"
                variant="outlined"
                density="comfortable"
                rows="8"
                class="mb-3"
              />
              <v-alert v-if="receiptError" type="error" variant="tonal" class="mb-3">{{ receiptError }}</v-alert>
              <v-btn
                color="#00897B"
                :loading="receiptLoading"
                :disabled="!receiptText.trim()"
                block
                @click="extractFromText"
              >Extract Items</v-btn>
            </v-window-item>
          </v-window>
        </template>
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-btn v-if="editingItem" color="error" variant="text" @click="deleteEditingItem">Delete</v-btn>
        <v-spacer />
        <template v-if="editingItem || addTab === 'manual'">
          <v-btn @click="itemDialog = false">Cancel</v-btn>
          <v-btn color="#00897B" :loading="itemSaving" @click="saveItem">
            {{ editingItem ? 'Save Changes' : 'Add Item' }}
          </v-btn>
        </template>
        <template v-else>
          <v-btn @click="itemDialog = false">Close</v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Throw Out Dialog -->
  <v-dialog v-model="throwOutDialog" max-width="400" rounded="xl">
    <v-card rounded="xl">
      <v-card-title class="pt-5 pb-1">Throw Out Item</v-card-title>
      <v-card-subtitle class="pb-3">{{ throwOutTarget?.name }}</v-card-subtitle>
      <v-card-text>
        <v-textarea
          v-model="throwOutReason"
          label="Reason (optional)"
          placeholder="Why are you throwing this out? e.g. went bad, didn't use in time"
          variant="outlined"
          density="comfortable"
          rows="3"
        />
        <v-alert v-if="throwOutError" type="error" variant="tonal" class="mt-2">{{ throwOutError }}</v-alert>
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn @click="throwOutDialog = false">Cancel</v-btn>
        <v-btn color="error" :loading="throwOutLoading" @click="doThrowOut">Throw Out</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Delete Confirm Dialog -->
  <v-dialog v-model="deleteDialog" max-width="360" rounded="xl">
    <v-card rounded="xl">
      <v-card-title class="pt-5">Delete item?</v-card-title>
      <v-card-text>
        <strong>{{ deleteTarget?.name }}</strong> will be permanently removed.
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn @click="deleteDialog = false">Cancel</v-btn>
        <v-btn color="error" :loading="deleteLoading" @click="doDelete">Delete</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>


  <!-- Success Snackbar -->
  <v-snackbar v-model="snackbar" :timeout="3000" color="success">
    {{ snackbarText }}
  </v-snackbar>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { format, parseISO } from 'date-fns';
import { inventoryApi } from '../services/api';

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  produce: 'green', dairy: 'blue', meat: 'red', seafood: 'cyan',
  deli: 'deep-purple', bakery: 'orange', frozen: 'indigo',
  pantry: 'brown', beverages: 'purple', other: 'grey',
};

const categoryOptions = [
  { value: 'all', label: 'All' },
  { value: 'produce', label: 'Produce' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'meat', label: 'Meat' },
  { value: 'seafood', label: 'Seafood' },
  { value: 'deli', label: 'Deli' },
  { value: 'bakery', label: 'Bakery' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'pantry', label: 'Pantry' },
  { value: 'beverages', label: 'Beverages' },
  { value: 'other', label: 'Other' },
];

const categorySelectOptions = categoryOptions.filter(c => c.value !== 'all').map(c => ({
  title: c.label,
  value: c.value,
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function daysUntilExpiry(expirationDate) {
  if (!expirationDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expirationDate);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp - now) / (1000 * 60 * 60 * 24));
}

function expiryChipColor(days) {
  if (days === null) return 'grey';
  if (days < 0) return 'error';
  if (days <= 2) return 'deep-orange';
  if (days <= 7) return 'warning';
  return 'success';
}

function expiryLabel(days) {
  if (days === null) return 'No expiry set';
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `${days} days left`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return format(parseISO(typeof dateStr === 'string' ? dateStr : new Date(dateStr).toISOString()), 'MMM d, yyyy');
  } catch {
    return '';
  }
}

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

// ── State ──────────────────────────────────────────────────────────────────────

const activeTab          = ref('active');
const items              = ref([]);
const historyItems       = ref([]);
const loading            = ref(true);
const search             = ref('');
const selectedCategories = ref([]);
const sortBy             = ref('expiry');
const showFilters        = ref(false);
const activeFilterCount = computed(() =>
  selectedCategories.value.length + (sortBy.value !== 'expiry' ? 1 : 0)
);

function removeCategory(c) {
  selectedCategories.value = selectedCategories.value.filter(x => x !== c);
}
function resetFilters() {
  selectedCategories.value = [];
  sortBy.value = 'expiry';
}

const snackbar     = ref(false);
const snackbarText = ref('');

function showSnack(msg) {
  snackbarText.value = msg;
  snackbar.value = true;
}

// ── Filtered lists ─────────────────────────────────────────────────────────────

const filteredItems = computed(() => {
  const list = items.value.filter(item => {
    if (selectedCategories.value.length && !selectedCategories.value.includes(item.category)) return false;
    if (search.value) {
      const q = search.value.toLowerCase();
      if (!item.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  if (sortBy.value === 'name') {
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (sortBy.value === 'added') {
    return [...list].sort((a, b) => new Date(b.purchaseDate || 0) - new Date(a.purchaseDate || 0));
  }
  return [...list].sort((a, b) => {
    const da = a.expirationDate ? daysUntilExpiry(a.expirationDate) : Infinity;
    const db = b.expirationDate ? daysUntilExpiry(b.expirationDate) : Infinity;
    return da - db;
  });
});

const filteredHistoryItems = computed(() => {
  return historyItems.value.filter(item => {
    if (selectedCategories.value.length && !selectedCategories.value.includes(item.category)) return false;
    if (search.value) {
      const q = search.value.toLowerCase();
      if (!item.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
});

const thrownOutThisMonth = computed(() => {
  const now = new Date();
  return historyItems.value.filter(item => {
    if (item.status !== 'thrown_out') return false;
    if (!item.statusDate) return false;
    const d = new Date(item.statusDate);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
});

const groupedItems = computed(() => {
  const groups = [
    { key: 'soon', label: 'Expiring Soon', accentColor: '#EF5350', items: [] },
    { key: 'week', label: 'This Week',     accentColor: '#FF9800', items: [] },
    { key: 'fine', label: 'Fine',          accentColor: '#66BB6A', items: [] },
    { key: 'none', label: 'No Expiry Set', accentColor: '#9E9E9E', items: [] },
  ];
  for (const item of filteredItems.value) {
    const days = item.expirationDate ? daysUntilExpiry(item.expirationDate) : null;
    if (days === null)  groups[3].items.push(item);
    else if (days <= 2) groups[0].items.push(item);
    else if (days <= 7) groups[1].items.push(item);
    else                groups[2].items.push(item);
  }
  return groups.filter(g => g.items.length > 0);
});

const groupedHistory = computed(() => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const groups = [
    { key: 'today', label: 'Today',     items: [] },
    { key: 'week',  label: 'This Week', items: [] },
    { key: 'older', label: 'Older',     items: [] },
  ];
  for (const item of filteredHistoryItems.value) {
    const d = item.statusDate ? new Date(item.statusDate) : null;
    if (!d) { groups[2].items.push(item); continue; }
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    if (day.getTime() === now.getTime()) groups[0].items.push(item);
    else if (day >= weekAgo)             groups[1].items.push(item);
    else                                 groups[2].items.push(item);
  }
  return groups.filter(g => g.items.length > 0);
});

function historyAccentColor(status) {
  return status === 'used' ? '#66BB6A' : '#EF5350';
}

// ── Load Data ──────────────────────────────────────────────────────────────────

async function loadItems() {
  loading.value = true;
  try {
    const [activeRes, usedRes, thrownRes] = await Promise.all([
      inventoryApi.list({ status: 'active' }),
      inventoryApi.list({ status: 'used' }),
      inventoryApi.list({ status: 'thrown_out' }),
    ]);
    items.value = activeRes.data;
    const merged = [...usedRes.data, ...thrownRes.data];
    merged.sort((a, b) => new Date(b.statusDate || 0) - new Date(a.statusDate || 0));
    historyItems.value = merged;
  } finally {
    loading.value = false;
  }
}

// ── Add/Edit Item Dialog ───────────────────────────────────────────────────────

const itemDialog  = ref(false);
const addTab      = ref('manual'); // 'manual' | 'receipt'
const editingItem = ref(null);
const itemSaving  = ref(false);
const itemError   = ref('');

watch(itemDialog, (val) => {
  if (!val) {
    addTab.value = 'manual';
    receiptItems.value = null;
    receiptError.value = '';
  }
});

const itemForm = ref({
  name: '',
  quantity: '',
  category: 'other',
  purchaseDate: todayStr(),
  expirationDate: '',
  notes: '',
});

function openAddDialog() {
  editingItem.value = null;
  addTab.value = 'manual';
  itemForm.value = {
    name: '',
    quantity: '',
    category: 'other',
    purchaseDate: todayStr(),
    expirationDate: '',
    notes: '',
  };
  itemError.value = '';
  itemDialog.value = true;
}

function openEditDialog(item) {
  editingItem.value = item;
  itemForm.value = {
    name: item.name,
    quantity: item.quantity || '',
    category: item.category || 'other',
    purchaseDate: item.purchaseDate ? format(new Date(item.purchaseDate), 'yyyy-MM-dd') : todayStr(),
    expirationDate: item.expirationDate ? format(new Date(item.expirationDate), 'yyyy-MM-dd') : '',
    notes: item.notes || '',
  };
  itemError.value = '';
  itemDialog.value = true;
}

async function saveItem() {
  if (!itemForm.value.name.trim()) {
    itemError.value = 'Name is required';
    return;
  }
  itemError.value = '';
  itemSaving.value = true;
  try {
    const payload = {
      name: itemForm.value.name.trim(),
      quantity: itemForm.value.quantity,
      category: itemForm.value.category,
      purchaseDate: itemForm.value.purchaseDate,
      expirationDate: itemForm.value.expirationDate || undefined,
      notes: itemForm.value.notes,
    };
    if (editingItem.value) {
      await inventoryApi.update(editingItem.value._id, payload);
      showSnack('Item updated');
    } else {
      await inventoryApi.create(payload);
      showSnack('Item added');
    }
    itemDialog.value = false;
    await loadItems();
  } catch (e) {
    itemError.value = e.response?.data?.error || 'Failed to save item';
  } finally {
    itemSaving.value = false;
  }
}

// ── Throw Out Dialog ───────────────────────────────────────────────────────────

const throwOutDialog  = ref(false);
const throwOutTarget  = ref(null);
const throwOutReason  = ref('');
const throwOutLoading = ref(false);
const throwOutError   = ref('');

function openThrowOutDialog(item) {
  throwOutTarget.value = item;
  throwOutReason.value = '';
  throwOutError.value = '';
  throwOutDialog.value = true;
}

async function doThrowOut() {
  throwOutError.value = '';
  throwOutLoading.value = true;
  try {
    await inventoryApi.consume(throwOutTarget.value._id, {
      action: 'thrown_out',
      wasteReason: throwOutReason.value,
    });
    throwOutDialog.value = false;
    showSnack('Item marked as thrown out');
    await loadItems();
  } catch (e) {
    throwOutError.value = e.response?.data?.error || 'Failed to update item';
  } finally {
    throwOutLoading.value = false;
  }
}

async function quickConsume(item, action) {
  try {
    await inventoryApi.consume(item._id, { action });
    showSnack(action === 'used' ? 'Marked as used' : 'Marked as thrown out');
    await loadItems();
  } catch (e) {
    showSnack('Failed to update item');
  }
}

async function quickMarkThrown(item) {
  try {
    await inventoryApi.consume(item._id, { action: 'thrown_out' });
    showSnack('Marked as thrown out');
    await loadItems();
  } catch (e) {
    showSnack('Failed to update item');
  }
}

function deleteEditingItem() {
  const item = editingItem.value;
  itemDialog.value = false;
  confirmDeleteItem(item);
}

// ── Delete Dialog ──────────────────────────────────────────────────────────────

const deleteDialog  = ref(false);
const deleteTarget  = ref(null);
const deleteLoading = ref(false);

function confirmDeleteItem(item) {
  deleteTarget.value = item;
  deleteDialog.value = true;
}

async function doDelete() {
  deleteLoading.value = true;
  try {
    await inventoryApi.delete(deleteTarget.value._id);
    deleteDialog.value = false;
    showSnack('Item deleted');
    await loadItems();
  } finally {
    deleteLoading.value = false;
  }
}

// ── Receipt (inside Add Item Dialog) ──────────────────────────────────────────
const receiptTab          = ref('photo');
const receiptPhotoFile    = ref(null);
const receiptPhotoPreview = ref('');
const receiptText         = ref('');
const receiptLoading      = ref(false);
const receiptError        = ref('');
const receiptItems        = ref(null); // null = not yet extracted; [] or [...] = extraction done
const receiptStoreName    = ref('');
const receiptSaving       = ref(false);

// Vuetify 3 v-file-input can return a File or an array — normalise both
function getFileObj(val) {
  if (Array.isArray(val)) return val[0] ?? null;
  return val ?? null;
}

const receiptPhotoSelected = computed(() => !!getFileObj(receiptPhotoFile.value));
const receiptSelectedCount = computed(() => (receiptItems.value || []).filter(i => i.selected).length);

watch(receiptPhotoFile, (val) => {
  const file = getFileObj(val);
  if (file instanceof File) {
    const reader = new FileReader();
    reader.onload = e => { receiptPhotoPreview.value = e.target.result; };
    reader.readAsDataURL(file);
  } else {
    receiptPhotoPreview.value = '';
  }
});

function toggleReceiptItem(i) {
  if (!receiptItems.value) return;
  receiptItems.value[i] = { ...receiptItems.value[i], selected: !receiptItems.value[i].selected };
}

function insertReceiptItem(afterIndex) {
  const items = [...receiptItems.value];
  items.splice(afterIndex + 1, 0, {
    name: '',
    quantity: '',
    category: 'other',
    estimated_days_until_expiry: null,
    selected: true,
  });
  receiptItems.value = items;
}

function removeReceiptItem(i) {
  const items = [...receiptItems.value];
  items.splice(i, 1);
  receiptItems.value = items;
}

function openReceiptDialog() {
  editingItem.value = null;
  receiptTab.value = 'photo';
  receiptPhotoFile.value = null;
  receiptPhotoPreview.value = '';
  receiptText.value = '';
  receiptError.value = '';
  receiptItems.value = null;
  receiptStoreName.value = '';
  addTab.value = 'receipt';
  itemDialog.value = true;
}

function closeReceiptDialog() {
  itemDialog.value = false;
}

function applyReceiptData(data) {
  receiptStoreName.value = data.storeName || '';
  receiptItems.value = (data.items || []).map(item => ({ ...item, selected: true }));
}

async function extractFromPhoto() {
  const file = getFileObj(receiptPhotoFile.value);
  if (!file) return;
  receiptError.value = '';
  receiptLoading.value = true;
  try {
    const { data } = await inventoryApi.fromPhoto(file);
    applyReceiptData(data);
  } catch (e) {
    receiptError.value = e.response?.data?.error || 'Failed to extract items from photo';
  } finally {
    receiptLoading.value = false;
  }
}

async function extractFromText() {
  receiptError.value = '';
  receiptLoading.value = true;
  try {
    const { data } = await inventoryApi.fromText(receiptText.value);
    applyReceiptData(data);
  } catch (e) {
    receiptError.value = e.response?.data?.error || 'Failed to extract items from receipt text';
  } finally {
    receiptLoading.value = false;
  }
}

async function doSaveReceipt() {
  const selectedItems = (receiptItems.value || []).filter(i => i.selected);
  if (!selectedItems.length) return;
  receiptError.value = '';
  receiptSaving.value = true;
  try {
    const purchaseDate = todayStr();
    await inventoryApi.batch(selectedItems.map(item => ({
      name: item.name,
      quantity: item.quantity || '',
      category: item.category || 'other',
      purchaseDate,
      estimated_days_until_expiry: item.estimated_days_until_expiry,
      source: receiptTab.value === 'photo' ? 'receipt_photo' : 'receipt_text',
    })));
    itemDialog.value = false;
    showSnack(`${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} added`);
    await loadItems();
  } catch (e) {
    receiptError.value = e.response?.data?.error || 'Failed to save items';
  } finally {
    receiptSaving.value = false;
  }
}

onMounted(loadItems);
</script>


<style scoped>
.find-recipes-icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.find-recipes-badge {
  position: absolute;
  top: -6px;
  right: -8px;
}
.filter-chip {
  cursor: pointer;
}
.inventory-card {
  transition: box-shadow 0.15s;
  cursor: pointer;
}
.inventory-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.12) !important;
}
.history-card {
  opacity: 1;
}
.flex-1 {
  flex: 1;
}
.min-width-0 {
  min-width: 0;
}
.qty-badge {
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.65);
  white-space: nowrap;
}
.qty-badge--dim {
  opacity: 0.55;
}
</style>
