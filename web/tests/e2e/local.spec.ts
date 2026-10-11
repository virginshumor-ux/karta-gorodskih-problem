// Functional scenarios from the prototype QA (docs/handoff/qa/qa.py), standalone demo backend, phone viewport.
import { expect, test, type Page } from "@playwright/test";
import { fixture, isolate, watchErrors } from "./helpers";

const S = <T>(page: Page, fn: string) => page.evaluate(`(() => ${fn})()`) as Promise<T>;

test("full citizen and moderator flow (qa.py → functional)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errs = watchErrors(page);
  await isolate(page);
  await page.goto("./");

  // onboarding → login
  await expect(page.locator(".onb h2")).toHaveCount(1);
  await page.click('[data-onb="1"]');
  await page.click('[data-onb="2"]');
  await expect(page.locator(".onb")).toContainText("Это не официальный канал");
  await page.click('[data-onb="3"]');
  await expect(page.locator("[data-act=vk]")).toHaveCount(1);
  await page.click("[data-act=skiplogin]");

  // create without login → login → demo login → nickname + separate consent → wizard opens by itself
  await page.click(".bottom-nav [data-go=create]");
  await expect(page.locator("[data-act=vk]")).toHaveCount(1);
  await page.click("[data-act=demologin]");
  await page.fill("#nick", "qa_user");
  await page.click("[data-act=dologin]");
  await expect(page.locator(".toast")).toContainText("согласие");
  await page.check("#pd-consent");
  await page.click("[data-act=dologin]");
  await expect.poll(() => S(page, "KGP.S.view")).toBe("create");

  // step 1: photos from gallery and camera inputs
  await expect(page.locator("[data-act=next]")).toBeDisabled();
  await page.setInputFiles("#photo-input", fixture("photo.png"));
  await expect(page.locator(".photo-slot img")).toHaveCount(1);
  await page.setInputFiles("#photo-camera", fixture("photo.png"));
  await expect(page.locator(".photo-slot img")).toHaveCount(2);
  await page.click('[data-rmphoto="1"]');
  await expect(page.locator(".photo-slot img")).toHaveCount(1);
  await page.click("[data-act=next]");

  // step 2: place → address from the geocoder
  await page.waitForFunction(() => (window as unknown as { KGP: { placeMap: () => unknown } }).KGP.placeMap());
  await page.evaluate(() => (window as any).KGP.placeMap().setView([56.00602, 92.80505], 18));
  await expect(page.locator("#addr-line")).toHaveText("Сопочная улица, 54А", { timeout: 15_000 });
  await expect(page.locator("[data-act=next]")).toBeEnabled();
  await page.click("[data-act=next]");

  // step 3: category, step 4: title length
  await expect(page.locator("[data-act=next]")).toBeDisabled();
  await page.click("[data-pickcat=snow]");
  await page.click("[data-act=next]");
  await page.fill("#f-title", "Тест");
  await expect(page.locator("[data-act=next]")).toBeDisabled();
  await page.fill("#f-title", "Тротуар не чищен у остановки");
  await page.fill("#f-desc", "Проверка описания");
  await expect(page.locator("#desc-count")).toHaveText("17 / 500");
  await page.click("[data-act=next]");

  // step 5: duplicate within 30 m (demo «Не убран тротуар после снегопада»), send anyway
  await expect(page.locator(".dup")).toHaveCount(1);
  await expect(page.locator("[data-act=next]")).toHaveText("Всё равно отправить");
  await page.click("[data-act=next]");
  await expect(page.locator(".success")).toHaveCount(1);
  const cid = await S<string>(page, "KGP.S.draft.createdId");
  const rec = await S<{ status: string; photos: unknown[]; address: string }>(page, `KGP.S.complaints.find(c => c.id === '${cid}')`);
  expect(rec.status).toBe("moderation");
  expect(rec.photos).toHaveLength(1);
  expect(rec.address).toBe("Сопочная улица, 54А");

  // official appeal from the success screen
  await page.click("[data-act=toappeal]");
  await expect(page.locator("#appeal-text")).toContainText("Тротуар не чищен у остановки");
  await page.click("[data-act=copyappeal]");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Прошу принять меры");
  await page.click("[data-act=back]");

  // reload: data and login persist, onboarding is not repeated
  await page.reload();
  await expect.poll(() => S(page, `!!KGP.S.complaints.find(c => c.id === '${cid}')`)).toBe(true);
  expect(await S(page, "KGP.S.auth.kind")).toBe("user");
  await expect(page.locator(".onb")).toHaveCount(0);

  // map: pin → preview sheet → support
  await page.evaluate(() => {
    const k = (window as any).KGP;
    k.S.selected = "demo-8";
    k.drawMarkers();
    k.renderHud();
  });
  const before = await S<number>(page, "KGP.S.complaints.find(c => c.id === 'demo-8').supports");
  await page.click(".sheet [data-act=support]");
  await expect.poll(() => S(page, "KGP.S.complaints.find(c => c.id === 'demo-8').supports")).toBe(before + 1);
  await page.click(".sheet [data-open]");
  await expect.poll(() => S(page, "KGP.S.view")).toBe("detail");
  await expect(page.locator("#minimap .leaflet-image-layer, #minimap .leaflet-tile")).not.toHaveCount(0);

  // confirmation of the solution
  await page.evaluate(() => (window as any).KGP.openDetail("demo-4"));
  await page.click("[data-act=confirm]");
  await expect.poll(() => S(page, "KGP.S.complaints.find(c => c.id === 'demo-4').confirms")).toBe(2);

  // report with reasons
  await page.click("[data-act=report]");
  await expect(page.locator(".modal input[name=rep]")).toHaveCount(5);
  await page.click("[data-act=sendreport]");
  await expect(page.locator(".modal")).toHaveCount(0);

  // moderator (demo switch): publish, then "in work"; history grows
  await page.click("[data-act=back]");
  await page.click(".bottom-nav [data-go=profile]");
  await page.click("[data-act=togglemod]");
  await page.evaluate((id) => (window as any).KGP.openDetail(id), cid);
  await page.click("[data-mod=published]");
  await expect.poll(() => S(page, `KGP.S.complaints.find(c => c.id === '${cid}').status`)).toBe("published");
  await page.click("[data-mod=work]");
  await expect.poll(() => S(page, `KGP.S.complaints.find(c => c.id === '${cid}').status`)).toBe("work");
  await expect(page.locator(".timeline li")).toHaveCount(3);

  // notifications
  await page.click("[data-act=back]");
  await page.click(".bottom-nav [data-go=notif]");
  expect(await page.locator(".notif.unread").count()).toBeGreaterThan(0);
  await page.click("[data-act=readall]");
  await expect(page.locator(".notif.unread")).toHaveCount(0);

  // list: search keeps focus, filters
  await page.click(".bottom-nav [data-go=list]");
  await page.click("#search");
  await page.keyboard.type("Кецховели", { delay: 20 });
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("search");
  await expect(page.locator("#list-results .c-item")).toHaveCount(1);
  await page.fill("#search", "");
  await page.dispatchEvent("#search", "input");
  await page.click(".screen [data-status=all]");
  const all = await page.locator("#list-results .c-item").count();
  await page.click(".screen [data-cat=road]");
  const road = await page.locator("#list-results .c-item").count();
  expect(all).toBeGreaterThan(road);
  expect(road).toBeGreaterThan(0);
  await page.click(".screen [data-cat=road]");

  // weather and statistics
  await page.click(".bottom-nav [data-go=profile]");
  await page.click("#panel [data-go=weather]");
  await expect(page.locator(".wx-now")).toHaveCount(1);
  expect(await page.locator(".hour").count()).toBeGreaterThanOrEqual(12);
  await page.click("[data-act=back]");
  await page.click("#panel [data-go=stats]");
  await expect.poll(() => page.locator(".bar-row").count()).toBeGreaterThanOrEqual(5);
  await page.click("[data-act=back]");

  // theme: system → light → dark → system
  await page.click("[data-act=theme]");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await page.click("[data-act=theme]");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.click("[data-act=theme]");

  // account deletion removes the user's data
  await page.click("[data-act=deleteacc]");
  await page.click("[data-act=confirmdelete]");
  await expect.poll(() => S(page, `!KGP.S.complaints.find(c => c.id === '${cid}') && KGP.S.auth.kind === 'guest'`)).toBe(true);

  // demo reset restores 15 records
  await page.click(".bottom-nav [data-go=profile]");
  await page.click("[data-act=resetdemo]");
  await expect.poll(() => S(page, "KGP.S.complaints.length")).toBe(15);

  // map view hides the panel on the phone
  await page.click(".bottom-nav [data-go=map]");
  expect(await page.evaluate(() => (document.getElementById("panel") as HTMLElement).hidden)).toBe(true);
  expect(errs, errs.join("\n")).toEqual([]);
});

test("deep link opens the complaint card, back returns to the map", async ({ page }) => {
  const errs = watchErrors(page);
  await isolate(page);
  await page.addInitScript(() => localStorage.setItem("kgp.onboarded", "true"));
  await page.goto("./#/c/demo-9");
  await expect(page.locator(".detail-head h2")).toHaveText("Колея и ямы на проезжей части");
  await expect(page.locator(".timeline li")).toHaveCount(4);
  await page.click(".hero [data-act=back]");
  await expect.poll(() => S(page, "KGP.S.view")).toBe("map");
  expect(errs).toEqual([]);
});

test("privacy policy is available before registration", async ({ page }) => {
  await isolate(page);
  await page.goto("./");
  await page.click('[data-onb="3"]');
  await page.click(".legal [data-act=privacy]");
  await expect(page.locator(".modal .prose h2").first()).toHaveText("Политика обработки персональных данных");
  await expect(page.locator(".modal .prose")).toContainText("Удалить учётную запись и мои данные");
});
