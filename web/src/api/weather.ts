import { AIR_URL, WEATHER_URL, type AirData, type WeatherData } from "../domain/weather";
import snapshot from "../data/weather-snapshot.json";
import { fetchJSON } from "./net";
import { ls } from "../state/storage";

export interface WeatherState {
  data: WeatherData;
  live: boolean;
}

export interface AirState {
  data: AirData;
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

/** Air quality has no bundled snapshot: without a cached answer the card is simply not shown. */
export function cachedAir(): AirState | null {
  const d = ls.get<AirData | null>("air", null);
  return d ? { data: d, live: false } : null;
}

export async function fetchAir(): Promise<AirState | null> {
  try {
    const d = await fetchJSON<AirData>(AIR_URL, 7000);
    if (typeof d.current?.european_aqi !== "number") return null;
    d._fetchedAt = Date.now();
    ls.set("air", d);
    return { data: d, live: true };
  } catch {
    return null;
  }
}
