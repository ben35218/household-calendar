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
