<template>
  <v-menu v-model="filters.filterMenuOpen" :close-on-content-click="false" location="top" :offset="8">
    <template #activator="{ props: menuProps }">
      <v-badge :model-value="filters.activeFilterCount > 0" :content="filters.activeFilterCount" color="primary" offset-x="3" offset-y="3">
        <v-btn
          v-bind="menuProps"
          icon="mdi-filter-variant"
          :variant="filters.activeFilterCount > 0 ? 'tonal' : 'text'"
          color="primary"
        />
      </v-badge>
    </template>
    <v-card min-width="240" rounded="lg">
      <v-card-text class="pb-3">
        <div class="text-caption text-medium-emphasis font-weight-medium mb-2 text-uppercase">Time period</div>
        <v-btn-toggle v-model="filters.timeFilter" variant="outlined" color="primary" density="compact" class="w-100 mb-3">
          <v-btn value="" size="small">All</v-btn>
          <v-btn value="upcoming" size="small">Upcoming</v-btn>
          <v-btn value="past" size="small">Past</v-btn>
        </v-btn-toggle>
        <template v-if="filters.categories.length">
          <v-divider class="mb-3" />
          <div class="text-caption text-medium-emphasis font-weight-medium mb-2 text-uppercase">Maintenance category</div>
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="cat in filters.categories"
              :key="cat._id"
              :color="filters.categoryFilter.includes(cat._id) ? cat.color : undefined"
              :variant="filters.categoryFilter.includes(cat._id) ? 'elevated' : 'outlined'"
              :prepend-icon="cat.icon"
              size="small"
              label
              clickable
              @click="filters.toggleCategory(cat._id)"
            >
              {{ cat.name }}
            </v-chip>
            <v-chip
              v-if="filters.categoryFilter.length"
              size="small"
              variant="text"
              prepend-icon="mdi-close"
              @click="filters.categoryFilter = []"
            >Clear</v-chip>
          </div>
        </template>
        <template v-if="filters.items.length">
          <v-divider class="mb-3 mt-3" />
          <div class="d-flex align-center justify-space-between mb-2">
            <div class="text-caption text-medium-emphasis font-weight-medium text-uppercase">Item</div>
            <v-btn icon="mdi-cog" size="x-small" variant="text" color="medium-emphasis" density="compact" to="/maintenance" @click="filters.filterMenuOpen = false" />
          </div>
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="item in filters.items"
              :key="item._id"
              :color="filters.itemFilter.includes(item._id) ? 'primary' : undefined"
              :variant="filters.itemFilter.includes(item._id) ? 'elevated' : 'outlined'"
              prepend-icon="mdi-package-variant"
              size="small"
              label
              clickable
              @click="filters.toggleItem(item._id)"
            >
              {{ item.name }}
            </v-chip>
            <v-chip
              v-if="filters.itemFilter.length"
              size="small"
              variant="text"
              prepend-icon="mdi-close"
              @click="filters.itemFilter = []"
            >Clear</v-chip>
          </div>
        </template>
        <v-divider class="my-3" />
        <v-checkbox v-model="filters.showPaused" density="compact" hide-details color="primary">
          <template #label>
            <span class="text-caption font-weight-medium text-uppercase text-medium-emphasis">Paused Tasks</span>
          </template>
        </v-checkbox>
        <v-checkbox v-model="filters.showCompleted" density="compact" hide-details color="primary" class="mt-1">
          <template #label>
            <span class="text-caption font-weight-medium text-uppercase text-medium-emphasis">Completed Tasks</span>
          </template>
        </v-checkbox>
        <v-btn
          v-if="filters.activeFilterCount"
          size="small"
          variant="text"
          prepend-icon="mdi-close"
          class="mt-3 px-1"
          @click="filters.clearFilters()"
        >Clear all</v-btn>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<script setup>
defineProps({ filters: { type: Object, required: true } });
</script>
