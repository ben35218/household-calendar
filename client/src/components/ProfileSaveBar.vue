<template>
  <div class="save-bar d-flex align-center justify-end ga-3 mt-4">
    <v-fade-transition>
      <span v-if="saveMsg" :class="saveError ? 'text-error' : 'text-success'" class="text-body-2 mr-auto">{{ saveMsg }}</span>
    </v-fade-transition>
    <v-btn variant="text" :disabled="saving || !dirty" @click="load">Cancel</v-btn>
    <v-btn color="primary" :loading="saving" :disabled="!dirty" @click="save">Save changes</v-btn>
  </div>
</template>

<script setup>
import { useProfileForm } from '../composables/useProfileForm';

const { saving, dirty, saveMsg, saveError, load, save } = useProfileForm();
</script>

<style scoped>
.save-bar {
  position: sticky;
  bottom: 0;
  padding: 12px 0;
  background: rgb(var(--v-theme-background));
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
