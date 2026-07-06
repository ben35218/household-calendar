// Type declarations for @household/weather.

export interface WeatherHour {
  time: string;
  hour: number;
  temperature: number;
  precipProbability: number;
  precipitation: number;
  weatherCode: number;
  description: string;
}

export interface WeatherDay {
  date: string;
  weatherCode: number;
  description: string;
  tempMax: number;
  tempMin: number;
  precipSum: number;
  precipProbability: number;
  windMax: number;
  goodWeather: boolean;
  hours: WeatherHour[];
}

export interface WeatherForecast {
  current: {
    temperature: number;
    weatherCode: number;
    description: string;
    precipitation: number;
    humidity: number;
    windSpeed: number;
  } | null;
  forecast: WeatherDay[];
  units: { temperature: string; precipitation: string; wind: string };
}

export const WMO_DESCRIPTIONS: Record<number, string>;
export function isMowingDay(precipSum: number, precipProb: number, prevPrecipSum: number): boolean;
export function buildForecast(raw: any): WeatherForecast;
export function geocode(address: string): Promise<{ lat: number; lon: number }>;
export function fetchWeather(lat: number, lon: number): Promise<any>;
export function loadWeatherForAddress(address: string): Promise<WeatherForecast>;
