<template>
  <v-container class="py-6" max-width="700">
    <div class="d-flex align-center mb-4">
      <BackButton class="mr-2" />
      <h1 class="text-h4 font-weight-bold">Profile</h1>
    </div>

    <!-- Identity header -->
    <v-card variant="flat" border rounded="lg" class="mb-4 pa-4">
      <div class="d-flex align-center ga-3 flex-wrap">
        <v-avatar color="primary" size="48">
          <span class="text-h6">{{ identity.initial }}</span>
        </v-avatar>
        <div class="flex-grow-1" style="min-width: 0;">
          <div class="text-subtitle-1 font-weight-medium">{{ identity.name || '—' }}</div>
          <div class="text-body-2 text-medium-emphasis">{{ identity.email }}</div>
        </div>
        <v-chip v-if="identity.householdName" color="primary" variant="tonal" size="small" prepend-icon="mdi-home">
          {{ identity.householdName }}
        </v-chip>
        <v-btn variant="text" color="error" prepend-icon="mdi-logout" @click="auth.logout()">Sign out</v-btn>
      </div>
    </v-card>

    <!-- Grouped, drill-in section list -->
    <v-card variant="flat" border rounded="lg">
      <v-list lines="two" class="py-0">
        <template v-for="(s, i) in sections" :key="s.name">
          <v-divider v-if="i > 0" />
          <v-list-item
            :to="{ name: s.name }"
            :prepend-icon="s.icon"
            :title="s.label"
            :subtitle="s.subtitle"
            class="py-3"
          >
            <template #append>
              <v-icon icon="mdi-chevron-right" class="text-medium-emphasis" />
            </template>
          </v-list-item>
        </template>
      </v-list>
    </v-card>
  </v-container>
</template>

<script setup>
import { onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useProfileForm } from '../composables/useProfileForm';

const auth = useAuthStore();
const { identity, ensureLoaded } = useProfileForm();

const sections = [
  { name: 'profile-account',       label: 'Account',          subtitle: 'Name, birthday, timezone, push alerts',      icon: 'mdi-card-account-details-outline' },
  { name: 'profile-people',        label: 'Family & friends', subtitle: 'You, family & friends — info for the assistant', icon: 'mdi-account-group-outline' },
  { name: 'profile-household',     label: 'Household',        subtitle: 'Shared household and invite code',           icon: 'mdi-home-outline' },
  { name: 'profile-billing',       label: 'Plan & billing',   subtitle: 'Your plan, usage & upgrades',                icon: 'mdi-star-circle-outline' },
];

onMounted(ensureLoaded);
</script>
