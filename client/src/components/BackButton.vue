<template>
  <v-btn icon="mdi-arrow-left" variant="text" v-bind="$attrs" @click="goBack" />
</template>

<script setup>
import { useSmartBack } from '../composables/useSmartBack';

const goBack = useSmartBack();
</script>
