import { WEATHER_URL, type WeatherData } from "../domain/weather";
import snapshot from "../data/weather-snapshot.json";
import { fetchJSON } from "./net";
import { ls } from "../state/storage";

export interface WeatherState {
  data: WeatherData;
  live: boolean;
}

/** Cached answer first (or the bundled snapshot), then a live request to Open-Meteo. */
export function cachedWeather(): WeatherState {
  return { data: ls.get<WeatherData | null>("weather", null) ?? (snapshot as unknown as WeatherData), live: false };
}

export async function fetchWeather(): Promise<WeatherState | null> {
  try {
    const d = await fetchJSON<WeatherData>(WEATHER_URL, 7000);
    d._fetchedAt = Date.now();
    ls.set("weather", d);
    return { data: d, live: true };
  } catch {
    return null;
  }
}
