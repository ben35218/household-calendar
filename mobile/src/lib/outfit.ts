// Rule-based "what to wear" line for a forecast day (trip day view). Pure and
// deterministic — no AI call, works offline from the cached forecast.

export interface OutfitInput {
  tempMax: number;
  tempMin: number;
  precipProbability?: number;
  precipSum?: number;
  weatherCode?: number;
  windMax?: number;
}

export function outfitSuggestion(d: OutfitInput): string {
  const parts: string[] = [];

  if (d.tempMax >= 30) parts.push('Very hot — shorts and breathable fabrics; hat and sunscreen');
  else if (d.tempMax >= 24) parts.push('Warm — light summer clothing');
  else if (d.tempMax >= 18) parts.push('Mild — t-shirt weather, light layer for evening');
  else if (d.tempMax >= 12) parts.push('Cool — long sleeves with a light jacket');
  else if (d.tempMax >= 5) parts.push('Chilly — jacket and layers');
  else if (d.tempMax >= 0) parts.push('Cold — warm coat, hat and gloves');
  else parts.push('Freezing — heavy winter coat, hat and gloves');

  // Sun protection on clear warm days (heat bucket already covers ≥30).
  if ((d.weatherCode ?? 99) <= 1 && d.tempMax >= 24 && d.tempMax < 30) parts.push('sunglasses and sunscreen');

  // Big day-night swing: evenings need more than the daytime pick suggests.
  if (d.tempMax - d.tempMin >= 12) parts.push(`pack layers (${Math.round(d.tempMax - d.tempMin)}° swing to ${Math.round(d.tempMin)}° at night)`);

  const code = d.weatherCode ?? -1;
  const snowy = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const stormy = code >= 95;
  const prob = d.precipProbability ?? 0;
  const sum = d.precipSum ?? 0;
  if (stormy) parts.push('thunderstorms expected — rain jacket and an indoor backup plan');
  else if (snowy) parts.push('snow — waterproof boots');
  else if (prob >= 60 || sum >= 5) parts.push('rain likely — bring a rain jacket or umbrella');
  else if (prob >= 30 || sum >= 1) parts.push('a compact umbrella wouldn’t hurt');

  if ((d.windMax ?? 0) >= 30 && d.tempMax < 24) parts.push('windy — a windbreaker helps');

  return parts.join(' · ');
}
