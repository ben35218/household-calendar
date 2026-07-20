---
title: Kitchen (recipes, meal planning, grocery)
status: current
last-verified: dad7c5a (2026-07-20)
code:
  - mobile/src/screens/kitchen/
  - server/src/routes/recipes.js
  - server/src/routes/recipeSchedule.js
  - server/src/models/{Recipe,RecipeSchedule,ShoppingSession}.js
  - mobile/src/lib/{groceryList,groceryAggregate}.ts
---

# Kitchen (recipes, meal planning, grocery)

## Purpose

A recipe box, a weekly meal planner, auto-generated grocery lists, and a
hands-free cooking mode. Recipe capture and suggestions are AI-assisted.

## Behavior (normative)

### Recipes

- A `Recipe` has a title, description, source/sourceUrl/imageUrl, servings,
  prep/cook times, structured `ingredients` (name/amount/unit), ordered
  `instructions` with per-step ingredient links (`instructionIngredients`) and
  timers (`instructionTimers`), and `tags`.
- CRUD is through the opaque record store (`/records`), not a per-recipe REST
  route. The `recipes` router is **AI/utility only**: `POST /recipes/from-url`,
  `/from-photo`, `/from-ai`, `/generate`, `/edit-with-ai` (capture/generate),
  `/suggest-recipes`, `/compute-ingredient-tags`, `/:id/share-email`.
- All AI capture paths are consent-gated and annotated — see
  [ai-assistant.md](ai-assistant.md).

### Meal planner & grocery

- The planner schedules recipes onto dates: `RecipeSchedule`
  (recipeId, scheduledDate, servings, notes). Endpoints:
  `GET /recipe-schedule`, `POST`, `PUT/DELETE /:id`, `GET /for-recipe/:recipeId`.
- The grocery list is **derived** by aggregating ingredients across the planned
  week (`lib/groceryAggregate.ts`, `groceryList.ts`), with an AI tidy pass
  (`POST /recipe-schedule/organize-grocery-list`).
- Shopping progress persists per week in `ShoppingSession`
  (`weekStart` + a `state` blob): `GET/PUT /recipe-schedule/session`.
- **Cooking mode** (`CookingModeScreen`) steps through instructions with timers.

## Data & API surface

- **Models:** `Recipe`, `RecipeSchedule`, `ShoppingSession` (all content records;
  sealed in the opaque store — see [platform/data-model.md](../platform/data-model.md)).
- **Endpoints:** `recipes.js` (AI/utility + share), `recipeSchedule.js` (planner,
  grocery, session).
- **Client:** `screens/kitchen/*` (Kitchen, Recipes, RecipeDetail/Form,
  FindRecipes, PlannerPane, GroceryPane/Schedule, CookingMode, AddMeal,
  MealPlannerSettings).

## Encryption boundary

Recipes, schedules, and shopping state are sealed content records. The
`share-email` path is a deliberate outside-share (a readable recipe snapshot to
the recipient). Grocery aggregation happens on-device over decrypted recipes.

## Open questions

- Confirm whether `ShoppingSession.state` (Mixed) is sealed like other content or
  stored plaintext, and pin it in [platform/data-model.md](../platform/data-model.md).
- Document the meal-planner week model + settings (`MealPlannerSettingsScreen`).
