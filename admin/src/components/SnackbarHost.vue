<template>
  <v-snackbar v-model="snack.show" :color="snack.color" :timeout="timeout">{{ snack.text }}</v-snackbar>
</template>

<script setup>
// Renders the shared snackbar state from useSnackbar(). Kept as a component so
// views just drop <SnackbarHost :snack="snack" /> instead of repeating markup.
defineProps({
  snack: { type: Object, required: true },
  timeout: { type: [Number, String], default: 2800 },
});
</script>
