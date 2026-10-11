import { CITY } from "./constants";

export interface WeatherData {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    precipitation: number;
    is_day: number;
  };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability?: number[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
  _fetchedAt?: number;
}

const WMO: Record<number, [string, string, string]> = {
  0: ["Ясно", "clear_day", "clear_night"],
  1: ["Преимущественно ясно", "partly_cloudy_day", "partly_cloudy_night"],
  2: ["Переменная облачность", "partly_cloudy_day", "partly_cloudy_night"],
  3: ["Пасмурно", "cloud", "cloud"],
  45: ["Туман", "foggy", "foggy"],
  48: ["Изморозь, туман", "foggy", "foggy"],
  51: ["Слабая морось", "rainy_light", "rainy_light"],
  53: ["Морось", "rainy_light", "rainy_light"],
  55: ["Сильная морось", "rainy", "rainy"],
  56: ["Ледяная морось", "weather_mix", "weather_mix"],
  57: ["Ледяная морось", "weather_mix", "weather_mix"],
  61: ["Небольшой дождь", "rainy_light", "rainy_light"],
  63: ["Дождь", "rainy", "rainy"],
  65: ["Ливень", "rainy_heavy", "rainy_heavy"],
  66: ["Ледяной дождь", "weather_mix", "weather_mix"],
  67: ["Ледяной дождь", "weather_mix", "weather_mix"],
  71: ["Небольшой снег", "weather_snowy", "weather_snowy"],
  73: ["Снег", "weather_snowy", "weather_snowy"],
  75: ["Сильный снег", "snowing_heavy", "snowing_heavy"],
  77: ["Снежные зёрна", "weather_snowy", "weather_snowy"],
  80: ["Ливневый дождь", "rainy", "rainy"],
  81: ["Ливневый дождь", "rainy", "rainy"],
  82: ["Сильный ливень", "rainy_heavy", "rainy_heavy"],
  85: ["Снегопад", "weather_snowy", "weather_snowy"],
  86: ["Сильный снегопад", "snowing_heavy", "snowing_heavy"],
  95: ["Гроза", "thunderstorm", "thunderstorm"],
  96: ["Гроза с градом", "thunderstorm", "thunderstorm"],
  99: ["Гроза с градом", "thunderstorm", "thunderstorm"],
};

export function wmo(code: number, day: number | boolean = 1): { text: string; icon: string } {
  const w = WMO[code] ?? ["—", "cloud", "cloud"];
  return { text: w[0], icon: day ? w[1] : w[2] };
}

export const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${CITY.lat}&longitude=${CITY.lng}` +
  "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day" +
  "&hourly=temperature_2m,weather_code,precipitation_probability" +
  "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FKrasnoyarsk&forecast_days=3&wind_speed_unit=ms";

/** City-environment warning derived from the forecast (same rules as the prototype). */
export function iceRisk(w: WeatherData | null | undefined): string | null {
  if (!w) return null;
  const c = w.current;
  const t = c.temperature_2m;
  const code = c.weather_code;
  const nextHours = (w.hourly?.temperature_2m ?? []).slice(0, 24);
  const crosses = nextHours.some((x) => x > 0) && nextHours.some((x) => x < 0);
  if ([56, 57, 66, 67].includes(code)) return "Ледяной дождь — высокий риск гололёда. Сообщайте о наледи на тротуарах.";
  if (t <= 2 && t >= -4 && (c.precipitation > 0 || crosses))
    return "Температура около нуля — возможен гололёд. Отметьте опасные участки на карте.";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Снегопад — проверьте, убраны ли тротуары и остановки рядом с вами.";
  return null;
}
