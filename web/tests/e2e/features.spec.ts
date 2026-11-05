// v1.1 features on the standalone demo backend: live weather and air quality, comments, command palette,
// heatmap, sorting, achievements, home area and smart create. Phone viewport, hermetic network.
import { expect, test, type Page } from "@playwright/test";
import { fixture, isolate, skipOnboarding, watchErrors } from "./helpers";

async function demoLogin(page: Page, nick = "qa_features"): Promise<void> {
  await page.evaluate(() => (window as any).KGP.openLogin());
  await page.click("[data-act=demologin]");
  await page.fill("#nick", nick);
  await page.check("#pd-consent");
  await page.click("[data-act=dologin]");
  await expect(page.locator(".toast")).toContainText(`Добро пожаловать, ${nick}`);
}

test.beforeEach(async ({ page }) => {
  await isolate(page);
  await page.goto("./");
  await skipOnboarding(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).KGP.S.complaints.length)).toBeGreaterThan(10);
});

test("weather v2: metrics, 7 days, air quality and the smog warning", async ({ page }) => {
  const errs = watchErrors(page);
  await expect(page.locator(".weather-chip .aq-dot")).toHaveCount(1);
  await page.click(".weather-chip");
  await expect(page.locator(".wx-now")).toHaveCount(1);
  await expect(page.locator(".wx-metric")).toHaveCount(6);
  await expect(page.locator(".aq-card .aq-val")).toHaveText("72");
  await expect(page.locator(".aq-card")).toContainText("Плохое");
  await expect(page.locator(".warn-item.bad")).toContainText("чёрного неба");
  expect(await page.locator(".days .list-row").count()).toBeGreaterThanOrEqual(3);
  // the map banner shows the most important warning
  await page.click("[data-act=back]");
  await expect(page.locator(".ice-banner")).toBeVisible();
  expect(errs).toEqual([]);
});

test("comments: guests read, residents write and delete their own", async ({ page }) => {
  const errs = watchErrors(page);
  await page.evaluate(() => (window as any).KGP.openDetail("demo-8"));
  await expect(page.locator(".comment")).toHaveCount(3);
  await page.click("[data-act=commentlogin]");
  await page.click("[data-act=demologin]");
  await page.fill("#nick", "qa_comment");
  await page.check("#pd-consent");
  await page.click("[data-act=dologin]");
  await expect(page.locator("#comment-text")).toBeFocused();
  await page.fill("#comment-text", "Сегодня мусора стало ещё больше");
  await page.click("[data-form=comment] button[type=submit]");
  await expect(page.locator(".comment")).toHaveCount(4);
  await expect(page.locator(".comment.mine")).toContainText("Сегодня мусора стало ещё больше");
  await expect(page.locator(".section-title .count")).toHaveText("4");
  await page.click(".comment.mine [data-act=delcomment]");
  await expect(page.locator(".comment")).toHaveCount(3);
  await expect(page.locator(".section-title .count")).toHaveText("3");
  expect(errs).toEqual([]);
});

test("command palette: actions, complaints and an address to report at", async ({ page }) => {
  await demoLogin(page);
  await page.keyboard.press("Control+k");
  await expect(page.locator("#palette-q")).toBeFocused();
  await page.fill("#palette-q", "свалк");
  await expect(page.locator(".palette-item").filter({ hasText: "Несанкционированная свалка у гаражей" })).toHaveCount(1);
  await page.fill("#palette-q", "Киренского 26");
  await expect(page.locator(".palette-group").filter({ hasText: "Адреса" })).toHaveCount(1);
  await expect(page.locator(".palette-item").filter({ hasText: "Корпус 14" }).first()).toContainText("улица Академика Киренского, 26");
  await page.locator(".palette-item").filter({ hasText: "Сообщить о проблеме: Корпус 14" }).click();
  await expect(page.locator(".palette")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).KGP.S.view)).toBe("create");
  expect(await page.evaluate(() => (window as any).KGP.S.draft.lat)).toBeCloseTo(56.0045, 3);
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  await expect(page.locator(".palette")).toHaveCount(0);
});

test("heatmap, sorting, achievements and the home area", async ({ page }) => {
  const errs = watchErrors(page);
  await page.click("[data-act=heat]");
  await expect(page.locator("#map .leaflet-heatmap-layer")).toHaveCount(1);
  await expect(page.locator("#map .pin")).toHaveCount(0);
  await page.click("[data-act=heat]");
  await expect(page.locator("#map .leaflet-heatmap-layer")).toHaveCount(0);

  await page.click(".bottom-nav [data-go=list]");
  await page.click(".screen [data-status=all]");
  await page.click("[data-sort=popular]");
  await expect(page.locator("#list-results .c-item").first()).toContainText("Колея и ямы на проезжей части");
  await expect(page.locator("#list-results")).toContainText("сначала самые поддержанные");

  await demoLogin(page, "qa_home");
  await page.click(".bottom-nav [data-go=profile]");
  await expect(page.locator(".badge")).toHaveCount(8);
  await expect(page.locator(".badge.done").filter({ hasText: "Первый шаг" })).toHaveCount(1);
  await page.click("[data-act=homearea]");
  await expect(page.locator("#homemap .leaflet-tile, #homemap .leaflet-image-layer")).not.toHaveCount(0);
  await page.click("[data-radius='1000']");
  await page.click("[data-act=savehome]");
  await expect(page.locator(".toast")).toContainText("рядом с домом");
  await expect(page.locator("[data-act=homearea]")).toContainText("1 км");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("kgp.local.home") as string).radius)).toBe(1000);
  expect(errs).toEqual([]);
});

test("smart create: category suggestion from the text", async ({ page }) => {
  await demoLogin(page, "qa_smart");
  await page.click(".bottom-nav [data-go=create]");
  await page.setInputFiles("#photo-input", fixture("photo.png"));
  await expect(page.locator(".photo-slot img")).toHaveCount(1);
  await page.click("[data-act=next]");
  await page.evaluate(() => (window as any).KGP.placeMap().setView([56.00602, 92.80505], 18));
  await expect(page.locator("[data-act=next]")).toBeEnabled({ timeout: 15_000 });
  await page.click("[data-act=next]");
  await page.click("[data-pickcat=snow]");
  await page.click("[data-act=next]");
  await page.fill("#f-title", "Огромные сосульки на крыше");
  await expect(page.locator(".suggest")).toContainText("Сосульки и опасные кровли");
  await page.click("[data-act=applysuggest]");
  expect(await page.evaluate(() => (window as any).KGP.S.draft.category)).toBe("ice");
  await expect(page.locator(".suggest")).toHaveCount(0);
});
