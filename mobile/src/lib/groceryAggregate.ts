// Pure grocery aggregation (no e2ee/native imports so it's unit-testable) —
// mirrors the retired server /grocery-list aggregation exactly. The fetching +
// decrypting wrapper lives in lib/groceryList.ts.

import type { Recipe, GroceryItem } from '../api';

export function aggregateGroceryList(
  schedules: Array<{ servings?: number | null; recipeId?: unknown }>,
  recipesById: Map<string, Recipe>,
): GroceryItem[] {
  const map = new Map<string, GroceryItem>();
  for (const s of schedules) {
    const rid = s.recipeId && typeof s.recipeId === 'object'
      ? String((s.recipeId as { _id: string })._id)
      : String(s.recipeId ?? '');
    const recipe = recipesById.get(rid);
    if (!recipe?.ingredients) continue;
    const multiplier = s.servings && recipe.servings ? s.servings / recipe.servings : 1;
    for (const ing of recipe.ingredients) {
      const key = ing.name.toLowerCase().trim();
      let item = map.get(key);
      if (!item) {
        item = { name: ing.name, entries: [] };
        map.set(key, item);
      }
      item.entries!.push({
        recipeTitle: recipe.title,
        amount: ing.amount || '',
        unit: ing.unit || '',
        multiplier,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
