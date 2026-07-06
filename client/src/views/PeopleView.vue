<template>
  <v-container class="py-6" max-width="900">
    <div class="d-flex align-center mb-2">
      <BackButton />
      <h1 class="text-h4 font-weight-bold ml-2">Family &amp; Friends</h1>
      <v-spacer />
      <v-btn variant="outlined" prepend-icon="mdi-contacts-outline" size="small" @click="triggerFileInput">Import Contacts</v-btn>
      <input ref="fileInput" type="file" accept=".vcf,text/vcard" class="d-none" @change="onFileSelected" />
    </div>
    <p class="text-body-2 text-medium-emphasis mb-6">
      This information helps the AI suggest family activities and who to get together with based on your calendar.
    </p>

    <!-- Family Members -->
    <div class="d-flex align-center mb-3">
      <h2 class="text-h6 font-weight-semibold">Family Members</h2>
      <v-spacer />
      <v-btn variant="tonal" color="primary" prepend-icon="mdi-plus" size="small" @click="openDialog('family')">Add Member</v-btn>
    </div>

    <v-row class="mb-6">
      <!-- Your own card -->
      <v-col v-if="selfPerson" cols="12" sm="6" md="4">
        <v-card rounded="lg" elevation="1" height="100%" border color="primary" variant="tonal" @click="openSelfDialog">
          <v-card-text class="pb-3">
            <div class="d-flex align-center mb-1">
              <v-icon icon="mdi-account-circle" color="primary" class="mr-2" />
              <span class="text-subtitle-1 font-weight-medium">{{ selfPerson.name }}</span>
              <v-chip size="x-small" color="primary" variant="flat" class="ml-2">You</v-chip>
            </div>
            <div v-if="selfPerson.address" class="text-caption text-medium-emphasis mb-2">
              <v-icon size="11" class="mr-1">mdi-map-marker-outline</v-icon>{{ selfPerson.address }}
            </div>
            <div v-if="selfPerson.interests?.length" class="mb-2">
              <v-chip v-for="i in selfPerson.interests" :key="i" size="x-small" class="mr-1 mb-1" variant="tonal" color="primary">{{ i }}</v-chip>
            </div>
            <div v-if="selfPerson.notes" class="text-caption text-medium-emphasis">{{ selfPerson.notes }}</div>
            <div v-if="!selfPerson.interests?.length && !selfPerson.notes" class="text-caption text-medium-emphasis">
              Add your interests and notes so the assistant can suggest plans for you.
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col v-for="person in familyMembers" :key="person._id" cols="12" sm="6" md="4">
        <v-card rounded="lg" elevation="1" height="100%" @click="openDialog('family', person)">
          <v-card-text class="pb-3">
            <div class="d-flex align-center mb-1">
              <v-icon icon="mdi-account" color="primary" class="mr-2" />
              <span class="text-subtitle-1 font-weight-medium">{{ person.name }}</span>
              <v-chip v-if="isMemberCard(person)" size="x-small" color="primary" variant="tonal" class="ml-2">Member</v-chip>
            </div>
            <div v-if="person.relationship" class="text-caption text-medium-emphasis mb-1">{{ person.relationship }}</div>
            <div v-if="person.address" class="text-caption text-medium-emphasis mb-2">
              <v-icon size="11" class="mr-1">mdi-map-marker-outline</v-icon>{{ person.address }}
            </div>
            <div v-if="person.interests?.length" class="mb-2">
              <v-chip v-for="i in person.interests" :key="i" size="x-small" class="mr-1 mb-1" variant="tonal" color="primary">{{ i }}</v-chip>
            </div>
            <div v-if="person.notes" class="text-caption text-medium-emphasis">{{ person.notes }}</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Friends -->
    <div class="d-flex align-center mb-3">
      <h2 class="text-h6 font-weight-semibold">Friends</h2>
      <v-spacer />
      <v-btn variant="tonal" color="secondary" prepend-icon="mdi-plus" size="small" @click="openDialog('friend')">Add Friend</v-btn>
    </div>

    <v-row>
      <v-col v-for="person in friends" :key="person._id" cols="12" sm="6" md="4">
        <v-card rounded="lg" elevation="1" height="100%" @click="openDialog('friend', person)">
          <v-card-text class="pb-3">
            <div class="d-flex align-center mb-1">
              <v-icon icon="mdi-account-heart" color="secondary" class="mr-2" />
              <span class="text-subtitle-1 font-weight-medium">{{ person.name }}</span>
            </div>
            <div v-if="person.relationship" class="text-caption text-medium-emphasis mb-1">{{ person.relationship }}</div>
            <div v-if="person.address" class="text-caption text-medium-emphasis mb-2">
              <v-icon size="11" class="mr-1">mdi-map-marker-outline</v-icon>{{ person.address }}
            </div>
            <div v-if="person.interests?.length" class="mb-2">
              <v-chip v-for="i in person.interests" :key="i" size="x-small" class="mr-1 mb-1" variant="tonal" color="secondary">{{ i }}</v-chip>
            </div>
            <div v-if="person.notes" class="text-caption text-medium-emphasis">{{ person.notes }}</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col v-if="friends.length === 0" cols="12">
        <v-card rounded="lg" elevation="1" class="text-center pa-8 text-medium-emphasis">
          <v-icon icon="mdi-account-heart-outline" size="40" class="mb-2" />
          <p class="text-body-2">No friends added yet.</p>
        </v-card>
      </v-col>
    </v-row>

    <!-- Add/Edit Dialog -->
    <v-dialog v-model="dialog" max-width="520" scrollable>
      <v-card rounded="lg">
        <v-card-title class="pt-5 px-5">
          {{ isSelf ? 'Edit your info' : (editing?._id ? 'Edit' : 'Add') + ' ' + (dialogType === 'family' ? 'Family Member' : 'Friend') }}
        </v-card-title>
        <v-divider />
        <v-card-text class="px-5 py-4">
          <v-text-field
            v-model="form.name"
            label="Name"
            variant="outlined"
            density="comfortable"
            class="mb-3"
            :disabled="isSelf"
            :hint="isSelf ? 'Your name, birthday and home address are managed in Account.' : undefined"
            :persistent-hint="isSelf"
          />
          <template v-if="!isSelf">
            <v-text-field
              v-model="form.relationship"
              :label="dialogType === 'family' ? 'Relationship (e.g. spouse, daughter, dad)' : 'How you know them (e.g. neighbor, coworker)'"
              variant="outlined"
              density="comfortable"
              class="mb-3"
            />
            <v-text-field
              v-model="form.birthdayInput"
              label="Birthday (optional)"
              type="date"
              variant="outlined"
              density="comfortable"
              class="mb-3"
            />
            <v-combobox
              v-model="addressSelected"
              :items="addressSuggestions"
              item-title="description"
              return-object
              no-filter
              :loading="addressLoading"
              label="Address (optional)"
              variant="outlined"
              density="comfortable"
              class="mb-3"
              prepend-inner-icon="mdi-map-marker-outline"
              clearable
              @update:search="onAddressSearch"
            >
              <template #item="{ item, props }">
                <v-list-item v-bind="props" :title="item.raw.main_text" :subtitle="item.raw.secondary_text" />
              </template>
            </v-combobox>
          </template>
          <v-combobox
            v-model="form.interests"
            label="Interests / hobbies (type and press Enter)"
            variant="outlined"
            density="comfortable"
            multiple
            chips
            closable-chips
            class="mb-3"
            hint="e.g. hockey, hiking, cooking"
            persistent-hint
          />
          <v-textarea
            v-model="form.notes"
            label="Notes for AI (optional)"
            variant="outlined"
            density="comfortable"
            rows="3"
            :class="isSelf ? '' : 'mb-3'"
            hint="Anything useful for activity suggestions — dietary needs, schedule constraints, favourite places, etc."
            persistent-hint
          />
          <template v-if="!isSelf">
            <v-text-field v-model="form.phone" label="Phone (optional)" variant="outlined" density="comfortable" class="mb-3" />
            <v-text-field v-model="form.email" label="Email (optional)" type="email" variant="outlined" density="comfortable" />
          </template>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-4">
          <v-btn v-if="canDeleteEditing" color="error" variant="text" prepend-icon="mdi-delete" @click="confirmDeleteFromDialog">Delete</v-btn>
          <v-spacer />
          <v-btn @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" :disabled="!form.name.trim()" @click="save">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Import Preview Dialog -->
    <v-dialog v-model="importDialog" max-width="640" scrollable>
      <v-card rounded="lg">
        <v-card-title class="pt-5 px-5 d-flex align-center">
          Import Contacts
          <v-spacer />
          <span class="text-body-2 text-medium-emphasis font-weight-regular">{{ importSelectedCount }} of {{ importContacts.length }} selected</span>
        </v-card-title>
        <v-card-subtitle class="px-5 pb-2">Choose who to import and tag each as Family or Friend.</v-card-subtitle>
        <v-divider />

        <v-card-text class="px-2 py-0">
          <!-- Select all -->
          <div class="d-flex align-center px-3 py-2 border-b">
            <v-checkbox
              :model-value="importAllSelected"
              :indeterminate="importSomeSelected && !importAllSelected"
              hide-details
              density="compact"
              label="Select all"
              @update:model-value="toggleSelectAll"
            />
          </div>

          <v-list lines="two" class="pa-0">
            <v-list-item v-for="(c, i) in importContacts" :key="i" class="px-3 py-2">
              <template #prepend>
                <v-checkbox v-model="c.selected" hide-details density="compact" class="mr-1" />
              </template>

              <v-list-item-title class="font-weight-medium">{{ c.name }}</v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                <span v-if="c.phone" class="mr-3">{{ c.phone }}</span>
                <span v-if="c.email" class="mr-3">{{ c.email }}</span>
                <span v-if="c.birthday">🎂 {{ c.birthday }}</span>
              </v-list-item-subtitle>

              <template #append>
                <v-btn-toggle v-model="c.type" density="compact" rounded="lg" mandatory variant="outlined" color="primary">
                  <v-btn value="family" size="small">Family</v-btn>
                  <v-btn value="friend" size="small">Friend</v-btn>
                </v-btn-toggle>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>

        <v-divider />
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn @click="importDialog = false">Cancel</v-btn>
          <v-btn
            color="primary"
            :loading="importing"
            :disabled="importSelectedCount === 0"
            @click="confirmImport"
          >
            Import {{ importSelectedCount }} contact{{ importSelectedCount !== 1 ? 's' : '' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog" max-width="380">
      <v-card rounded="lg">
        <v-card-title class="pt-5 px-5">Remove {{ deleteTarget?.name }}?</v-card-title>
        <v-card-text class="px-5">This will permanently remove them from your list.</v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" :loading="deleting" @click="doDelete">Remove</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { peopleApi, settingsApi, placesApi, householdApi } from '../services/api';
import { sealNew, sealUpdate, openRecord, getHDK } from '../services/e2ee';
import * as replica from '../services/replica';

// Encrypted person content (type stays plaintext for roster grouping; birthday
// stays plaintext so the calendar can still surface it during dual-write).
const PERSON_ENC = (p) => ({
  name: p.name, relationship: p.relationship, interests: p.interests,
  notes: p.notes, address: p.address, phone: p.phone, email: p.email,
});
import { useAuthStore } from '../stores/auth';
import { useSnackbar } from '../composables/useSnackbar';

const { error: notifyError } = useSnackbar();
const auth = useAuthStore();
const selfId = computed(() => String(auth.user?._id ?? ''));
const isSelf = ref(false);

// ── Import ─────────────────────────────────────────────────────────────────────

const people      = ref([]);
const homeAddress = ref('');

const fileInput      = ref(null);
const importDialog   = ref(false);
const importContacts = ref([]);
const importing      = ref(false);

const importSelectedCount = computed(() => importContacts.value.filter(c => c.selected).length);
const importAllSelected   = computed(() => importContacts.value.length > 0 && importContacts.value.every(c => c.selected));
const importSomeSelected  = computed(() => importContacts.value.some(c => c.selected));

function triggerFileInput() {
  fileInput.value.value = '';
  fileInput.value.click();
}

async function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { data } = await peopleApi.importVcf(file);
    importContacts.value = data.contacts.map(c => ({ ...c, selected: true, type: 'family' }));
    importDialog.value = true;
  } catch (err) {
    notifyError(err.response?.data?.error ?? 'Failed to parse file');
  }
}

function toggleSelectAll(val) {
  importContacts.value.forEach(c => { c.selected = !!val; });
}

async function confirmImport() {
  importing.value = true;
  try {
    const selected = importContacts.value.filter(c => c.selected);
    await peopleApi.bulk(selected.map(({ name, phone, email, birthday, address, notes, type }) => ({
      type, name, phone: phone || undefined, email: email || undefined,
      birthday: birthday || undefined, address: address || undefined,
      notes: notes || undefined,
    })));
    importDialog.value = false;
    await load();
  } finally {
    importing.value = false;
  }
}

const dialog      = ref(false);
const dialogType  = ref('family');
const editing     = ref(null);
const saving      = ref(false);
const deleteDialog  = ref(false);
const deleteTarget  = ref(null);
const deleting      = ref(false);

// ── Address autocomplete ───────────────────────────────────────────────────────
const addressSelected   = ref(null);
const addressSuggestions = ref([]);
const addressLoading    = ref(false);
let addressDebounce = null;

watch(addressSelected, (val) => {
  if (!val) {
    form.value.address = '';
  } else if (typeof val === 'object' && val.description) {
    form.value.address = val.description;
  } else if (typeof val === 'string') {
    form.value.address = val;
  }
});

function onAddressSearch(val) {
  if (addressSelected.value && typeof addressSelected.value === 'object' &&
      addressSelected.value.description === val) return;
  clearTimeout(addressDebounce);
  if (!val || val.length < 2) { addressSuggestions.value = []; return; }
  addressDebounce = setTimeout(async () => {
    addressLoading.value = true;
    try {
      const { data } = await placesApi.autocomplete(val, 'address');
      addressSuggestions.value = data.predictions ?? [];
    } catch {
      addressSuggestions.value = [];
    } finally {
      addressLoading.value = false;
    }
  }, 300);
}

// ── Form ───────────────────────────────────────────────────────────────────────
const emptyForm = () => ({ name: '', relationship: '', birthdayInput: '', address: '', interests: [], notes: '', phone: '', email: '' });
const form = ref(emptyForm());

// The current user's own roster card, pinned separately as the "You" card.
const selfPerson    = computed(() => people.value.find(p => p.accountId && String(p.accountId) === selfId.value));
const familyMembers = computed(() => people.value.filter(p => p.type === 'family' && p !== selfPerson.value));
const friends       = computed(() => people.value.filter(p => p.type === 'friend'));

// Other members' self-records can't be deleted (server-guarded); hide the button.
function isMemberCard(person) {
  return !!person.accountId;
}

// Only saved, non-member (deletable) people can be removed from the edit dialog.
const canDeleteEditing = computed(() => !!editing.value?._id && !isMemberCard(editing.value));

function confirmDeleteFromDialog() {
  const person = editing.value;
  dialog.value = false;
  confirmDelete(person);
}

function openSelfDialog() {
  isSelf.value = true;
  openDialog('family', selfPerson.value);
}

function openDialog(type, person = null) {
  if (person !== selfPerson.value) isSelf.value = false;
  dialogType.value = type;
  editing.value = person;
  addressSuggestions.value = [];

  if (person) {
    form.value = {
      name:          person.name,
      relationship:  person.relationship ?? '',
      birthdayInput: person.birthday ? person.birthday.slice(0, 10) : '',
      address:       person.address ?? '',
      interests:     person.interests ? [...person.interests] : [],
      notes:         person.notes ?? '',
      phone:         person.phone ?? '',
      email:         person.email ?? '',
    };
    addressSelected.value = person.address || null;
  } else {
    form.value = emptyForm();
    // Default family members to the user's home address
    if (type === 'family' && homeAddress.value) {
      form.value.address = homeAddress.value;
      addressSelected.value = homeAddress.value;
    } else {
      addressSelected.value = null;
    }
  }

  dialog.value = true;
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      type:         dialogType.value,
      name:         form.value.name.trim(),
      relationship: form.value.relationship.trim() || undefined,
      birthday:     form.value.birthdayInput || undefined,
      address:      form.value.address.trim() || undefined,
      interests:    form.value.interests.filter(Boolean),
      notes:        form.value.notes.trim() || undefined,
      phone:        form.value.phone.trim() || undefined,
      email:        form.value.email.trim() || undefined,
    };
    if (editing.value?._id) {
      await peopleApi.update(editing.value._id, await sealUpdate('Person', editing.value._id, payload, PERSON_ENC(payload)));
    } else {
      await peopleApi.create(await sealNew('Person', payload, PERSON_ENC(payload)));
    }
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

function confirmDelete(person) {
  deleteTarget.value = person;
  deleteDialog.value = true;
}

async function doDelete() {
  deleting.value = true;
  try {
    await peopleApi.delete(deleteTarget.value._id);
    deleteDialog.value = false;
    await load();
  } finally {
    deleting.value = false;
  }
}

async function load() {
  // Offline-first (Phase 4b): paint instantly from the local replica, then
  // refresh from the server and sync the replica (LWW on updatedAt).
  try {
    if (!people.value.length) {
      const cached = await replica.getAll('Person');
      if (cached.length) people.value = await Promise.all(cached.map((p) => openRecord('Person', p)));
    }
  } catch { /* replica unavailable — fall through to the server */ }

  const { data } = await peopleApi.list();
  // Decrypt each person's content over the plaintext (dual-write); no-op without an HDK.
  people.value = await Promise.all(data.map((p) => openRecord('Person', p)));
  replica.upsert('Person', data).catch(() => {}); // best-effort cache
}

// Post-drop the server no longer creates a plaintext self-record (Person.ensureSelf
// no-ops once the household is e2eeActive), so seed an *encrypted* one here on first
// unlock. Dormant pre-drop (e2eeActive false) and when locked (no HDK) — it never
// writes a plaintext self-record.
async function seedSelfIfNeeded(e2eeActive) {
  if (!e2eeActive || !getHDK() || selfPerson.value) return;
  const u = auth.user || {};
  const payload = {
    type:     'family',
    name:     [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.firstName || '',
    birthday: u.birthday || undefined,
    address:  homeAddress.value || undefined,
  };
  if (!payload.name) return;
  await peopleApi.createSelf(await sealNew('Person', payload, PERSON_ENC(payload)));
  await load();
}

onMounted(async () => {
  const [, settRes, hhRes] = await Promise.all([
    load(), settingsApi.get(), householdApi.get().catch(() => null),
  ]);
  homeAddress.value = settRes.data.homeAddress ?? '';
  await seedSelfIfNeeded(!!hhRes?.data?.e2eeActive);
});
</script>
