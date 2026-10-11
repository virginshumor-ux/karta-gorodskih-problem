// Desktop layout (≥ 900 px): rail + 420 px panel + map; moderator panel #/admin.
import { expect, test } from "@playwright/test";
import { isolate, skipOnboarding, watchErrors } from "./helpers";

test("desktop layout repeats the prototype", async ({ page }) => {
  const errs = watchErrors(page);
  await isolate(page);
  await page.goto("./");
  await skipOnboarding(page);
  await page.reload();
  await page.evaluate(() => (window as any).KGP.closeOverlay());
  const rail = await page.locator("#rail .nav-item").allInnerTexts();
  expect(rail).toHaveLength(3);
  expect(rail[0]).toContain("Обращения");
  expect(await page.locator("#panel .c-item").count()).toBeGreaterThan(5);
  const panel = await page.locator("#panel").boundingBox();
  expect(Math.round(panel?.width ?? 0)).toBe(420);
  await page.locator("#panel .c-item").first().click();
  await expect.poll(() => page.evaluate(() => (window as any).KGP.S.view)).toBe("detail");
  const w = await page.evaluate(() => document.querySelector("#map")!.getBoundingClientRect().width);
  expect(w).toBeGreaterThan(800);
  expect(errs).toEqual([]);
});

test("moderator panel: queue, publish, analytics, CSV", async ({ page }) => {
  const errs = watchErrors(page);
  await isolate(page);
  await page.goto("./");
  await page.evaluate(() => {
    localStorage.setItem("kgp.onboarded", "true");
    localStorage.setItem("kgp.local.signedIn", "true");
    localStorage.setItem("kgp.local.user", JSON.stringify({ nick: "модератор", since: Date.now() }));
    localStorage.setItem("kgp.moderator", "true");
  });
  await page.goto("./#/admin");
  await page.reload();
  await expect(page.locator(".adm-head h1")).toHaveText("Панель модератора");
  await expect(page.locator(".adm-body .adm-row")).toHaveCount(1); // demo «Разрушено ограждение детской площадки»
  await page.click(".adm-body [data-mod=published]");
  await expect(page.locator(".adm-body .empty")).toContainText("Очередь модерации пуста");
  await page.click("[data-admtab=analytics]");
  await expect(page.locator(".admin .kpis .stat").first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.click("[data-act=exportcsv]");
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^kgp-complaints-\d{4}-\d{2}-\d{2}\.csv$/);
  await page.click("[data-admtab=dicts]");
  await expect(page.locator("[data-catrow]")).toHaveCount(10);
  expect(errs).toEqual([]);
});
