// Pins the client-side grocery aggregation (Signal-parity D5) to the retired
// server /grocery-list behavior: same keying, servings multiplier, and sort.
import { aggregateGroceryList } from '../groceryAggregate';
import type { Recipe } from '../../api';

const soup: Recipe = {
  _id: 'r1', title: 'Soup', servings: 4,
  ingredients: [
    { name: 'Onion', amount: '1', unit: '' },
    { name: 'Garlic', amount: '2', unit: 'cloves' },
  ],
};
const stirFry: Recipe = {
  _id: 'r2', title: 'Stir fry', servings: 2,
  ingredients: [
    { name: 'garlic ', amount: '1', unit: 'clove' }, // case/space-insensitive merge
    { name: 'Broccoli', amount: '300', unit: 'g' },
  ],
};

const recipes = new Map<string, Recipe>([['r1', soup], ['r2', stirFry]]);

test('aggregates ingredients across the week, merging by normalized name', () => {
  const list = aggregateGroceryList(
    [
      { recipeId: 'r1', servings: 8 },          // doubled soup
      { recipeId: { _id: 'r2' }, servings: 2 }, // populated ref shape
    ],
    recipes,
  );
  expect(list.map((g) => g.name)).toEqual(['Broccoli', 'Garlic', 'Onion']); // sorted
  const garlic = list.find((g) => g.name === 'Garlic')!;
  expect(garlic.entries).toHaveLength(2); // merged from both recipes
  expect(garlic.entries![0]).toMatchObject({ recipeTitle: 'Soup', multiplier: 2 });
});

test('schedules pointing at unknown or ingredient-less recipes are skipped', () => {
  const list = aggregateGroceryList(
    [{ recipeId: 'missing' }, { recipeId: 'r1' }],
    new Map([['r1', { _id: 'r1', title: 'Bare' } as Recipe]]),
  );
  expect(list).toEqual([]);
});
