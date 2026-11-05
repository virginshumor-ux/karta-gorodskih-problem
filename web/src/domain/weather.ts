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
    wind_direction_10m?: number;
    wind_gusts_10m?: number;
    pressure_msl?: number;
    uv_index?: number;
  };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability?: number[] };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise?: string[];
    sunset?: string[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
    uv_index_max?: number[];
  };
  _fetchedAt?: number;
}

export interface AirData {
  current: {
    time: string;
    european_aqi: number;
    us_aqi?: number;
    pm10: number;
    pm2_5: number;
    nitrogen_dioxide?: number;
    sulphur_dioxide?: number;
    carbon_monoxide?: number;
    ozone?: number;
  };
  hourly?: { time: string[]; pm2_5: (number | null)[]; european_aqi: (number | null)[] };
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
  "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,is_day,uv_index" +
  "&hourly=temperature_2m,weather_code,precipitation_probability" +
  "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,wind_speed_10m_max,uv_index_max" +
  "&timezone=Asia%2FKrasnoyarsk&forecast_days=7&wind_speed_unit=ms";

/** Open-Meteo air quality (CAMS): PM2.5, PM10, NO₂, SO₂ — Krasnoyarsk's "black sky" smog episodes. */
export const AIR_URL =
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${CITY.lat}&longitude=${CITY.lng}` +
  "&current=european_aqi,us_aqi,pm10,pm2_5,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,ozone" +
  "&hourly=pm2_5,european_aqi&timezone=Asia%2FKrasnoyarsk&forecast_days=2";

export interface AqiLevel {
  key: "good" | "fair" | "moderate" | "poor" | "verypoor" | "extreme";
  title: string;
  advice: string;
  color: string;
}

/** European AQI bands (EEA) with advice in Russian. */
export function aqiLevel(eaqi: number): AqiLevel {
  if (eaqi <= 20) return { key: "good", title: "Хорошее", advice: "Воздух чистый — можно гулять и проветривать.", color: "#2e9d5b" };
  if (eaqi <= 40) return { key: "fair", title: "Удовлетворительное", advice: "Качество воздуха приемлемое.", color: "#8bb43a" };
  if (eaqi <= 60) return { key: "moderate", title: "Умеренное", advice: "Чувствительным людям стоит сократить долгие прогулки.", color: "#e0a800" };
  if (eaqi <= 80) return { key: "poor", title: "Плохое", advice: "Возможен режим «чёрного неба»: закройте окна, ограничьте пребывание на улице.", color: "#e8611a" };
  if (eaqi <= 100) return { key: "verypoor", title: "Очень плохое", advice: "Режим «чёрного неба»: оставайтесь в помещении, используйте очиститель воздуха.", color: "#c62828" };
  return { key: "extreme", title: "Опасное", advice: "Опасный уровень загрязнения: избегайте пребывания на улице.", color: "#7b1fa2" };
}

export function windDir(deg: number | undefined): string {
  if (deg == null) return "";
  return ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"][Math.round(((deg % 360) + 360) % 360 / 45) % 8] as string;
}

export interface CityWarning {
  icon: string;
  level: "warn" | "bad" | "info";
  text: string;
}

/** All city-environment warnings: ice, snowfall, wind, frost, heat and air pollution. */
export function cityWarnings(w: WeatherData | null | undefined, air?: AirData | null): CityWarning[] {
  const out: CityWarning[] = [];
  const ice = iceRisk(w);
  if (ice) out.push({ icon: "warning", level: "warn", text: ice });
  if (w) {
    const c = w.current;
    const gust = c.wind_gusts_10m ?? c.wind_speed_10m;
    if (gust >= 15) out.push({ icon: "air", level: "bad", text: `Сильный ветер, порывы до ${Math.round(gust)} м/с — опасайтесь падения веток и конструкций.` });
    if (c.temperature_2m <= -25) out.push({ icon: "ac_unit", level: "bad", text: `Сильный мороз ${Math.round(c.temperature_2m)}° — проверьте, работают ли остановки с подогревом и освещение.` });
    if (c.temperature_2m >= 30) out.push({ icon: "sunny", level: "warn", text: `Жара ${Math.round(c.temperature_2m)}° — сообщайте о неработающих фонтанах и питьевых точках.` });
  }
  if (air) {
    const l = aqiLevel(air.current.european_aqi);
    if (l.key === "poor" || l.key === "verypoor" || l.key === "extreme")
      out.push({ icon: "masks", level: "bad", text: `Качество воздуха: ${l.title.toLowerCase()}. ${l.advice}` });
  }
  return out;
}

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
