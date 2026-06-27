<template>
  <v-card rounded="lg" elevation="1">
    <v-card-title class="d-flex align-center">
      Categories
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-plus" size="small" @click="openCatDialog()">Add</v-btn>
    </v-card-title>
    <v-divider />
    <v-list>
      <v-list-item
        v-for="cat in categories"
        :key="cat._id"
        :title="cat.name"
      >
        <template #prepend>
          <v-avatar :color="cat.color" size="32" class="mr-3">
            <v-icon :icon="cat.icon" color="white" size="16" />
          </v-avatar>
        </template>
        <template #append>
          <template v-if="deleteCatTarget?._id === cat._id">
            <span class="text-caption text-error mr-2">Delete?</span>
            <v-btn size="small" variant="text" @click="deleteCatTarget = null">No</v-btn>
            <v-btn size="small" color="error" @click="doDeleteCat">Yes</v-btn>
          </template>
          <template v-else>
            <v-btn icon="mdi-pencil" variant="text" size="small" @click="openCatDialog(cat)" />
            <v-btn icon="mdi-delete" variant="text" size="small" color="error" @click="confirmDeleteCat(cat)" />
          </template>
        </template>
      </v-list-item>
    </v-list>
    <v-expand-transition>
      <div v-if="catDialog">
        <v-divider />
        <v-card-text>
          <p class="text-subtitle-2 mb-3">{{ editingCat?._id ? 'Edit Category' : 'New Category' }}</p>
          <v-text-field v-model="catForm.name" label="Name" variant="outlined" density="compact" class="mb-3" />
          <v-text-field v-model="catForm.icon" label="MDI Icon (e.g. mdi-home)" variant="outlined" density="compact" class="mb-3" />
          <div class="d-flex align-center ga-3 mb-3">
            <span class="text-body-2">Color:</span>
            <input v-model="catForm.color" type="color" style="width:48px;height:36px;border:none;cursor:pointer;" />
            <span class="text-body-2">{{ catForm.color }}</span>
            <v-avatar :color="catForm.color" size="32">
              <v-icon :icon="catForm.icon" color="white" size="16" />
            </v-avatar>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="catDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="savingCat" @click="saveCat">Save</v-btn>
        </v-card-actions>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { categoriesApi } from '../services/api';

const categories = ref([]);
const catDialog = ref(false);
const editingCat = ref(null);
const catForm = ref({ name: '', icon: 'mdi-home', color: '#1976D2' });
const savingCat = ref(false);
const deleteCatTarget = ref(null);

function openCatDialog(cat = null) {
  editingCat.value = cat;
  catForm.value = cat ? { name: cat.name, icon: cat.icon, color: cat.color } : { name: '', icon: 'mdi-home', color: '#1976D2' };
  catDialog.value = true;
}

async function saveCat() {
  savingCat.value = true;
  try {
    if (editingCat.value?._id) {
      await categoriesApi.update(editingCat.value._id, catForm.value);
    } else {
      await categoriesApi.create(catForm.value);
    }
    catDialog.value = false;
    await loadCategories();
  } finally {
    savingCat.value = false;
  }
}

function confirmDeleteCat(cat) { deleteCatTarget.value = cat; }

async function doDeleteCat() {
  await categoriesApi.delete(deleteCatTarget.value._id);
  deleteCatTarget.value = null;
  await loadCategories();
}

async function loadCategories() {
  const { data } = await categoriesApi.list();
  categories.value = data;
}

onMounted(loadCategories);
</script>
