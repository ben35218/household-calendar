<template>
  <v-container class="fill-height" fluid>
    <v-row align="center" justify="center">
      <v-col cols="12" sm="8" md="5" lg="4">
        <v-card elevation="8" rounded="lg">
          <v-card-text class="pa-8">
            <div class="text-center mb-6">
              <v-icon size="64" color="primary">mdi-home-heart</v-icon>
              <h1 class="text-h5 mt-2 font-weight-bold">Household Copilot</h1>
              <p class="text-body-2 text-medium-emphasis">Create your account</p>
            </div>
            <v-form @submit.prevent="handleRegister">
              <v-row dense class="mb-0">
                <v-col cols="6">
                  <v-text-field v-model="form.firstName" label="First Name" prepend-inner-icon="mdi-account" variant="outlined" class="mb-3" required />
                </v-col>
                <v-col cols="6">
                  <v-text-field v-model="form.lastName" label="Last Name" variant="outlined" class="mb-3" />
                </v-col>
              </v-row>
              <v-text-field v-model="form.email" label="Email" type="email" prepend-inner-icon="mdi-email" variant="outlined" class="mb-3" required />
              <v-text-field v-model="form.password" label="Password" type="password" prepend-inner-icon="mdi-lock" variant="outlined" class="mb-4" required />
              <v-alert v-if="error" type="error" class="mb-4" variant="tonal">{{ error }}</v-alert>
              <v-btn type="submit" color="primary" block size="large" :loading="loading">Create Account</v-btn>
            </v-form>
            <p class="text-center text-body-2 mt-4">
              Already have an account?
              <router-link to="/login" class="text-primary">Sign in</router-link>
            </p>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const form = ref({ firstName: '', lastName: '', email: '', password: '' });
const loading = ref(false);
const error = ref('');

async function handleRegister() {
  loading.value = true;
  error.value = '';
  try {
    await auth.register(form.value);
    router.push('/');
  } catch (e) {
    error.value = e.response?.data?.error || 'Registration failed';
  } finally {
    loading.value = false;
  }
}
</script>
