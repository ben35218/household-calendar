// Compact number display, e.g. 1100 → "1.1k", 5775 → "5.8k", 950 → "950",
// 2000 → "2k", 1_250_000 → "1.3m". Used for token counts in the assistant views.
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  if (abs < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
}
