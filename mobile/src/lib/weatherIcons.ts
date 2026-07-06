// WMO weather code → a standard, condition-appropriate colour (sun = amber,
// cloud/fog = grey, rain = blue, snow = light blue, storm = purple) so the
// calendar/forecast don't read as "rain every day".
export function weatherColor(code: number): string {
  if (code === 0 || code === 1) return '#F4C542';       // clear — gold
  if (code === 2) return '#F4C542';                     // partly cloudy (sun + cloud) — gold
  if (code === 3) return '#A8B0BA';                     // overcast — grey
  if (code === 45 || code === 48) return '#C9CED6';     // fog — light grey
  if (code >= 51 && code <= 67) return '#3F8EF8';       // drizzle / rain — blue
  if (code >= 71 && code <= 77) return '#D7F2FF';       // snow — ice blue
  if (code >= 80 && code <= 82) return '#3F8EF8';       // rain showers — blue
  if (code === 85 || code === 86) return '#D7F2FF';     // snow showers — ice blue
  if (code >= 95) return '#5C6BC0';                     // thunderstorm — indigo
  return '#A8B0BA';
}

// WMO weather code → MaterialCommunityIcons name (mirrors web wmoIcon).
export function wmoIcon(code: number): string {
  if (code === 0) return 'weather-sunny';
  if (code === 1 || code === 2) return 'weather-partly-cloudy';
  if (code === 3) return 'weather-cloudy';
  if (code === 45 || code === 48) return 'weather-fog';
  if (code >= 51 && code <= 57) return 'weather-partly-rainy';
  if (code >= 61 && code <= 67) return 'weather-rainy';
  if (code >= 71 && code <= 77) return 'weather-snowy';
  if (code >= 80 && code <= 82) return 'weather-pouring';
  if (code === 85 || code === 86) return 'weather-snowy-heavy';
  if (code >= 95) return 'weather-lightning-rainy';
  return 'weather-cloudy';
}
