// Map base layer must never show "Access blocked" (qa_block.py + the required scenarios of the task).
import { expect, test, type Page } from "@playwright/test";
import { isolate, skipOnboarding, watchErrors } from "./helpers";

async function open(page: Page) {
  await page.goto("./");
  await skipOnboarding(page);
  await page.reload();
  await page.evaluate(() => (window as any).KGP.closeOverlay());
}

const state = (page: Page) =>
  page.evaluate(() => ({
    mode: (window as any).KGP.S.mapMode as string,
    hosts: [...new Set([...document.querySelectorAll<HTMLImageElement>("#map .leaflet-tile-loaded")].map((i) => new URL(i.src).host))],
    snapshot: document.querySelectorAll("#map .snap-layer").length,
  }));

test("osm.org answers with the blocked stub (403) → switches to osm.de", async ({ page }) => {
  const errs = watchErrors(page);
  await isolate(page, { org: "blocked403", de: "ok", fr: "ok" });
  await open(page);
  await expect.poll(async () => (await state(page)).mode, { timeout: 20_000 }).toBe("live");
  await expect.poll(async () => (await state(page)).hosts).toEqual(["tile.openstreetmap.de"]);
  expect(errs).toEqual([]);
});

test("osm.org answers with the blocked stub and HTTP 200 → recognized by pixels, osm.de used", async ({ page }) => {
  await isolate(page, { org: "blocked200", de: "ok", fr: "ok" });
  await open(page);
  await expect.poll(async () => (await state(page)).hosts, { timeout: 20_000 }).toEqual(["tile.openstreetmap.de"]);
  await expect(page.locator(".map-mode")).toHaveCount(0);
});

test("all tile servers blocked → built-in Krasnoyarsk map with a notice", async ({ page }) => {
  const errs = watchErrors(page);
  await isolate(page, { org: "blocked200", de: "blocked403", fr: "fail" });
  await open(page);
  await expect.poll(async () => (await state(page)).mode, { timeout: 25_000 }).toBe("snapshot");
  const s = await state(page);
  expect(s.hosts).toEqual([]);
  expect(s.snapshot).toBe(2);
  await expect(page.locator(".map-mode")).toContainText("Встроенная карта");
  expect(errs).toEqual([]);
});

test("whole network closed → built-in map, demo data, the app keeps working", async ({ page }) => {
  const errs = watchErrors(page);
  await page.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), (r) => r.abort());
  await open(page);
  await expect.poll(async () => (await state(page)).mode, { timeout: 25_000 }).toBe("snapshot");
  expect((await state(page)).snapshot).toBe(2);
  expect(await page.locator(".pin").count()).toBeGreaterThan(0);
  // weather falls back to the cached / bundled snapshot
  await expect(page.locator(".weather-chip")).toHaveCount(1);
  expect(errs).toEqual([]);
});
