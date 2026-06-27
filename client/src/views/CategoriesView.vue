<template>
  <v-container class="py-6" max-width="900">
    <div class="d-flex align-center mb-6">
      <BackButton class="mr-2" />
      <h1 class="text-h4 font-weight-bold">Categories</h1>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Categories are used to organize maintenance tasks across your items. Changes here apply everywhere categories are used.
    </p>
    <CategoryManager />
  </v-container>
</template>

<script setup>
import CategoryManager from '../components/CategoryManager.vue';
</script>
