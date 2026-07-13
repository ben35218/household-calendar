import { outfitSuggestion } from '../outfit';

describe('outfitSuggestion', () => {
  it('hot clear day: heat + sun advice', () => {
    const s = outfitSuggestion({ tempMax: 34, tempMin: 24, weatherCode: 0 });
    expect(s).toMatch(/Very hot/);
    expect(s).toMatch(/sunscreen/);
  });

  it('warm clear day adds sunglasses', () => {
    const s = outfitSuggestion({ tempMax: 26, tempMin: 18, weatherCode: 1 });
    expect(s).toMatch(/Warm/);
    expect(s).toMatch(/sunglasses/);
  });

  it('rainy day recommends rain gear', () => {
    const s = outfitSuggestion({ tempMax: 20, tempMin: 14, weatherCode: 63, precipProbability: 80, precipSum: 8 });
    expect(s).toMatch(/Mild/);
    expect(s).toMatch(/rain jacket or umbrella/);
  });

  it('slight rain chance suggests a compact umbrella', () => {
    const s = outfitSuggestion({ tempMax: 20, tempMin: 15, weatherCode: 2, precipProbability: 35 });
    expect(s).toMatch(/compact umbrella/);
  });

  it('big diurnal swing asks for layers', () => {
    const s = outfitSuggestion({ tempMax: 28, tempMin: 12, weatherCode: 0 });
    expect(s).toMatch(/pack layers \(16° swing to 12° at night\)/);
  });

  it('snow day: boots; freezing day: winter coat', () => {
    const s = outfitSuggestion({ tempMax: -4, tempMin: -12, weatherCode: 73 });
    expect(s).toMatch(/Freezing/);
    expect(s).toMatch(/waterproof boots/);
  });

  it('thunderstorm wins over generic rain advice', () => {
    const s = outfitSuggestion({ tempMax: 27, tempMin: 19, weatherCode: 95, precipProbability: 90 });
    expect(s).toMatch(/thunderstorms/);
    expect(s).not.toMatch(/compact umbrella/);
  });

  it('cool windy day suggests a windbreaker', () => {
    const s = outfitSuggestion({ tempMax: 15, tempMin: 9, weatherCode: 3, windMax: 40 });
    expect(s).toMatch(/windbreaker/);
  });
});
