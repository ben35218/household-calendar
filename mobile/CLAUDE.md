# Mobile app — UI conventions

Read this before adding or editing a screen. The goal is that every view reaches
for the same shared primitive instead of re-rolling one. All primitives live in
[src/components/ui.tsx](src/components/ui.tsx); design tokens in
[src/theme.ts](src/theme.ts); the grouped-form styles in
[src/components/formStyles.tsx](src/components/formStyles.tsx).

Never hard-code colours, spacing, or radii — use `colors`, `spacing`, `radius`
from the theme.

## Screen scaffolding

- **Forms / detail screens** → wrap in `<Screen>` (handles the keyboard-aware
  scroll + padding). `<Screen scroll={false}>` for a non-scrolling screen.
- **Lists** → `FlatList` / `SectionList` (not a `ScrollView.map`). Every
  top-level, query-backed list gets pull-to-refresh:
  `refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} />}`.
- Scroll content bottom padding: `spacing.xl` by default; `96` only when a FAB
  overlaps the list.

## The section accent

Each feature area has an accent colour from `useCalendarColors().colors.<area>`
(`chores`, `maintenance`, `vacations`, `recipes`, …). Tint the area's add button,
FAB, save check, spinners, empty-state CTA, and primary buttons with it — don't
default those to `colors.primary` inside an accented area.

## Loading & empty & error states

| Need | Use | Notes |
| --- | --- | --- |
| List loading | `<SkeletonList />` | Skeleton rows, not a spinner |
| Detail/other loading | `<CenteredLoader color={accent} />` | |
| Empty list | `<EmptyState icon/mdiIcon title message actionLabel onAction accent />` | `variant="inline"` inside a populated scroll view; `children` for extra links |
| Form/validation error | `<FormError>{error}</FormError>` | Renders null when empty |
| Explainer text above content | `<Hint>…</Hint>` | The muted 13px helper line |

## Headers, buttons, rows

- **Add action on a list** → `RoundIconButton icon="add"` in `headerRight`, `bg={accent}`.
- **Header action on a detail screen** (edit pencil / share / print) → `<HeaderIconButton icon onPress accessibilityLabel />` in `headerRight`.
- **Floating action button** (detail screen adds a sub-item, or the AI assistant) → `<Fab icon onPress bg={accent} />` (or `<Fab>` with a custom glyph child).
- **Grouped info rows on a detail screen** → `<InfoCard>` wrapping `ListRow`s (InfoCard = a Card that hands its padding to the rows).
- **Form save/close chrome** → `useHeaderCheckButton(navigation, { onPress, loading, color: accent })`.
- **Titles/labels** — three distinct roles, don't mix them:
  - `<ScreenTitle>` = the bold 24px in-body header title on a detail screen (the
    item/recipe/event name at the top of its page).
  - `<SectionTitle>` = the bold in-form heading (add/edit forms).
  - `<SectionHeader>` = the quiet uppercase eyebrow above a group of rows/cards
    (lists & detail screens).
- **Bottom sheet** (custom picker / action / confirm sheet) → `<BottomSheet visible onClose title? style? avoidKeyboard?>`. `avoidKeyboard` when it holds text inputs. Don't hand-roll a `Modal` + backdrop + slide-up `Pressable`.
- **Leading disc on a row** → `<IconAvatar icon/mdiIcon bg size={44} />`
  (`radius` for a rounded-square instead of a circle).
- **Settings-style tappable row** (inside an InfoCard/GroupCard) → `<ListRow icon title subtitle onPress right />`.
- **Standalone list card** (its own tappable Card: avatar + title + subtitle + trailing) → `<CardRow leading title subtitle right onPress titleRight />`. `subtitle` may be a node (icon-studded meta row); `right` falls back to a chevron when `onPress` is set. Keep a raw Card for bespoke cards (expandable, swipeable, flush colour-bar).
- **Buttons** → `<Button variant="primary|ghost|danger" color={accent} />`.
- **Filter pills** → `<Chip label selected onPress color={accent} />`.
- **Colour picker** → `<ColorPicker value onChange options={COLOR_PRESETS} />`.

## Destructive actions

Always `Button variant="danger"` + a native confirm:

```ts
Alert.alert('Delete X?', 'This cannot be undone.', [
  { text: 'Cancel', style: 'cancel' },
  { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
]);
```

Do not build a custom `<Modal>` confirm dialog.

## Known distinct patterns (intentionally not the above)

- Removable **tag tokens** (RecipeForm) are a chip with an ✕ — not the filter `Chip`.
- Calendar-grid event chips are their own tiny component, not the filter `Chip`.
- `CalendarColorsScreen`'s recolour+reset modal is a superset of `ColorPicker`.
