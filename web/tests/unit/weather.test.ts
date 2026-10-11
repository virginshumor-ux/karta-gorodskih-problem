import { describe, expect, it } from "vitest";
import { iceRisk, wmo, type WeatherData } from "../../src/domain/weather";

function w(t: number, code: number, precipitation = 0, hourly: number[] = [t]): WeatherData {
  return {
    current: { time: "2026-11-02T08:00", temperature_2m: t, apparent_temperature: t, relative_humidity_2m: 80, weather_code: code, wind_speed_10m: 3, precipitation, is_day: 1 },
    hourly: { time: hourly.map((_, i) => `2026-11-02T${String(8 + i).padStart(2, "0")}:00`), temperature_2m: hourly, weather_code: hourly.map(() => code) },
    daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] },
  };
}

describe("iceRisk", () => {
  it("returns null without data", () => expect(iceRisk(null)).toBeNull());
  it("freezing rain is always high risk", () => {
    for (const code of [56, 57, 66, 67]) expect(iceRisk(w(-8, code))).toMatch(/^Ледяной дождь — высокий риск гололёда/);
  });
  it("near zero with precipitation warns about ice", () => expect(iceRisk(w(1, 61, 0.4))).toMatch(/возможен гололёд/));
  it("near zero crossing 0 °C within 24 h warns about ice", () => expect(iceRisk(w(-1, 3, 0, [-1, 0.5, 2, -2]))).toMatch(/возможен гололёд/));
  it("near zero, dry and not crossing zero — no warning", () => expect(iceRisk(w(-2, 3, 0, [-2, -3, -1]))).toBeNull());
  it("outside -4…+2 °C even with precipitation — no ice warning", () => expect(iceRisk(w(5, 61, 2))).toBeNull());
  it("snowfall asks to check sidewalks", () => expect(iceRisk(w(-15, 73))).toMatch(/^Снегопад/));
  it("clear weather — no warning", () => expect(iceRisk(w(-20, 0))).toBeNull());
});

describe("wmo", () => {
  it("maps codes to Russian text and day/night icons", () => {
    expect(wmo(0, 1)).toEqual({ text: "Ясно", icon: "clear_day" });
    expect(wmo(0, 0)).toEqual({ text: "Ясно", icon: "clear_night" });
    expect(wmo(75).text).toBe("Сильный снег");
  });
  it("unknown code falls back to a dash", () => expect(wmo(12345)).toEqual({ text: "—", icon: "cloud" }));
});
