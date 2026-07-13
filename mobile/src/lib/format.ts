// Compact number display, e.g. 1100 → "1.1k", 5775 → "5.8k", 950 → "950",
// 2000 → "2k", 1_250_000 → "1.3m". Used for token counts in the assistant views.
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  if (abs < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
}

// "90" -> "1 hr 30 min", "60" -> "1 hr", "45" -> "45 min", "2880" -> "2 days".
export function formatDuration(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} ${d === 1 ? 'day' : 'days'}`);
  if (h) parts.push(`${h} hr`);
  if (m) parts.push(`${m} min`);
  return parts.join(' ');
}
