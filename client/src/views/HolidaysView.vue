<template>
  <v-container class="py-6 px-4" max-width="600">
    <div class="d-flex align-center mb-4">
      <BackButton class="mr-2" />
      <h1 class="text-h5 font-weight-bold">Holidays</h1>
    </div>

    <p class="text-body-2 text-medium-emphasis mb-5">
      Choose which cultural holidays to display on your calendar.
    </p>

    <v-card v-for="group in groups" :key="group.key" rounded="lg" class="mb-4">
      <div class="d-flex align-center px-4 pt-4 pb-1">
        <span class="text-body-1 font-weight-semibold">{{ group.label }}</span>
        <v-spacer />
        <v-btn variant="text" size="small" density="compact" color="#D32F2F" @click="toggleGroup(group.key, true)">All</v-btn>
        <v-btn variant="text" size="small" density="compact" color="#D32F2F" class="ml-1" @click="toggleGroup(group.key, false)">None</v-btn>
      </div>
      <v-divider />
      <v-list density="compact" class="py-1">
        <v-list-item
          v-for="def in group.defs"
          :key="def.id"
          class="px-3"
          @click="prefs.toggle(def.id)"
        >
          <template #prepend>
            <v-checkbox-btn
              :model-value="prefs.isEnabled(def.id)"
              color="primary"
              density="compact"
              class="mr-1"
              @click.stop
              @update:model-value="prefs.toggle(def.id)"
            />
          </template>
          <v-list-item-title class="text-body-2">{{ def.name }}</v-list-item-title>
          <template v-if="def.group === 'multicultural'" #append>
            <span class="text-caption text-medium-emphasis">approx.</span>
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </v-container>
</template>

<script setup>
import { computed } from 'vue';
import { HOLIDAY_DEFS } from '../utils/canadianHolidays';
import { useHolidayPrefs } from '../composables/useHolidayPrefs';

const prefs = useHolidayPrefs();

const GROUP_LABELS = {
  cultural:      'Cultural Holidays',
  multicultural: 'Multicultural & Religious Holidays',
};

const groups = computed(() =>
  ['cultural', 'multicultural'].map(key => ({
    key,
    label: GROUP_LABELS[key],
    defs:  HOLIDAY_DEFS.filter(d => d.group === key),
  }))
);

function toggleGroup(groupKey, enable) {
  const ids = HOLIDAY_DEFS.filter(d => d.group === groupKey).map(d => d.id);
  for (const id of ids) {
    const currently = prefs.isEnabled(id);
    if (enable && !currently) prefs.toggle(id);
    if (!enable && currently) prefs.toggle(id);
  }
}
</script>
