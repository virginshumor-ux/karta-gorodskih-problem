import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

export const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const file = (name: string) => readFileSync(fixture(name));

const TILE_HOSTS = /^(tile\.openstreetmap\.(org|de)|a\.tile\.openstreetmap\.fr)$/;

/**
 * Hermetic network: tiles, geocoder and weather are served from fixtures, every other
 * external host is aborted. `tiles` decides what each tile server answers.
 */
export async function isolate(
  page: Page,
  tiles: Partial<Record<"org" | "de" | "fr", "ok" | "blocked403" | "blocked200" | "fail">> = { org: "ok" },
): Promise<void> {
  const ok = file("normal_tile.png");
  const blocked = file("blocked_tile.png");
  await page.route(
    (u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname),
    async (route) => {
      const u = new URL(route.request().url());
      if (TILE_HOSTS.test(u.hostname)) {
        const key = u.hostname.endsWith(".org") ? "org" : u.hostname.endsWith(".de") ? "de" : "fr";
        const mode = tiles[key] ?? "fail";
        if (mode === "fail") return route.abort();
        const body = mode === "ok" ? ok : blocked;
        return route.fulfill({ status: mode === "blocked403" ? 403 : 200, body, headers: { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" } });
      }
      if (u.hostname === "nominatim.openstreetmap.org")
        return route.fulfill({ status: 200, body: file("nominatim.json"), headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      if (u.hostname === "api.open-meteo.com")
        return route.fulfill({ status: 200, body: file("weather.json"), headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      return route.abort();
    },
  );
}

/** Collects uncaught page errors and console errors (except failed resource loads). */
export function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|net::ERR|status of 4\d\d/.test(m.text())) errs.push("console: " + m.text());
  });
  return errs;
}

export async function skipOnboarding(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.setItem("kgp.onboarded", "true"));
}
