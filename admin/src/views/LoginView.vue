<template>
  <v-container class="fill-height" fluid>
    <v-row align="center" justify="center">
      <v-col cols="12" sm="8" md="5" lg="4">
        <v-card elevation="8" rounded="lg">
          <v-card-text class="pa-8">
            <div class="text-center mb-6">
              <v-icon size="64" color="primary">mdi-shield-crown</v-icon>
              <h1 class="text-h5 mt-2 font-weight-bold">Admin Console</h1>
              <p class="text-body-2 text-medium-emphasis">Household Calendar</p>
            </div>
            <v-form @submit.prevent="handleLogin">
              <v-text-field v-model="form.email" label="Email" type="email" prepend-inner-icon="mdi-email" variant="outlined" class="mb-3" required />
              <v-text-field v-model="form.password" label="Password" type="password" prepend-inner-icon="mdi-lock" variant="outlined" class="mb-4" required />
              <v-alert v-if="error" type="error" class="mb-4" variant="tonal">{{ error }}</v-alert>
              <v-btn type="submit" color="primary" block size="large" :loading="loading">Sign In</v-btn>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const form = ref({ email: '', password: '' });
const loading = ref(false);
const error = ref('');

async function handleLogin() {
  loading.value = true;
  error.value = '';
  try {
    await auth.login(form.value);
    router.push(route.query.redirect || '/');
  } catch (e) {
    error.value = e.code === 'NOT_ADMIN'
      ? e.message
      : (e.response?.data?.error || 'Login failed');
  } finally {
    loading.value = false;
  }
}
</script>
