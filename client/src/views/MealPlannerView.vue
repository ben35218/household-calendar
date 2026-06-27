<template>
  <v-container class="py-6 px-4" max-width="1100">
    <!-- Title row — scrolls away -->
    <div class="d-flex align-center mb-4">
      <BackButton class="mr-2" />
      <h1 class="text-h4 font-weight-bold">Meal Planner</h1>
      <v-spacer />
      <v-btn icon="mdi-silverware-fork-knife" variant="flat" color="#00897B" to="/recipes" />
      <v-btn icon="mdi-fridge-outline" variant="flat" color="#00897B" to="/food" class="mx-2" />
      <v-btn icon="mdi-cog-outline" variant="flat" color="#00897B" to="/meal-planner/settings" />
    </div>

    <!-- Week navigation — scrolls away with title -->
    <div class="mb-4" style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;">
      <div />
      <div class="d-flex align-center">
        <v-btn icon="mdi-chevron-left" variant="tonal" size="small" @click="shiftWeek(-1)" />
        <span class="text-body-1 font-weight-medium mx-3">{{ weekLabel }}</span>
        <v-btn icon="mdi-chevron-right" variant="tonal" size="small" @click="shiftWeek(1)" />
      </div>
      <div class="d-flex align-center pl-2">
        <v-btn variant="flat" color="#00897B" size="small" @click="goCurrentWeek">Today</v-btn>

      </div>
    </div>

    <!-- Sticky spine: step indicators only -->
    <div class="step-spine" style="position: sticky; top: 0; z-index: 5; background: rgb(var(--v-theme-surface)); margin: 0 -16px; padding: 0 16px;">
      <div class="d-flex py-2">
        <div
          v-for="s in steps"
          :key="s.n"
          class="flex-1-1 text-center"
          style="cursor: pointer;"
          @click="toggleStep(s.n)"
        >
          <v-avatar :color="s.done ? 'success' : activeStep === s.n ? 'info' : 'surface-variant'" size="36">
            <v-icon v-if="s.done">mdi-check</v-icon>
            <span v-else>{{ s.n }}</span>
          </v-avatar>
          <div class="text-caption mt-1 font-weight-medium">{{ s.label }}</div>
        </div>
      </div>
      <v-progress-linear :model-value="(activeStep - 1) / 2 * 100" color="info" height="2" />
    </div>

    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Step 1: Plan -->
      <section id="step-plan" data-step="1">
        <!-- Done banner -->
        <div v-if="planningDone" class="d-flex align-center ga-3 pa-4 rounded-lg border mt-4 mb-6">
          <v-icon color="success" size="24">mdi-check-circle</v-icon>
          <div class="flex-grow-1">
            <div class="text-subtitle-2">Week planned</div>
            <div class="text-caption text-success">Marked as done</div>
          </div>
          <v-btn variant="outlined" size="small" prepend-icon="mdi-undo" @click="reopenPlanning">Reopen</v-btn>
        </div>

        <!-- Active: week grid + mark done -->
        <template v-else>
          <v-row class="mb-4 mt-2">
            <v-col
              v-for="day in weekDays"
              :key="day.date"
              cols="12"
              sm="6"
              md="auto"
              class="flex-grow-1"
            >
              <div
                class="day-column"
                :class="{ 'today-column': day.isToday, 'grocery-column': day.isGroceryDay }"
              >
                <div class="day-header">
                  <div class="text-caption font-weight-bold text-uppercase text-medium-emphasis">{{ day.dayName }}</div>
                  <div class="text-h6 font-weight-bold" :class="day.isToday ? 'text-primary' : ''">{{ day.dayNum }}</div>
                  <v-chip
                    v-if="day.isGroceryDay"
                    size="x-small"
                    color="amber-darken-2"
                    prepend-icon="mdi-cart"
                    class="mt-1"
                  >Grocery Day</v-chip>
                </div>

                <div class="day-recipes">
                  <v-card
                    v-for="s in day.schedules"
                    :key="s._id"
                    rounded="lg"
                    elevation="0"
                    class="recipe-sched-card mb-2"
                    :to="`/recipes/${s.recipeId._id}`"
                  >
                    <v-card-text class="py-2 px-3">
                      <div class="d-flex align-center">
                        <v-icon size="14" color="teal" class="mr-2 flex-shrink-0">mdi-silverware-fork-knife</v-icon>
                        <span class="text-body-2 font-weight-medium recipe-sched-title">{{ s.recipeId?.title || 'Recipe' }}</span>
                        <v-btn
                          icon="mdi-close"
                          size="x-small"
                          variant="text"
                          color="error"
                          class="ml-auto"
                          @click.prevent.stop="removeSchedule(s._id)"
                        />
                      </div>
                      <div v-if="s.servings" class="text-caption text-medium-emphasis ml-6">{{ s.servings }} servings</div>
                    </v-card-text>
                  </v-card>
                </div>

                <v-btn
                  variant="dashed"
                  size="small"
                  block
                  prepend-icon="mdi-plus"
                  color="medium-emphasis"
                  class="add-recipe-btn"
                  @click="openAddDialog(day.date)"
                >Add Recipe</v-btn>
              </div>
            </v-col>
          </v-row>

          <v-btn
            block
            color="#00897B"
            variant="tonal"
            prepend-icon="mdi-check-circle-outline"
            class="mb-6"
            @click="markPlanningDone"
          >Mark planning as done</v-btn>
        </template>
      </section>

      <!-- Step 2: Shop -->
      <section id="step-shop" data-step="2">
        <!-- Done banner -->
        <div v-if="shoppingDone" class="d-flex align-center ga-3 pa-4 rounded-lg border mb-6">
          <v-icon color="success" size="24">mdi-check-circle</v-icon>
          <div class="flex-grow-1">
            <div class="text-subtitle-2">Shopping done</div>
            <div class="text-caption text-success">Marked as done</div>
          </div>
          <v-btn variant="outlined" size="small" prepend-icon="mdi-undo" @click="reopenShopping">Reopen</v-btn>
        </div>

        <!-- Active: grocery list + mark done -->
        <template v-else>
          <v-card rounded="lg" elevation="1">
            <v-card-title class="d-flex align-center">
              <v-icon color="amber-darken-2" class="mr-2">mdi-cart</v-icon>
              Grocery List
              <span class="text-body-2 text-medium-emphasis font-weight-regular ml-2">for this week</span>
              <v-spacer />
              <v-chip
                v-if="organizedList"
                size="x-small"
                color="success"
                variant="tonal"
                class="mr-1"
              >Organized</v-chip>
            </v-card-title>
            <v-divider />

            <!-- Store input -->
            <div v-if="groceryList.length" class="px-4 pt-3 pb-1">
              <v-text-field
                v-model="storeName"
                density="compact"
                variant="outlined"
                placeholder="Store (e.g. Food Basics Embrun)"
                prepend-inner-icon="mdi-store-outline"
                hide-details
                clearable
              >
                <template v-if="storeName" #append-inner>
                  <v-icon v-if="storeSearchFn" size="18" color="primary" title="Store recognized — search links available">mdi-link-variant</v-icon>
                  <v-icon v-else size="18" color="medium-emphasis" title="Store not recognized — no search links">mdi-link-variant-off</v-icon>
                </template>
              </v-text-field>
            </div>

            <div v-if="!groceryList.length" class="text-body-2 text-medium-emphasis pa-4">
              Schedule recipes to see your grocery list here.
            </div>

            <template v-else-if="organizedList">
              <v-alert
                v-if="storeName && organizedList.store_known === false"
                type="info"
                variant="tonal"
                density="compact"
                class="mx-4 mt-3"
                icon="mdi-store-alert-outline"
              >
                Aisle info not available for <strong>{{ storeName }}</strong> — showing generic section order.
              </v-alert>
              <div v-for="cat in organizedList.categories" :key="cat.name">
                <div class="grocery-category-header text-caption font-weight-bold text-uppercase text-medium-emphasis px-4 pt-3 pb-1 d-flex align-center ga-2">
                  {{ cat.name }}
                  <v-chip v-if="cat.aisle" size="x-small" variant="tonal" color="primary">Aisle {{ cat.aisle }}</v-chip>
                </div>
                <v-list density="compact">
                  <v-list-item
                    v-for="item in cat.items"
                    :key="`${cat.name}-${item.name}`"
                    :class="haveItems[item.name] ? 'have-item' : ''"
                  >
                    <template #prepend>
                      <v-icon v-if="haveItems[item.name]" size="18" color="teal" class="mr-3">mdi-home-check</v-icon>
                      <v-icon v-else-if="notFoundItems[item.name]" size="18" color="error" class="mr-3">mdi-close-circle</v-icon>
                      <v-checkbox-btn v-else v-model="checkedItems[item.name]" color="success" />
                    </template>
                    <v-list-item-title :class="haveItems[item.name] || checkedItems[item.name] ? 'text-decoration-line-through text-medium-emphasis' : notFoundItems[item.name] ? 'text-decoration-line-through text-error' : ''">
                      {{ item.name }}
                    </v-list-item-title>
                    <v-list-item-subtitle v-if="item.amount">{{ item.amount }}</v-list-item-subtitle>
                    <div v-if="substitutions[item.name]" class="d-flex align-center ga-1 mt-1">
                      <v-icon size="13" color="teal">mdi-swap-horizontal</v-icon>
                      <span class="text-caption text-teal-darken-1">{{ substitutions[item.name] }}</span>
                      <v-btn icon size="x-small" variant="text" color="medium-emphasis" @click="clearSub(item.name)">
                        <v-icon size="11">mdi-close</v-icon>
                      </v-btn>
                    </div>
                    <v-text-field
                      v-else-if="editingSub === item.name"
                      v-model="subInput"
                      density="compact"
                      variant="outlined"
                      placeholder="Substituted with…"
                      hide-details
                      autofocus
                      class="mt-1 sub-input"
                      @keyup.enter="saveSub(item.name)"
                      @blur="saveSub(item.name)"
                    />
                    <template #append>
                      <v-btn
                        v-if="itemLink(item.name)"
                        icon size="x-small" variant="text"
                        color="#00897B"
                        :title="`Search at ${storeName}`"
                        :href="itemLink(item.name)"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <v-icon size="16">mdi-open-in-new</v-icon>
                      </v-btn>
                      <v-btn
                        icon size="x-small" variant="text"
                        :color="substitutions[item.name] ? 'teal' : 'medium-emphasis'"
                        title="Note a substitution"
                        @click="startSub(item.name)"
                      >
                        <v-icon size="16">mdi-swap-horizontal</v-icon>
                      </v-btn>
                      <v-btn
                        icon size="x-small" variant="text"
                        :color="notFoundItems[item.name] ? 'error' : 'medium-emphasis'"
                        :title="notFoundItems[item.name] ? 'Mark as available' : 'Could not find'"
                        @click="toggleNotFound(item.name)"
                      >
                        <v-icon size="16">{{ notFoundItems[item.name] ? 'mdi-close-circle' : 'mdi-close-circle-outline' }}</v-icon>
                      </v-btn>
                      <v-btn
                        icon size="x-small" variant="text"
                        :color="haveItems[item.name] ? 'teal' : 'medium-emphasis'"
                        :title="haveItems[item.name] ? 'Remove from pantry' : 'Already have at home'"
                        @click="toggleHave(item.name)"
                      >
                        <v-icon size="16">{{ haveItems[item.name] ? 'mdi-home-remove-outline' : 'mdi-home-outline' }}</v-icon>
                      </v-btn>
                    </template>
                  </v-list-item>
                </v-list>
                <v-divider />
              </div>
            </template>

            <template v-else>
              <v-list density="compact">
                <v-list-item v-for="item in itemsToBuy" :key="item.name">
                  <template #prepend>
                    <v-icon v-if="notFoundItems[item.name]" size="18" color="error" class="mr-3">mdi-close-circle</v-icon>
                    <v-checkbox-btn v-else v-model="checkedItems[item.name]" color="success" />
                  </template>
                  <v-list-item-title :class="notFoundItems[item.name] ? 'text-decoration-line-through text-error' : checkedItems[item.name] ? 'text-decoration-line-through text-medium-emphasis' : ''">
                    {{ item.name }}
                  </v-list-item-title>
                  <v-list-item-subtitle>
                    <span v-for="(e, i) in item.entries" :key="i">
                      {{ [e.amount, e.unit].filter(Boolean).join(' ') }}
                      <span class="text-caption">({{ e.recipeTitle }})</span>
                      <span v-if="i < item.entries.length - 1">, </span>
                    </span>
                  </v-list-item-subtitle>
                  <div v-if="substitutions[item.name]" class="d-flex align-center ga-1 mt-1">
                    <v-icon size="13" color="teal">mdi-swap-horizontal</v-icon>
                    <span class="text-caption text-teal-darken-1">{{ substitutions[item.name] }}</span>
                    <v-btn icon size="x-small" variant="text" color="medium-emphasis" @click="clearSub(item.name)">
                      <v-icon size="11">mdi-close</v-icon>
                    </v-btn>
                  </div>
                  <v-text-field
                    v-else-if="editingSub === item.name"
                    v-model="subInput"
                    density="compact"
                    variant="outlined"
                    placeholder="Substituted with…"
                    hide-details
                    autofocus
                    class="mt-1 sub-input"
                    @keyup.enter="saveSub(item.name)"
                    @blur="saveSub(item.name)"
                  />
                  <template #append>
                    <v-btn
                      v-if="itemLink(item.name)"
                      icon size="x-small" variant="text"
                      color="#00897B"
                      :title="`Search at ${storeName}`"
                      :href="itemLink(item.name)"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <v-icon size="16">mdi-open-in-new</v-icon>
                    </v-btn>
                    <v-btn
                      icon size="x-small" variant="text"
                      :color="substitutions[item.name] ? 'teal' : 'medium-emphasis'"
                      title="Note a substitution"
                      @click="startSub(item.name)"
                    >
                      <v-icon size="16">mdi-swap-horizontal</v-icon>
                    </v-btn>
                    <v-btn
                      icon size="x-small" variant="text"
                      :color="notFoundItems[item.name] ? 'error' : 'medium-emphasis'"
                      :title="notFoundItems[item.name] ? 'Mark as available' : 'Could not find'"
                      @click="toggleNotFound(item.name)"
                    >
                      <v-icon size="16">{{ notFoundItems[item.name] ? 'mdi-close-circle' : 'mdi-close-circle-outline' }}</v-icon>
                    </v-btn>
                    <v-btn
                      icon size="x-small" variant="text"
                      color="medium-emphasis"
                      title="Already have at home"
                      @click="toggleHave(item.name)"
                    >
                      <v-icon size="16">mdi-home-outline</v-icon>
                    </v-btn>
                  </template>
                </v-list-item>
              </v-list>

              <template v-if="itemsAlreadyHave.length">
                <v-divider />
                <div class="grocery-category-header text-caption font-weight-bold text-uppercase text-medium-emphasis px-4 pt-3 pb-1">
                  Already have at home ({{ itemsAlreadyHave.length }})
                </div>
                <v-list density="compact">
                  <v-list-item v-for="item in itemsAlreadyHave" :key="item.name" class="have-item">
                    <template #prepend>
                      <v-icon size="18" color="teal" class="mr-3">mdi-home-check</v-icon>
                    </template>
                    <v-list-item-title class="text-decoration-line-through text-medium-emphasis">
                      {{ item.name }}
                    </v-list-item-title>
                    <template #append>
                      <v-btn
                        icon
                        size="x-small"
                        variant="text"
                        color="teal"
                        title="Remove from pantry"
                        @click="toggleHave(item.name)"
                      >
                        <v-icon size="16">mdi-home-remove-outline</v-icon>
                      </v-btn>
                    </template>
                  </v-list-item>
                </v-list>
              </template>
            </template>

            <v-card-actions v-if="groceryList.length">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-restore"
                @click="clearChecks"
              >Clear checks</v-btn>
              <v-btn
                v-if="organizedList"
                size="small"
                variant="text"
                prepend-icon="mdi-undo"
                @click="organizedList = null"
              >Raw list</v-btn>
              <v-btn
                v-else
                size="small"
                variant="tonal"
                color="#00897B"
                prepend-icon="mdi-magic-staff"
                :loading="organizeLoading"
                @click="organizeList"
              >Organize</v-btn>
              <v-btn
                size="small"
                variant="tonal"
                color="#00897B"
                prepend-icon="mdi-content-save"
                :loading="saveLoading"
                @click="saveSession"
              >Save</v-btn>
              <v-spacer />
              <v-btn
                size="small"
                variant="tonal"
                color="#00897B"
                prepend-icon="mdi-share-variant"
                @click="shareGroceryList"
              >Share</v-btn>
            </v-card-actions>
          </v-card>

          <v-btn
            block
            color="#00897B"
            variant="tonal"
            prepend-icon="mdi-check-circle-outline"
            class="mt-3 mb-3"
            @click="markShoppingDone"
          >Mark shopping as done</v-btn>
        </template>
      </section>

      <!-- Nudge: visible once shopping is marked done and receipt not yet uploaded -->
      <v-alert
        v-if="shoppingDone && !receiptUploaded"
        type="info"
        variant="tonal"
        density="compact"
        class="my-3"
        icon="mdi-arrow-down"
        style="cursor: pointer;"
        @click="goTo('step-track')"
      >
        Done shopping? Upload your receipt to update your pantry.
      </v-alert>

      <!-- Step 3: Track -->
      <section id="step-track" data-step="3" class="mb-6">
        <v-sheet border rounded="lg" class="pa-6 text-center" style="border-style: dashed !important;">
          <template v-if="receiptUploaded">
            <v-icon size="40" color="success">mdi-check-circle-outline</v-icon>
            <div class="text-subtitle-2 mt-2">Receipt processed</div>
            <template v-if="receiptAddedItems.length">
              <div class="text-caption text-medium-emphasis mt-1 mb-3">{{ receiptAddedItems.length }} item{{ receiptAddedItems.length === 1 ? '' : 's' }} added to your pantry:</div>
              <v-list density="compact" class="text-left mb-3 rounded-lg" style="max-height: 220px; overflow-y: auto; background: rgba(var(--v-theme-on-surface), 0.04);">
                <v-list-item
                  v-for="(item, i) in receiptAddedItems"
                  :key="i"
                  :title="item.name"
                  :subtitle="[item.quantity, item.category].filter(Boolean).join(' · ')"
                >
                  <template #prepend>
                    <v-icon size="16" color="success" class="mr-1">mdi-check</v-icon>
                  </template>
                </v-list-item>
              </v-list>
            </template>
            <div v-else class="text-caption text-medium-emphasis mb-4">Items have been added to your pantry</div>
            <v-btn variant="text" color="medium-emphasis" prepend-icon="mdi-undo" @click="receiptUploaded = false">Reopen</v-btn>
          </template>
          <template v-else>
            <v-icon size="30" color="medium-emphasis">mdi-receipt-text-outline</v-icon>
            <div class="text-subtitle-2 mt-2">Snap or upload your receipt</div>
            <div class="text-caption text-medium-emphasis mb-4">We'll extract items and add them to your pantry</div>
            <div class="d-flex ga-2 justify-center flex-wrap">
              <v-btn color="info" prepend-icon="mdi-camera" @click="camRef.click()">Scan</v-btn>
              <v-btn variant="outlined" prepend-icon="mdi-upload" @click="fileRef.click()">Upload</v-btn>
              <v-btn variant="text" prepend-icon="mdi-text-box-outline" @click="openReceiptTextDialog">Paste text</v-btn>
            </div>
          </template>
        </v-sheet>
        <input ref="camRef" type="file" accept="image/*" capture="environment" hidden @change="onReceipt" />
        <input ref="fileRef" type="file" accept="image/*,application/pdf" hidden @change="onReceipt" />
      </section>
    </template>
  </v-container>

  <!-- Receipt review dialog -->
  <v-dialog v-model="receiptDialog" max-width="560" rounded="xl">
    <v-card rounded="xl">
      <v-card-title class="pt-5 pb-2">
        <v-icon color="teal" class="mr-2">mdi-receipt-text-outline</v-icon>
        Review Receipt
      </v-card-title>
      <v-card-text>
        <!-- Extracting spinner -->
        <div v-if="receiptLoading" class="text-center py-8">
          <v-progress-circular indeterminate color="primary" class="mb-3" />
          <div class="text-body-2 text-medium-emphasis">Extracting items from receipt…</div>
        </div>

        <!-- Text paste mode (before extraction) -->
        <template v-else-if="receiptMode === 'text' && receiptItems === null">
          <v-textarea
            v-model="receiptText"
            label="Paste receipt text"
            placeholder="Paste the text from your email receipt or type it manually…"
            variant="outlined"
            density="comfortable"
            rows="8"
            class="mb-3"
          />
          <v-alert v-if="receiptError" type="error" variant="tonal" class="mb-3">{{ receiptError }}</v-alert>
          <v-btn
            color="#00897B"
            :disabled="!receiptText.trim()"
            block
            @click="extractReceiptFromText"
          >Extract Items</v-btn>
        </template>

        <!-- Item review list -->
        <template v-else-if="receiptItems !== null">
          <div v-if="receiptStoreName" class="text-caption text-medium-emphasis mb-2">
            Store: <strong>{{ receiptStoreName }}</strong>
          </div>
          <div v-if="!receiptItems.length" class="text-center py-6 text-medium-emphasis">
            <v-icon size="40" class="mb-2">mdi-receipt-text-outline</v-icon>
            <div>No items could be extracted from this receipt.</div>
            <div class="text-caption mt-1">Try a clearer photo or paste the receipt text instead.</div>
          </div>
          <template v-else>
            <div class="text-body-2 font-weight-medium mb-2">
              {{ receiptSelectedCount }} of {{ receiptItems.length }} item{{ receiptItems.length === 1 ? '' : 's' }} selected:
            </div>
            <div class="d-flex flex-column mb-2" style="max-height: 360px; overflow-y: auto;">
              <div
                v-for="(item, i) in receiptItems"
                :key="i"
                class="pa-2 rounded-lg mb-1"
                :style="item.selected ? 'background: rgba(var(--v-theme-primary), 0.06)' : 'opacity: 0.45'"
              >
                <div class="d-flex align-center ga-2">
                  <v-checkbox
                    :model-value="item.selected"
                    density="compact"
                    hide-details
                    class="flex-shrink-0"
                    @update:model-value="toggleReceiptItem(i)"
                  />
                  <v-text-field
                    v-model="receiptItems[i].name"
                    density="compact"
                    variant="underlined"
                    hide-details
                    placeholder="Item name"
                    class="font-weight-medium flex-1"
                  />
                  <v-btn icon size="x-small" variant="text" color="#00897B" title="Insert item below" @click="insertReceiptItem(i)">
                    <v-icon size="14">mdi-plus</v-icon>
                  </v-btn>
                  <v-btn icon size="x-small" variant="text" color="error" title="Remove item" @click="removeReceiptItem(i)">
                    <v-icon size="14">mdi-close</v-icon>
                  </v-btn>
                </div>
                <div class="d-flex align-center ga-2 mt-1 ml-8">
                  <v-text-field
                    v-model="receiptItems[i].quantity"
                    density="compact"
                    variant="outlined"
                    hide-details
                    placeholder="Qty"
                    style="max-width: 80px;"
                  />
                  <v-select
                    v-model="receiptItems[i].category"
                    :items="RECEIPT_CATEGORY_OPTIONS"
                    density="compact"
                    variant="outlined"
                    hide-details
                    style="max-width: 130px;"
                  />
                  <v-text-field
                    v-model.number="receiptItems[i].estimated_days_until_expiry"
                    density="compact"
                    variant="outlined"
                    hide-details
                    placeholder="Days"
                    type="number"
                    min="1"
                    style="max-width: 80px;"
                  >
                    <template #append-inner><span class="text-caption text-medium-emphasis">d</span></template>
                  </v-text-field>
                </div>
              </div>
            </div>
            <v-btn variant="text" size="small" prepend-icon="mdi-plus" color="#00897B" class="mb-3" @click="insertReceiptItem(receiptItems.length - 1)">
              Add item
            </v-btn>
          </template>
          <v-alert v-if="receiptError" type="error" variant="tonal" class="mb-3">{{ receiptError }}</v-alert>
          <div class="d-flex ga-2">
            <v-btn variant="text" @click="receiptItems = null; receiptError = ''">Back</v-btn>
            <v-spacer />
            <v-btn
              color="#00897B"
              :loading="receiptSaving"
              :disabled="receiptSelectedCount === 0"
              @click="doSaveReceipt"
            >Add {{ receiptSelectedCount }} item{{ receiptSelectedCount === 1 ? '' : 's' }}</v-btn>
          </div>
        </template>

        <!-- Photo extraction error before any items loaded -->
        <template v-else-if="receiptError">
          <v-alert type="error" variant="tonal" class="mb-3">{{ receiptError }}</v-alert>
          <v-btn block variant="outlined" @click="receiptDialog = false">Close</v-btn>
        </template>
      </v-card-text>
      <v-card-actions v-if="!receiptLoading && receiptItems === null && !receiptError && receiptMode !== 'text'" class="px-4 pb-4">
        <v-spacer />
        <v-btn @click="receiptDialog = false">Cancel</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-snackbar v-model="copiedSnack" timeout="2500" location="bottom center" color="success">
    Grocery list copied to clipboard
  </v-snackbar>
  <v-snackbar v-model="savedSnack" timeout="2000" location="bottom center" color="success">
    Grocery list saved
  </v-snackbar>

  <!-- Add recipe dialog -->
  <v-dialog v-model="addDialog" max-width="540">
    <v-card rounded="xl">
      <v-card-title class="pt-5 pb-2">Add Recipe — {{ addDialogDate }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="recipeSearch"
          placeholder="Search recipes…"
          variant="outlined"
          density="compact"
          prepend-inner-icon="mdi-magnify"
          clearable
          class="mb-3"
        />
        <div v-if="filteredLibrary.length === 0" class="text-body-2 text-medium-emphasis text-center py-4">
          No recipes found.
          <router-link to="/recipes" class="text-primary ml-1">Add a recipe first</router-link>
        </div>
        <v-list v-else density="compact" class="recipe-pick-list">
          <v-list-item
            v-for="r in filteredLibrary"
            :key="r._id"
            :title="r.title"
            :subtitle="r.tags?.join(', ')"
            class="recipe-pick-item"
            @click="selectRecipe(r)"
          >
            <template #prepend>
              <v-icon color="teal" class="mr-1">mdi-silverware-fork-knife</v-icon>
            </template>
            <template #append>
              <v-chip v-if="r.cookTimeMins || r.prepTimeMins" size="x-small" variant="tonal">
                {{ (r.prepTimeMins || 0) + (r.cookTimeMins || 0) }}min
              </v-chip>
            </template>
          </v-list-item>
        </v-list>

        <template v-if="selectedRecipe">
          <v-divider class="my-3" />
          <div class="text-body-2 font-weight-medium mb-2">{{ selectedRecipe.title }}</div>
          <v-text-field
            v-model.number="addServings"
            label="Servings (optional)"
            type="number"
            variant="outlined"
            density="comfortable"
          />
          <v-alert v-if="addError" type="error" variant="tonal" class="mt-2">{{ addError }}</v-alert>
        </template>
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn @click="addDialog = false">Cancel</v-btn>
        <v-btn v-if="selectedRecipe" color="#00897B" :loading="addLoading" @click="confirmAdd">
          Add to {{ addDialogDate }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import {
  format, addDays, isToday, parseISO, addWeeks, subWeeks,
} from 'date-fns';
import { recipesApi, recipeScheduleApi, settingsApi, inventoryApi } from '../services/api';

const RECEIPT_CATEGORY_OPTIONS = [
  { title: 'Produce',   value: 'produce'   },
  { title: 'Dairy',     value: 'dairy'     },
  { title: 'Meat',      value: 'meat'      },
  { title: 'Seafood',   value: 'seafood'   },
  { title: 'Deli',      value: 'deli'      },
  { title: 'Bakery',    value: 'bakery'    },
  { title: 'Frozen',    value: 'frozen'    },
  { title: 'Pantry',    value: 'pantry'    },
  { title: 'Beverages', value: 'beverages' },
  { title: 'Other',     value: 'other'     },
];

const route = useRoute();

const groceryShoppingDay = ref(6);

function startOfShoppingWeek(date) {
  const d = new Date(date);
  const diff = (d.getDay() - groceryShoppingDay.value + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

const weekStart    = ref(startOfShoppingWeek(new Date()));
const loading      = ref(true);
const schedules    = ref([]);
const library      = ref([]);
const groceryList  = ref([]);
const checkedItems = ref({});

const weekLabel = computed(() =>
  `${format(weekStart.value, 'MMM d')} – ${format(addDays(weekStart.value, 6), 'MMM d, yyyy')}`
);

const weekDays = computed(() => {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart.value, i);
    const dateStr = format(d, 'yyyy-MM-dd');
    days.push({
      date:         dateStr,
      dayName:      format(d, 'EEE'),
      dayNum:       format(d, 'd'),
      isToday:      isToday(d),
      isGroceryDay: i === 0,
      schedules:    schedules.value.filter(s =>
        new Date(s.scheduledDate).toISOString().slice(0, 10) === dateStr
      ),
    });
  }
  return days;
});

function shiftWeek(dir) {
  weekStart.value = dir > 0 ? addWeeks(weekStart.value, 1) : subWeeks(weekStart.value, 1);
}
function goCurrentWeek() {
  weekStart.value = startOfShoppingWeek(new Date());
}

async function loadWeek() {
  clearTimeout(autoSaveTimer);  // cancel any pending debounced save before switching weeks
  loading.value  = true;
  _loadingWeek   = true;
  try {
    const start = format(weekStart.value, 'yyyy-MM-dd');
    const end   = format(addDays(weekStart.value, 6), 'yyyy-MM-dd');
    const [schRes, grocRes, sessRes] = await Promise.all([
      recipeScheduleApi.list({ start, end }),
      recipeScheduleApi.groceryList(start),
      recipeScheduleApi.sessionGet(start),
    ]);
    schedules.value   = schRes.data;
    groceryList.value = grocRes.data.groceryList ?? [];
    // Reset then restore — all in one guarded block so no auto-save fires in between
    organizedList.value     = null;
    haveItems.value         = {};
    notFoundItems.value     = {};
    substitutions.value     = {};
    checkedItems.value      = {};
    storeName.value         = '';
    planningDone.value      = false;
    shoppingDone.value      = false;
    receiptUploaded.value   = false;
    receiptAddedItems.value = [];
    applyState(sessRes.data);
  } finally {
    _loadingWeek  = false;
    loading.value = false;
  }
}

watch(weekStart, loadWeek);

// Manual step completion flags
const planningDone    = ref(false);
const shoppingDone    = ref(false);
const receiptUploaded = ref(false);
const camRef          = ref(null);
const fileRef         = ref(null);

// activeStep derived from completion flags — no scroll-spy needed
const activeStep = computed(() => {
  if (!planningDone.value) return 1;
  if (!shoppingDone.value) return 2;
  return 3;
});

const plannedDays = computed(() =>
  weekDays.value.filter(d => d.schedules.length > 0).length
);

const checkedCount = computed(() =>
  itemsToBuy.value.filter(i => checkedItems.value[i.name]).length
);

const steps = computed(() => [
  {
    n: 1, label: 'Plan',
    status: planningDone.value ? 'Done' : `${plannedDays.value} / 7 days`,
    done: planningDone.value,
    anchor: 'step-plan',
  },
  {
    n: 2, label: 'Shop',
    status: shoppingDone.value ? 'Done' : groceryList.value.length ? `${checkedCount.value} / ${itemsToBuy.value.length}` : '—',
    done: shoppingDone.value,
    anchor: 'step-shop',
  },
  {
    n: 3, label: 'Track',
    status: receiptUploaded.value ? 'Done' : 'Receipt',
    done: receiptUploaded.value,
    anchor: 'step-track',
  },
]);

function goTo(anchor) {
  document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleStep(n) {
  if (n === 1) planningDone.value = !planningDone.value;
  else if (n === 2) shoppingDone.value = !shoppingDone.value;
  else if (n === 3) receiptUploaded.value = !receiptUploaded.value;
}

function markPlanningDone() {
  planningDone.value = true;
  nextTick(() => document.getElementById('step-shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function markShoppingDone() {
  shoppingDone.value = true;
  nextTick(() => document.getElementById('step-track')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function reopenPlanning() { planningDone.value = false; }
function reopenShopping() { shoppingDone.value = false; }

// Items saved to inventory via receipt this week (persisted in session)
const receiptAddedItems = ref([]);

// Receipt review flow
const receiptDialog    = ref(false);
const receiptMode      = ref('photo'); // 'photo' | 'text'
const receiptText      = ref('');
const receiptLoading   = ref(false);
const receiptError     = ref('');
const receiptItems     = ref(null); // null = not extracted; array = extracted
const receiptStoreName = ref('');
const receiptSaving    = ref(false);

const receiptSelectedCount = computed(() =>
  (receiptItems.value || []).filter(i => i.selected).length
);

function applyReceiptData(data) {
  receiptStoreName.value = data.storeName || '';
  receiptItems.value = (data.items || []).map(item => ({ ...item, selected: true }));
}

async function onReceipt(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  receiptMode.value    = 'photo';
  receiptItems.value   = null;
  receiptError.value   = '';
  receiptText.value    = '';
  receiptDialog.value  = true;
  receiptLoading.value = true;
  try {
    const { data } = await inventoryApi.fromPhoto(file);
    applyReceiptData(data);
  } catch (ex) {
    receiptError.value = ex.response?.data?.error || 'Failed to extract items from receipt';
  } finally {
    receiptLoading.value = false;
  }
}

function openReceiptTextDialog() {
  receiptMode.value    = 'text';
  receiptItems.value   = null;
  receiptError.value   = '';
  receiptText.value    = '';
  receiptDialog.value  = true;
}

async function extractReceiptFromText() {
  if (!receiptText.value.trim()) return;
  receiptError.value   = '';
  receiptLoading.value = true;
  try {
    const { data } = await inventoryApi.fromText(receiptText.value);
    applyReceiptData(data);
  } catch (ex) {
    receiptError.value = ex.response?.data?.error || 'Failed to extract items';
  } finally {
    receiptLoading.value = false;
  }
}

async function doSaveReceipt() {
  const selected = (receiptItems.value || []).filter(i => i.selected);
  if (!selected.length) return;
  receiptError.value  = '';
  receiptSaving.value = true;
  try {
    await inventoryApi.batch(selected.map(item => ({
      name:                        item.name,
      quantity:                    item.quantity || '',
      category:                    item.category || 'other',
      purchaseDate:                format(new Date(), 'yyyy-MM-dd'),
      estimated_days_until_expiry: item.estimated_days_until_expiry,
      source:                      'receipt_photo',
    })));
    receiptAddedItems.value = selected.map(i => ({
      name:     i.name,
      quantity: i.quantity || '',
      category: i.category || 'other',
    }));
    receiptDialog.value   = false;
    receiptUploaded.value = true;
  } catch (ex) {
    receiptError.value = ex.response?.data?.error || 'Failed to save items';
  } finally {
    receiptSaving.value = false;
  }
}

function toggleReceiptItem(i) {
  receiptItems.value[i] = { ...receiptItems.value[i], selected: !receiptItems.value[i].selected };
}
function insertReceiptItem(afterIndex) {
  const arr = [...receiptItems.value];
  arr.splice(afterIndex + 1, 0, { name: '', quantity: '', category: 'other', estimated_days_until_expiry: null, selected: true });
  receiptItems.value = arr;
}
function removeReceiptItem(i) {
  const arr = [...receiptItems.value];
  arr.splice(i, 1);
  receiptItems.value = arr;
}

// Add recipe to a day
const addDialog      = ref(false);
const addDialogDate  = ref('');
const recipeSearch   = ref('');
const selectedRecipe = ref(null);
const addServings    = ref(null);
const addLoading     = ref(false);
const addError       = ref('');

const filteredLibrary = computed(() => {
  const q = recipeSearch.value?.toLowerCase() ?? '';
  return q
    ? library.value.filter(r => r.title.toLowerCase().includes(q) || r.tags?.some(t => t.toLowerCase().includes(q)))
    : library.value;
});

function openAddDialog(date) {
  addDialogDate.value  = date;
  recipeSearch.value   = '';
  selectedRecipe.value = null;
  addServings.value    = null;
  addError.value       = '';
  addDialog.value      = true;
}

function selectRecipe(r) {
  selectedRecipe.value = r;
  addServings.value    = r.servings ?? null;
}

async function confirmAdd() {
  addError.value   = '';
  addLoading.value = true;
  try {
    await recipeScheduleApi.schedule({
      recipeId:      selectedRecipe.value._id,
      scheduledDate: addDialogDate.value,
      servings:      addServings.value || undefined,
    });
    addDialog.value = false;
    await loadWeek();
  } catch (e) {
    addError.value = e.response?.data?.error || 'Failed to schedule.';
  } finally {
    addLoading.value = false;
  }
}

async function removeSchedule(id) {
  await recipeScheduleApi.remove(id);
  await loadWeek();
}

// Organize grocery list via AI
const organizedList   = ref(null);
const organizeLoading = ref(false);
const storeName       = ref('');

const STORE_SEARCH_PATTERNS = [
  { names: ['food basics', 'foodbasics'],                         url: q => `https://www.foodbasics.ca/search?filter=${encodeURIComponent(q)}` },
  { names: ['no frills', 'nofrills'],                             url: q => `https://www.nofrills.ca/search?search-bar=${encodeURIComponent(q)}` },
  { names: ['loblaws'],                                           url: q => `https://www.loblaws.ca/search?search-bar=${encodeURIComponent(q)}` },
  { names: ['real canadian superstore', 'superstore', 'rcss'],   url: q => `https://www.realcanadiansuperstore.ca/search?search-bar=${encodeURIComponent(q)}` },
  { names: ['zehrs'],                                             url: q => `https://www.zehrs.ca/search?search-bar=${encodeURIComponent(q)}` },
  { names: ['valumart', 'valu-mart'],                             url: q => `https://www.valumart.ca/search?search-bar=${encodeURIComponent(q)}` },
  { names: ['walmart'],                                           url: q => `https://www.walmart.ca/search?q=${encodeURIComponent(q)}` },
  { names: ['sobeys'],                                            url: q => `https://www.sobeys.com/en/search/?q=${encodeURIComponent(q)}` },
  { names: ['safeway'],                                           url: q => `https://www.safeway.ca/en/search/?q=${encodeURIComponent(q)}` },
  { names: ['freshco'],                                           url: q => `https://www.freshco.com/search?q=${encodeURIComponent(q)}` },
  { names: ['metro'],                                             url: q => `https://www.metro.ca/en/online-grocery/search?filter=${encodeURIComponent(q)}` },
  { names: ['iga'],                                               url: q => `https://www.iga.net/en/search?q=${encodeURIComponent(q)}` },
  { names: ['giant tiger'],                                       url: q => `https://www.gianttiger.com/search?q=${encodeURIComponent(q)}` },
  { names: ['t&t', 't & t', 'tnt supermarket'],                  url: q => `https://www.tntsupermarket.com/search.html#${encodeURIComponent(q)}` },
  { names: ['costco'],                                            url: q => `https://www.costco.ca/CatalogSearch?keyword=${encodeURIComponent(q)}` },
  { names: ['amazon fresh', 'amazon'],                            url: q => `https://www.amazon.ca/s?k=${encodeURIComponent(q)}&i=amazonfresh` },
];

const storeSearchFn = computed(() => {
  if (!storeName.value) return null;
  const lower = storeName.value.toLowerCase();
  const match = STORE_SEARCH_PATTERNS.find(p => p.names.some(n => lower.includes(n)));
  return match?.url ?? null;
});

function itemLink(name) {
  return storeSearchFn.value ? storeSearchFn.value(name) : null;
}

const DEFAULT_SECTIONS = ['Produce', 'Deli', 'Bakery', 'Meat & Seafood', 'Dairy', 'Frozen', 'Pantry', 'Other'];
const grocerySections = ref([...DEFAULT_SECTIONS]);

async function organizeList() {
  organizeLoading.value = true;
  try {
    const { data } = await recipeScheduleApi.organizeGroceryList(groceryList.value, storeName.value, grocerySections.value);
    organizedList.value = data;
    checkedItems.value  = {};
  } catch (e) {
    console.error('Organize failed', e);
  } finally {
    organizeLoading.value = false;
  }
}

// Substitutions
const substitutions = ref({});
const editingSub    = ref(null);
const subInput      = ref('');

function startSub(name) {
  subInput.value   = substitutions.value[name] ?? '';
  editingSub.value = name;
}
function saveSub(name) {
  if (editingSub.value !== name) return;
  const val = subInput.value.trim();
  if (val) substitutions.value = { ...substitutions.value, [name]: val };
  else clearSub(name);
  editingSub.value = null;
  subInput.value   = '';
}
function clearSub(name) {
  const s = { ...substitutions.value };
  delete s[name];
  substitutions.value = s;
}

// Pantry review
const haveItems = ref({});

function toggleHave(name) {
  if (haveItems.value[name]) {
    delete haveItems.value[name];
  } else {
    haveItems.value[name] = true;
    delete checkedItems.value[name];
    delete notFoundItems.value[name];
  }
  haveItems.value = { ...haveItems.value };
}

const itemsToBuy       = computed(() => groceryList.value.filter(i => !haveItems.value[i.name]));
const itemsAlreadyHave = computed(() => groceryList.value.filter(i =>  haveItems.value[i.name]));

const notFoundItems = ref({});

function clearChecks() {
  checkedItems.value  = {};
  notFoundItems.value = {};
  substitutions.value = {};
}

function toggleNotFound(name) {
  if (notFoundItems.value[name]) {
    delete notFoundItems.value[name];
  } else {
    notFoundItems.value[name] = true;
    delete checkedItems.value[name];
    delete haveItems.value[name];
  }
  notFoundItems.value = { ...notFoundItems.value };
}

// Session persistence
const saveLoading  = ref(false);
const savedSnack   = ref(false);
let   _loadingWeek = false; // guard: suppress auto-save during loadWeek reset+apply

function currentState() {
  return {
    checkedItems:     checkedItems.value,
    notFoundItems:    notFoundItems.value,
    haveItems:        haveItems.value,
    substitutions:    substitutions.value,
    organizedList:    organizedList.value ?? null,
    storeName:        storeName.value || '',
    planningDone:       planningDone.value,
    shoppingDone:       shoppingDone.value,
    receiptUploaded:    receiptUploaded.value,
    receiptAddedItems:  receiptAddedItems.value,
  };
}

function applyState(state) {
  checkedItems.value    = state.checkedItems    ?? {};
  notFoundItems.value   = state.notFoundItems   ?? {};
  haveItems.value       = state.haveItems       ?? {};
  substitutions.value   = state.substitutions   ?? {};
  organizedList.value   = state.organizedList   ?? null;
  storeName.value       = state.storeName       ?? '';
  planningDone.value      = state.planningDone      ?? false;
  shoppingDone.value      = state.shoppingDone      ?? false;
  receiptUploaded.value   = state.receiptUploaded   ?? false;
  receiptAddedItems.value = state.receiptAddedItems ?? [];
}

async function saveSession() {
  saveLoading.value = true;
  try {
    const weekKey = format(weekStart.value, 'yyyy-MM-dd');
    await recipeScheduleApi.sessionPut(weekKey, currentState());
    savedSnack.value = true;
  } finally {
    saveLoading.value = false;
  }
}

let autoSaveTimer = null;
watch(
  [checkedItems, notFoundItems, haveItems, substitutions, organizedList, storeName, planningDone, shoppingDone, receiptUploaded],
  () => {
    if (_loadingWeek) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (_loadingWeek) return;
      const weekKey = format(weekStart.value, 'yyyy-MM-dd');
      recipeScheduleApi.sessionPut(weekKey, currentState()).catch(() => {});
    }, 3000);
  },
  { deep: true }
);

// Save step flags immediately — debounce would lose them if user navigates away quickly
watch([planningDone, shoppingDone, receiptUploaded], () => {
  if (_loadingWeek) return;
  const weekKey = format(weekStart.value, 'yyyy-MM-dd');
  recipeScheduleApi.sessionPut(weekKey, currentState()).catch(() => {});
});

// Share / copy grocery list
const copiedSnack = ref(false);

function buildGroceryText() {
  const lines = [];

  lines.push(`Meal Plan — ${weekLabel.value}`);
  lines.push('');

  const recipeDays = weekDays.value.filter(d => d.schedules.length > 0);
  if (recipeDays.length) {
    lines.push('Recipes this week:');
    for (const day of recipeDays) {
      for (const s of day.schedules) {
        const title   = s.recipeId?.title || 'Recipe';
        const serving = s.servings ? ` (${s.servings} servings)` : '';
        lines.push(`  ${day.dayName} ${day.dayNum} — ${title}${serving}`);
      }
    }
    lines.push('');
  }

  if (organizedList.value) {
    lines.push('Grocery list:');
    for (const cat of organizedList.value.categories) {
      const needed = cat.items.filter(i => !haveItems.value[i.name]);
      if (!needed.length) continue;
      lines.push(`\n${cat.name}:`);
      for (const item of needed) {
        const notFound = notFoundItems.value[item.name] ? ' — could not find' : '';
        const sub      = substitutions.value[item.name] ? ` → ${substitutions.value[item.name]}` : '';
        lines.push(item.amount ? `  • ${item.name} (${item.amount})${notFound}${sub}` : `  • ${item.name}${notFound}${sub}`);
      }
    }
  } else {
    lines.push('Grocery list:');
    for (const item of itemsToBuy.value) {
      const amounts  = item.entries.map(e => [e.amount, e.unit].filter(Boolean).join(' ')).filter(Boolean).join(', ');
      const notFound = notFoundItems.value[item.name] ? ' — could not find' : '';
      const sub      = substitutions.value[item.name] ? ` → ${substitutions.value[item.name]}` : '';
      lines.push(amounts ? `  • ${item.name} (${amounts})${notFound}${sub}` : `  • ${item.name}${notFound}${sub}`);
    }
  }

  lines.push('');
  lines.push('Shared from Household Calendar');

  return lines.join('\n');
}

async function shareGroceryList() {
  const text = buildGroceryText();
  if (navigator.share) {
    try {
      await navigator.share({ text });
    } catch (e) {
      if (e.name !== 'AbortError') await copyToClipboard(text);
    }
  } else {
    await copyToClipboard(text);
  }
}

async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
  copiedSnack.value = true;
}

onMounted(async () => {
  const [libRes, settRes] = await Promise.all([
    recipesApi.list(),
    settingsApi.get(),
  ]);
  library.value            = libRes.data;
  groceryShoppingDay.value = settRes.data.groceryShoppingDay ?? 6;
  grocerySections.value    = settRes.data.grocerySections?.length ? settRes.data.grocerySections : [...DEFAULT_SECTIONS];
  const qDate              = route.query.date;
  weekStart.value          = startOfShoppingWeek(qDate ? parseISO(qDate) : new Date());
  await loadWeek();
});
</script>

<style scoped>
.step-spine {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  margin-bottom: 0;
}

[data-step] {
  scroll-margin-top: 120px;
}

.day-column {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  padding: 12px;
  min-height: 200px;
  display: flex;
  flex-direction: column;
}
.today-column {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.04);
}
.grocery-column {
  border-color: #F9A825;
  background: rgba(249, 168, 37, 0.05);
}
.day-header {
  text-align: center;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.day-recipes {
  flex: 1;
  min-height: 60px;
}
.recipe-sched-card {
  background: rgba(var(--v-theme-on-surface), 0.04) !important;
  cursor: pointer;
}
.recipe-sched-card:hover {
  background: rgba(var(--v-theme-on-surface), 0.08) !important;
}
.recipe-sched-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add-recipe-btn {
  margin-top: 8px;
  border-style: dashed !important;
}
.grocery-category-header {
  letter-spacing: 0.05em;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.have-item {
  opacity: 0.55;
}
.sub-input {
  max-width: 260px;
}
.recipe-pick-list {
  max-height: 280px;
  overflow-y: auto;
}
.recipe-pick-item {
  cursor: pointer;
  border-radius: 8px;
}
.recipe-pick-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
</style>
