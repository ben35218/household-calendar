import { recipeIconTarget } from '../calendar';

describe('recipeIconTarget (calendar meal icon navigation)', () => {
  it('opens the recipe view for a day with a single scheduled meal', () => {
    expect(recipeIconTarget([{ recipeId: 'abc123' }], '2026-07-20')).toEqual({
      screen: 'RecipeDetail',
      params: { id: 'abc123' },
    });
  });

  it('falls back to the day view when several meals are scheduled', () => {
    expect(recipeIconTarget([{ recipeId: 'a' }, { recipeId: 'b' }], '2026-07-20')).toEqual({
      screen: 'CalendarDay',
      params: { date: '2026-07-20' },
    });
  });

  it('falls back to the day view when the single meal has no linked recipe', () => {
    // e.g. a schedule whose recipe reference didn't populate.
    expect(recipeIconTarget([{ recipeId: undefined }], '2026-07-20')).toEqual({
      screen: 'CalendarDay',
      params: { date: '2026-07-20' },
    });
  });
});
