// Imperative handle shared by every calendar view layer (month grid, list) so
// the host's single "Today" button can drive whichever layer is active.
export type TodayHandle = { scrollToToday: (animated?: boolean) => void };
