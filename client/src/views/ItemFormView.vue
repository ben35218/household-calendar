<template>
  <v-container class="py-6" max-width="860">
    <div class="d-flex align-center mb-6">
      <v-btn icon="mdi-arrow-left" variant="text" @click="handleBack" />
      <h1 class="text-h4 font-weight-bold ml-2">{{ isEdit ? 'Edit Item' : 'Add Item' }}</h1>
    </div>

    <!-- Step 1: Type selection -->
    <template v-if="!isEdit && step === 1">
      <!-- Photo import -->
      <input ref="photoInputRef" type="file" accept="image/*" style="display:none" @change="onPhotoSelected" />
      <v-card rounded="lg" elevation="1" class="mb-5 pa-4">
        <div class="d-flex align-center ga-3 flex-wrap">
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-camera"
            :loading="photoLoading"
            @click="photoInputRef?.click()"
          >Add from Photo</v-btn>
          <span class="text-body-2 text-medium-emphasis">Take a photo of a label, nameplate, or the item itself — AI will fill in the details.</span>
        </div>
        <v-alert v-if="photoError" type="error" variant="tonal" density="compact" class="mt-3">{{ photoError }}</v-alert>
      </v-card>

      <p class="text-body-1 text-medium-emphasis mb-5">Or choose a type to add manually:</p>
      <v-row>
        <v-col v-for="t in typeList" :key="t.value" cols="12" sm="6" md="4">
          <v-card
            rounded="lg"
            elevation="2"
            class="type-card pa-2"
            :style="{ borderTop: `4px solid ${t.color}` }"
            @click="selectType(t.value)"
          >
            <v-card-text class="text-center py-5">
              <v-avatar :color="t.color" size="56" class="mb-3">
                <v-icon :icon="t.icon" color="white" size="28" />
              </v-avatar>
              <div class="text-h6 font-weight-bold mb-1">{{ t.label }}</div>
              <div class="text-body-2 text-medium-emphasis">{{ t.description }}</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>

    <!-- Step 2: Type-specific form -->
    <template v-else>
      <v-alert v-if="aiPopulated" type="success" variant="tonal" density="comfortable" class="mb-4" closable @click:close="aiPopulated = false">
        AI filled this form from your photo — review the details and save when ready.
      </v-alert>

      <div v-if="!isEdit" class="d-flex align-center mb-5">
        <v-chip :color="currentTypeConfig.color" :prepend-icon="currentTypeConfig.icon" label size="large">
          {{ currentTypeConfig.label }}
        </v-chip>
        <v-btn variant="text" size="small" class="ml-3" @click="step = 1">Change type</v-btn>
      </div>

      <v-form ref="formRef" @submit.prevent="save">
        <!-- ── Name + Category + Location (always shown) ── -->
        <v-card rounded="lg" elevation="1" class="mb-4">
          <v-card-title class="pa-4 pb-2 text-subtitle-1 font-weight-bold">Basic Info</v-card-title>
          <v-card-text class="pt-0">
            <v-row>
              <v-col cols="12" sm="8">
                <v-text-field
                  v-model="form.name"
                  :label="`${currentTypeConfig.label} Name *`"
                  variant="outlined"
                  :rules="[v => !!v || 'Name is required']"
                  :placeholder="currentTypeConfig.namePlaceholder"
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model="form.location"
                  label="Location"
                  variant="outlined"
                  placeholder="e.g. Home, Dad's House"
                  hint="Use a place name to group items on the Maintenance page"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="form.categoryId"
                  :items="categories.map(c => ({ title: c.name, value: c._id }))"
                  label="Category"
                  variant="outlined"
                  clearable
                />
              </v-col>
            </v-row>

            <v-checkbox
              v-if="!isEdit"
              v-model="form.autoLookupManual"
              color="primary"
              density="compact"
              hide-details
              class="mt-2"
            >
              <template #label>
                <span class="text-body-2">Automatically search for the product manual after saving</span>
              </template>
            </v-checkbox>
          </v-card-text>
        </v-card>

        <!-- ── Type-specific field groups ── -->
        <v-card
          v-for="group in currentTypeConfig.fieldGroups"
          :key="group.title"
          rounded="lg"
          elevation="1"
          class="mb-4"
        >
          <v-card-title class="pa-4 pb-2 text-subtitle-1 font-weight-bold">{{ group.title }}</v-card-title>
          <v-card-text class="pt-0">
            <v-row>
              <v-col
                v-for="field in group.fields"
                :key="field.model || field.customKey"
                :cols="field.cols || 12"
                :sm="field.sm || 6"
              >
                <!-- autocomplete on a core model field -->
                <v-autocomplete
                  v-if="field.type === 'autocomplete' && field.model"
                  v-model="form[field.model]"
                  :label="field.label"
                  :items="field.options"
                  :placeholder="field.placeholder"
                  variant="outlined"
                  clearable
                  auto-select-first
                />
                <!-- autocomplete on a custom key/value field -->
                <v-autocomplete
                  v-else-if="field.type === 'autocomplete' && field.customKey"
                  v-model="customFieldMap[field.customKey]"
                  :label="field.label"
                  :items="field.options"
                  :placeholder="field.placeholder"
                  variant="outlined"
                  clearable
                  auto-select-first
                />
                <!-- select on a core model field -->
                <v-select
                  v-else-if="field.type === 'select' && field.model"
                  v-model="form[field.model]"
                  :label="field.label"
                  :items="field.options"
                  variant="outlined"
                  clearable
                />
                <!-- select on a custom key/value field -->
                <v-select
                  v-else-if="field.type === 'select' && field.customKey"
                  v-model="customFieldMap[field.customKey]"
                  :label="field.label"
                  :items="field.options"
                  variant="outlined"
                  clearable
                />
                <!-- textarea on a core model field -->
                <v-textarea
                  v-else-if="field.type === 'textarea' && field.model"
                  v-model="form[field.model]"
                  :label="field.label"
                  :placeholder="field.placeholder"
                  variant="outlined"
                  rows="3"
                  auto-grow
                />
                <!-- plain text/date on a core model field -->
                <v-text-field
                  v-else-if="field.model"
                  v-model="form[field.model]"
                  :label="field.label"
                  :type="field.type || 'text'"
                  :placeholder="field.placeholder"
                  :hint="field.hint"
                  variant="outlined"
                />
                <!-- plain text/date on a custom key/value field -->
                <v-text-field
                  v-else-if="field.customKey"
                  v-model="customFieldMap[field.customKey]"
                  :label="field.label"
                  :type="field.type || 'text'"
                  :placeholder="field.placeholder"
                  :hint="field.hint"
                  variant="outlined"
                />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <!-- ── Extra custom fields + notes ── -->
        <v-card rounded="lg" elevation="1" class="mb-4">
          <v-card-title class="pa-4 pb-2 d-flex align-center text-subtitle-1 font-weight-bold">
            Notes & Additional Fields
            <v-spacer />
            <v-btn variant="text" prepend-icon="mdi-plus" size="small" @click="addCustomField">Add Field</v-btn>
          </v-card-title>
          <v-card-text class="pt-0">
            <v-textarea v-model="form.notes" label="Notes" variant="outlined" rows="2" auto-grow class="mb-2" />
            <v-row v-for="(field, i) in userCustomFields" :key="i" dense>
              <v-col cols="5">
                <v-text-field v-model="field.key" label="Field Name" variant="outlined" density="compact" />
              </v-col>
              <v-col cols="6">
                <v-text-field v-model="field.value" label="Value" variant="outlined" density="compact" />
              </v-col>
              <v-col cols="1" class="d-flex align-center">
                <v-btn icon="mdi-close" variant="text" size="small" @click="removeCustomField(i)" />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <v-alert v-if="error" type="error" class="mb-4" variant="tonal">{{ error }}</v-alert>

        <div class="d-flex justify-end ga-3">
          <v-btn @click="handleBack">Cancel</v-btn>
          <v-btn type="submit" color="#1976D2" size="large" :loading="saving">
            {{ isEdit ? 'Save Changes' : `Add ${currentTypeConfig.label}` }}
          </v-btn>
        </div>
      </v-form>
    </template>
  </v-container>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { itemsApi, categoriesApi } from '../services/api';
import { useSmartBack, useReturnTo } from '../composables/useSmartBack';

const route = useRoute();
const router = useRouter();
const goBack = useSmartBack();
const returnTo = useReturnTo();
const isEdit = computed(() => !!route.params.id);

const step = ref(1);
const formRef = ref(null);
const categories = ref([]);
const saving = ref(false);
const error = ref('');

const photoInputRef = ref(null);
const photoLoading  = ref(false);
const photoError    = ref('');
const aiPopulated   = ref(false);

async function onPhotoSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  photoError.value   = '';
  photoLoading.value = true;
  try {
    const { data } = await itemsApi.fromPhoto(file);
    populateFromPhoto(data);
  } catch (err) {
    photoError.value = err.response?.data?.error || 'Could not extract details from that photo.';
  } finally {
    photoLoading.value = false;
  }
}

function populateFromPhoto(data) {
  const typeValue = typeList.some(t => t.value === data.type) ? data.type : 'other';

  // Set type + auto-select category (same logic as selectType)
  form.value.type = typeValue;
  const catMatch = {
    appliance: 'Appliances',
    vehicle:   'Vehicles & Equipment',
    system:    'HVAC & Heating',
    structure: 'Exterior & Structure',
    equipment: 'Vehicles & Equipment',
  }[typeValue];
  if (catMatch) {
    const cat = categories.value.find(c => c.name === catMatch);
    if (cat) form.value.categoryId = cat._id;
  }

  // Populate core fields
  form.value.name          = data.name          || '';
  form.value.manufacturer  = data.manufacturer  || '';
  form.value.modelNumber   = data.modelNumber   || '';
  form.value.serialNumber  = data.serialNumber  || '';
  form.value.location      = data.location      || 'Home';
  form.value.purchaseDate  = data.purchaseDate  || '';
  form.value.warrantyExpiry= data.warrantyExpiry|| '';
  form.value.notes         = data.notes         || '';

  // Distribute customFields into preset slots vs user-added rows
  const config = typeList.find(t => t.value === typeValue);
  const presetKeys = new Set(
    (config?.fieldGroups || []).flatMap(g => g.fields.filter(f => f.customKey).map(f => f.customKey))
  );
  Object.keys(customFieldMap).forEach(k => delete customFieldMap[k]);
  userCustomFields.value = [];
  for (const cf of (data.customFields || [])) {
    if (presetKeys.has(cf.key)) {
      customFieldMap[cf.key] = cf.value;
    } else {
      userCustomFields.value.push({ key: cf.key, value: cf.value });
    }
  }

  aiPopulated.value = true;
  step.value = 2;
}

const form = ref({
  name: '', type: 'other', categoryId: '', location: 'Home',
  manufacturer: '', modelNumber: '', serialNumber: '',
  purchaseDate: '', warrantyExpiry: '', notes: '', customFields: [],
  autoLookupManual: true,
});

const customFieldMap = reactive({});
const userCustomFields = ref([]);

function addCustomField() { userCustomFields.value.push({ key: '', value: '' }); }
function removeCustomField(i) { userCustomFields.value.splice(i, 1); }

// ─── Shared option lists ──────────────────────────────────────────────────────

const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear - 1949 }, (_, i) => String(currentYear - i));

const vehicleMakes = [
  // Domestic
  'Ford', 'Chevrolet', 'GMC', 'Dodge', 'Ram', 'Chrysler', 'Jeep', 'Buick',
  'Cadillac', 'Lincoln',
  // Asian
  'Toyota', 'Honda', 'Nissan', 'Mazda', 'Subaru', 'Mitsubishi', 'Hyundai',
  'Kia', 'Lexus', 'Acura', 'Infiniti',
  // European
  'BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Volvo', 'Porsche', 'Land Rover',
  'MINI', 'Fiat', 'Alfa Romeo',
  // EV / New
  'Tesla', 'Rivian', 'Lucid', 'Polestar',
  // Farm / Ag equipment
  'John Deere', 'Kubota', 'Case IH', 'New Holland', 'Massey Ferguson',
  'Fendt', 'AGCO', 'Versatile', 'Claas',
  // ATV / UTV / Powersports
  'Polaris', 'Can-Am', 'BRP', 'Yamaha', 'Kawasaki', 'Suzuki', 'Honda Powersports',
  'Arctic Cat', 'Textron', 'CFMoto',
  // Outdoor / Small equipment
  'Ariens', 'Husqvarna', 'Toro', 'Troy-Bilt', 'Cub Cadet', 'Craftsman',
  'Simplicity', 'MTD', 'Snapper',
  'Other',
].sort();

const canadianProvinces = [
  'AB – Alberta', 'BC – British Columbia', 'MB – Manitoba', 'NB – New Brunswick',
  'NL – Newfoundland & Labrador', 'NS – Nova Scotia', 'NT – Northwest Territories',
  'NU – Nunavut', 'ON – Ontario', 'PE – Prince Edward Island', 'QC – Quebec',
  'SK – Saskatchewan', 'YT – Yukon',
];

const usStates = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY',
];

const regionsOptions = [...canadianProvinces, ...usStates];

// ─── Type definitions ─────────────────────────────────────────────────────────

const typeList = [
  {
    value: 'appliance',
    label: 'Appliance',
    icon: 'mdi-washing-machine',
    color: '#9C27B0',
    description: 'Fridge, washer, dryer, oven, dishwasher…',
    namePlaceholder: 'e.g. Samsung Refrigerator',
    locationPlaceholder: 'e.g. Kitchen, Laundry Room',
    fieldGroups: [
      {
        title: 'Make & Model',
        fields: [
          { model: 'manufacturer', label: 'Brand / Manufacturer', sm: 4, placeholder: 'e.g. Samsung' },
          { model: 'modelNumber', label: 'Model Number', sm: 4, placeholder: 'e.g. RF28R7351SR' },
          { model: 'serialNumber', label: 'Serial Number', sm: 4 },
        ],
      },
      {
        title: 'Purchase & Warranty',
        fields: [
          { model: 'purchaseDate', label: 'Purchase Date', type: 'date', sm: 6 },
          { model: 'warrantyExpiry', label: 'Warranty Expiry', type: 'date', sm: 6 },
        ],
      },
    ],
  },
  {
    value: 'vehicle',
    label: 'Vehicle',
    icon: 'mdi-car',
    color: '#607D8B',
    description: 'Car, truck, tractor, ATV, snowblower…',
    namePlaceholder: 'e.g. 2019 Honda CR-V',
    locationPlaceholder: 'e.g. Garage, Barn',
    fieldGroups: [
      {
        title: 'Vehicle Details',
        fields: [
          {
            customKey: 'Vehicle Type', label: 'Vehicle Type', type: 'select', sm: 6,
            options: ['Car / Sedan', 'Pickup Truck', 'SUV / Crossover', 'Van / Minivan',
              'Motorcycle', 'Tractor', 'ATV / Quad', 'UTV / Side-by-Side',
              'Snowblower', 'Riding Mower / Tractor', 'Walk-Behind Mower', 'Other'],
          },
          { customKey: 'Condition', label: 'Condition', type: 'select', sm: 6,
            options: ['Excellent', 'Good', 'Fair', 'Poor'] },
          { customKey: 'Year', label: 'Year', type: 'autocomplete', sm: 3, options: years },
          { model: 'manufacturer', label: 'Make', type: 'autocomplete', sm: 4, options: vehicleMakes, placeholder: 'Search makes…' },
          { model: 'modelNumber', label: 'Model', sm: 5, placeholder: 'e.g. F-150, CR-V, 1025R' },
          { customKey: 'Trim / Package', label: 'Trim / Package', sm: 6, placeholder: 'e.g. XLT, Sport, Lariat' },
          { customKey: 'Colour', label: 'Colour', type: 'select', sm: 6,
            options: ['Black', 'White', 'Silver / Grey', 'Red', 'Blue', 'Dark Blue / Navy',
              'Green', 'Yellow', 'Orange', 'Brown / Beige / Tan', 'Gold', 'Other'] },
        ],
      },
      {
        title: 'Identification',
        fields: [
          { model: 'serialNumber', label: 'VIN / Serial Number', sm: 12, placeholder: '17-character Vehicle Identification Number' },
          { customKey: 'License Plate', label: 'License Plate', sm: 4 },
          { customKey: 'Province / State', label: 'Province / State', type: 'autocomplete', sm: 4, options: regionsOptions },
          { customKey: 'Fuel Type', label: 'Fuel Type', type: 'select', sm: 4,
            options: ['Gasoline (Regular)', 'Gasoline (Premium)', 'Diesel', 'Hybrid – Gas/Electric',
              'Plug-in Hybrid (PHEV)', 'Full Electric (BEV)', 'Propane / LPG', 'Natural Gas', 'Other'] },
          { customKey: 'Transmission', label: 'Transmission', type: 'select', sm: 4,
            options: ['Automatic', 'Manual / Standard', 'CVT', 'Dual-Clutch (DCT)', 'N/A'] },
          { customKey: 'Drive Type', label: 'Drive Type', type: 'select', sm: 4,
            options: ['FWD – Front-Wheel Drive', 'RWD – Rear-Wheel Drive', 'AWD – All-Wheel Drive',
              '4WD / 4x4', '2WD', 'N/A'] },
          { customKey: 'Number of Doors', label: 'Doors', type: 'select', sm: 4,
            options: ['2', '3', '4', '5', 'N/A'] },
        ],
      },
      {
        title: 'Mileage & Purchase',
        fields: [
          { customKey: 'Odometer (km)', label: 'Odometer (km)', sm: 4, placeholder: 'e.g. 87 500' },
          { customKey: 'Engine Hours', label: 'Engine Hours', sm: 4, placeholder: 'For tractors / equipment' },
          { customKey: 'Engine Size', label: 'Engine Size', sm: 4, placeholder: 'e.g. 2.0L, 5.0L, 250cc' },
          { model: 'purchaseDate', label: 'Purchase Date', type: 'date', sm: 4 },
          { customKey: 'Purchase Price', label: 'Purchase Price ($)', sm: 4, placeholder: 'e.g. 32 000' },
          { customKey: 'Purchased From', label: 'Purchased From', sm: 4, placeholder: 'Dealer or private seller' },
        ],
      },
      {
        title: 'Insurance & Registration',
        fields: [
          { customKey: 'Insurance Provider', label: 'Insurance Provider', type: 'select', sm: 6,
            options: ['Intact Insurance', 'Aviva Canada', 'Desjardins', 'Co-operators',
              'Wawanesa', 'Economical Insurance', 'Belairdirect', 'TD Insurance',
              'CAA Insurance', 'Johnson Insurance', 'Other'] },
          { customKey: 'Policy Number', label: 'Policy Number', sm: 6 },
          { customKey: 'Insurance Expiry', label: 'Insurance Expiry', type: 'date', sm: 6 },
          { customKey: 'Registration Expiry', label: 'Registration Expiry', type: 'date', sm: 6 },
        ],
      },
    ],
  },
  {
    value: 'system',
    label: 'System',
    icon: 'mdi-air-filter',
    color: '#FF5722',
    description: 'HVAC, septic, well, electrical, plumbing…',
    namePlaceholder: 'e.g. Carrier Furnace, Septic System',
    locationPlaceholder: 'e.g. Basement, Utility Room',
    fieldGroups: [
      {
        title: 'System Details',
        fields: [
          { customKey: 'System Type', label: 'System Type', type: 'select', sm: 6,
            options: ['Forced Air Furnace', 'Heat Pump', 'Boiler / Radiant', 'Central A/C',
              'Mini-Split / Ductless', 'Septic System', 'Well & Pump', 'Water Softener',
              'Water Heater / HWT', 'Sump Pump', 'Electrical Panel', 'Generator',
              'Solar / PV System', 'Ventilation / HRV', 'Other'] },
          { customKey: 'Fuel / Energy Source', label: 'Fuel / Energy Source', type: 'select', sm: 6,
            options: ['Natural Gas', 'Propane', 'Oil / Diesel', 'Electric', 'Wood / Pellet', 'Solar', 'N/A'] },
          { model: 'manufacturer', label: 'Brand / Manufacturer', sm: 4, placeholder: 'e.g. Carrier, Trane' },
          { model: 'modelNumber', label: 'Model Number', sm: 4 },
          { model: 'serialNumber', label: 'Serial Number', sm: 4 },
        ],
      },
      {
        title: 'Capacity & Installation',
        fields: [
          { customKey: 'Capacity / Size', label: 'Capacity / Size', sm: 6, placeholder: 'e.g. 3-ton, 1,000-gal, 200A' },
          { customKey: 'Age / Condition', label: 'Condition', type: 'select', sm: 6,
            options: ['New', 'Excellent', 'Good', 'Fair', 'Poor', 'Unknown'] },
          { model: 'purchaseDate', label: 'Install Date', type: 'date', sm: 6 },
          { customKey: 'Expected Lifespan (yrs)', label: 'Expected Lifespan (yrs)', sm: 6, placeholder: 'e.g. 20' },
        ],
      },
      {
        title: 'Service Provider',
        fields: [
          { customKey: 'Service Company', label: 'Service Company', sm: 6 },
          { customKey: 'Service Phone', label: 'Service Phone', sm: 6 },
          { customKey: 'Last Service Date', label: 'Last Service Date', type: 'date', sm: 6 },
          { customKey: 'Service Contract Expiry', label: 'Service Contract Expiry', type: 'date', sm: 6 },
        ],
      },
    ],
  },
  {
    value: 'structure',
    label: 'Structure',
    icon: 'mdi-home-roof',
    color: '#795548',
    description: 'Roof, deck, foundation, barn, shed, fence…',
    namePlaceholder: 'e.g. Asphalt Roof, Back Deck',
    locationPlaceholder: 'e.g. Main House, North Field',
    fieldGroups: [
      {
        title: 'Construction Details',
        fields: [
          { customKey: 'Structure Type', label: 'Structure Type', type: 'select', sm: 6,
            options: ['Roof', 'Deck / Patio', 'Foundation / Basement', 'Barn', 'Shed',
              'Detached Garage', 'Fence / Gate', 'Driveway', 'Retaining Wall',
              'Septic Drain Field', 'Well House', 'Other'] },
          { customKey: 'Primary Material', label: 'Primary Material', type: 'select', sm: 6,
            options: ['Asphalt Shingle', 'Metal Roofing', 'Cedar / Wood', 'Concrete',
              'Brick / Masonry', 'Vinyl', 'Pressure-Treated Lumber', 'Steel', 'Other'] },
          { customKey: 'Year Built', label: 'Year Built', type: 'autocomplete', sm: 4, options: years },
          { customKey: 'Dimensions / Sq Ft', label: 'Dimensions / Sq Ft', sm: 4, placeholder: 'e.g. 400 sq ft' },
          { customKey: 'Condition', label: 'Condition', type: 'select', sm: 4,
            options: ['Excellent', 'Good', 'Fair', 'Poor', 'Needs Repair'] },
        ],
      },
      {
        title: 'Inspection & Permits',
        fields: [
          { customKey: 'Last Inspection Date', label: 'Last Inspection Date', type: 'date', sm: 6 },
          { customKey: 'Next Inspection Due', label: 'Next Inspection Due', type: 'date', sm: 6 },
          { customKey: 'Inspector / Contractor', label: 'Inspector / Contractor', sm: 6 },
          { customKey: 'Permit Number', label: 'Permit Number', sm: 6, placeholder: 'If applicable' },
        ],
      },
    ],
  },
  {
    value: 'equipment',
    label: 'Equipment',
    icon: 'mdi-engine',
    color: '#FF9800',
    description: 'Generator, chainsaw, pump, welder, tools…',
    namePlaceholder: 'e.g. Honda Generator, Husqvarna Chainsaw',
    locationPlaceholder: 'e.g. Tool Shed, Garage',
    fieldGroups: [
      {
        title: 'Make & Model',
        fields: [
          { model: 'manufacturer', label: 'Brand / Manufacturer', sm: 4, placeholder: 'e.g. Honda, Husqvarna' },
          { model: 'modelNumber', label: 'Model Number', sm: 4 },
          { model: 'serialNumber', label: 'Serial Number', sm: 4 },
          { customKey: 'Fuel Type', label: 'Fuel Type', type: 'select', sm: 6,
            options: ['Gasoline', 'Diesel', 'Propane', 'Electric / Battery', 'Manual / Hand-powered', 'Other'] },
          { customKey: 'Engine Size / Power', label: 'Engine Size / Power', sm: 6, placeholder: 'e.g. 5.5 HP, 250cc, 20V' },
        ],
      },
      {
        title: 'Usage & Service',
        fields: [
          { model: 'purchaseDate', label: 'Purchase Date', type: 'date', sm: 6 },
          { model: 'warrantyExpiry', label: 'Warranty Expiry', type: 'date', sm: 6 },
          { customKey: 'Hours / Cycles Used', label: 'Hours / Cycles Used', sm: 6, placeholder: 'Current meter reading' },
          { customKey: 'Last Service Date', label: 'Last Service Date', type: 'date', sm: 6 },
        ],
      },
    ],
  },
  {
    value: 'other',
    label: 'Other',
    icon: 'mdi-package-variant',
    color: '#455A64',
    description: "Anything that doesn't fit above",
    namePlaceholder: 'Item name',
    locationPlaceholder: 'e.g. Basement, Attic',
    fieldGroups: [
      {
        title: 'Details',
        fields: [
          { model: 'manufacturer', label: 'Manufacturer / Brand', sm: 4 },
          { model: 'modelNumber', label: 'Model Number', sm: 4 },
          { model: 'serialNumber', label: 'Serial Number', sm: 4 },
          { model: 'purchaseDate', label: 'Purchase Date', type: 'date', sm: 6 },
          { model: 'warrantyExpiry', label: 'Warranty Expiry', type: 'date', sm: 6 },
        ],
      },
    ],
  },
];

const currentTypeConfig = computed(() =>
  typeList.find(t => t.value === form.value.type) || typeList[typeList.length - 1]
);

function selectType(typeValue) {
  form.value.type = typeValue;
  const catMatch = {
    appliance: 'Appliances',
    vehicle: 'Vehicles & Equipment',
    system: 'HVAC & Heating',
    structure: 'Exterior & Structure',
    equipment: 'Vehicles & Equipment',
  }[typeValue];
  if (catMatch && !form.value.categoryId) {
    const cat = categories.value.find(c => c.name === catMatch);
    if (cat) form.value.categoryId = cat._id;
  }
  step.value = 2;
}

function handleBack() {
  if (!isEdit.value && step.value === 2) {
    step.value = 1;
  } else {
    goBack();
  }
}

async function save() {
  const { valid } = await formRef.value.validate();
  if (!valid) return;
  saving.value = true;
  error.value = '';
  try {
    const presetFields = Object.entries(customFieldMap)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([key, value]) => ({ key, value }));
    const userFields = userCustomFields.value.filter(f => f.key.trim());

    const payload = {
      ...form.value,
      customFields: [...presetFields, ...userFields],
    };
    if (!payload.purchaseDate) delete payload.purchaseDate;
    if (!payload.warrantyExpiry) delete payload.warrantyExpiry;
    if (!payload.categoryId) delete payload.categoryId;
    if (!payload.manufacturer) delete payload.manufacturer;
    if (!payload.modelNumber) delete payload.modelNumber;
    if (!payload.serialNumber) delete payload.serialNumber;

    if (isEdit.value) {
      await itemsApi.update(route.params.id, payload);
      returnTo(`/items/${route.params.id}`);
    } else {
      const { data } = await itemsApi.create(payload);
      returnTo(`/items/${data._id}`);
    }
  } catch (e) {
    error.value = e.response?.data?.error || 'Save failed';
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const { data: cats } = await categoriesApi.list();
  categories.value = cats;

  if (isEdit.value) {
    const { data } = await itemsApi.get(route.params.id);
    Object.assign(form.value, {
      ...data,
      categoryId: data.categoryId?._id || '',
      purchaseDate: data.purchaseDate ? data.purchaseDate.slice(0, 10) : '',
      warrantyExpiry: data.warrantyExpiry ? data.warrantyExpiry.slice(0, 10) : '',
    });

    const config = typeList.find(t => t.value === data.type);
    const presetKeys = new Set(
      (config?.fieldGroups || []).flatMap(g => g.fields.filter(f => f.customKey).map(f => f.customKey))
    );
    for (const cf of (data.customFields || [])) {
      if (presetKeys.has(cf.key)) {
        customFieldMap[cf.key] = cf.value;
      } else {
        userCustomFields.value.push({ key: cf.key, value: cf.value });
      }
    }
    step.value = 2;
  } else if (route.query.type && typeList.some(t => t.value === route.query.type)) {
    selectType(route.query.type);
  }
});
</script>

<style scoped>
.type-card {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}
.type-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12) !important;
}
</style>
