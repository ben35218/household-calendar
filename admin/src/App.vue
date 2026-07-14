<template>
  <v-app>
    <template v-if="auth.isLoggedIn && showChrome">
      <v-app-bar color="primary" density="comfortable" flat>
        <v-app-bar-title>
          <v-icon icon="mdi-shield-crown" class="mr-2" />
          Calen — Admin
        </v-app-bar-title>
        <v-spacer />
        <span class="text-body-2 mr-3 d-none d-sm-inline">{{ auth.user?.email }}</span>
        <v-btn variant="text" prepend-icon="mdi-logout" @click="auth.logout">Sign out</v-btn>
      </v-app-bar>

      <v-navigation-drawer permanent>
        <v-list nav density="comfortable">
          <v-list-item to="/insights" prepend-icon="mdi-chart-box" title="Insights" />
          <v-list-item to="/monetization" prepend-icon="mdi-cash-multiple" title="Monetization" />
          <v-list-item to="/households" prepend-icon="mdi-home-group" title="Households & plans" />
          <v-list-item to="/billing" prepend-icon="mdi-credit-card-outline" title="Billing" />
          <v-list-item to="/users" prepend-icon="mdi-account-multiple" title="Users" />
          <v-list-item to="/ai-usage" prepend-icon="mdi-counter" title="AI usage" />
          <v-list-item to="/support-inbox" prepend-icon="mdi-face-agent" title="Support inbox" />
          <v-list-item to="/moderation" prepend-icon="mdi-flag-outline" title="Content reports" />
          <v-list-item to="/email-log" prepend-icon="mdi-email-fast-outline" title="Email log" />
          <v-list-item to="/e2ee" prepend-icon="mdi-shield-lock" title="E2EE ops" />
          <v-list-item to="/audit" prepend-icon="mdi-clipboard-text-clock" title="Audit log" />
        </v-list>
      </v-navigation-drawer>
    </template>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from './stores/auth';

const auth = useAuthStore();
const route = useRoute();
const showChrome = computed(() => !route.meta.public);

onMounted(() => auth.init());
</script>
