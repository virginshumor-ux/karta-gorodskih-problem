// Shared database scenario against a real Supabase (CI: `supabase start`). Runs only when VITE_SUPABASE_URL is set.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { isolate, watchErrors } from "./helpers";

const URL_ = process.env.VITE_SUPABASE_URL as string;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

async function newUser(browser: Browser, nick: string): Promise<{ page: Page; errs: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  // Supabase itself (127.0.0.1:54321) stays reachable; external hosts are mocked.
  await isolate(page);
  await page.addInitScript(() => localStorage.setItem("kgp.onboarded", "true"));
  await page.goto("./");
  await page.evaluate(() => (window as any).KGP.openLogin());
  await page.click("[data-act=demologin]");
  await page.fill("#nick", nick);
  await page.check("#pd-consent");
  await page.click("[data-act=dologin]");
  await expect.poll(() => page.evaluate(() => (window as any).KGP.S.auth.kind)).toBe("user");
  return { page, errs };
}

async function promote(nick: string): Promise<void> {
  const r = await fetch(`${URL_}/rest/v1/profiles?nickname=eq.${encodeURIComponent(nick)}`, {
    method: "PATCH",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ role: "moderator" }),
  });
  expect(r.status).toBeLessThan(300);
}

async function createComplaint(page: Page, title: string, lat: number, lng: number): Promise<void> {
  await page.click(".bottom-nav [data-go=create]");
  await page.click("[data-act=demophoto]");
  await page.click("[data-act=next]");
  await page.waitForFunction(() => (window as any).KGP.placeMap());
  await page.evaluate(([a, b]) => (window as any).KGP.placeMap().setView([a, b], 18), [lat, lng]);
  await expect(page.locator("[data-act=next]")).toBeEnabled({ timeout: 15_000 });
  await page.click("[data-act=next]");
  await page.click("[data-pickcat=light]");
  await page.click("[data-act=next]");
  await page.fill("#f-title", title);
  await page.click("[data-act=next]");
  await expect(page.locator("[data-act=next]")).toBeEnabled();
  await page.click("[data-act=next]");
  await expect(page.locator(".success")).toHaveCount(1, { timeout: 20_000 });
}

test("APK-independent shared base: create → moderate → realtime notification → visible to guests; offline draft", async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const author = await newUser(browser, `автор_${stamp}`);
  const title = `Не горит фонарь ${stamp}`;
  await createComplaint(author.page, title, 56.0101, 92.8701);
  const id = await author.page.evaluate(() => (window as any).KGP.S.draft.createdId as string);
  await expect(author.page.locator(".success h2")).toHaveText("Обращение отправлено на модерацию");

  // a guest does not see it yet
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await isolate(guest);
  await guest.addInitScript(() => localStorage.setItem("kgp.onboarded", "true"));
  await guest.goto(`./#/c/${id}`);
  await expect(guest.locator(".empty")).toContainText("не найдено");

  // moderator publishes from the web panel
  const mod = await newUser(browser, `модер_${stamp}`);
  await promote(`модер_${stamp}`);
  await mod.page.reload();
  await mod.page.goto(`./#/admin`);
  await mod.page.reload();
  await expect(mod.page.locator(".adm-body")).toContainText(title, { timeout: 15_000 });
  await mod.page.locator(".adm-row", { hasText: title }).locator("[data-mod=published]").click();

  // the author gets the notification through Realtime (toast + badge) without reloading
  await expect(author.page.locator(".toast")).toContainText("опубликовано на карте", { timeout: 20_000 });
  await expect(author.page.locator(".bottom-nav .nav-badge")).toBeVisible();

  // now the guest sees it, with history and the photo
  await guest.reload();
  await expect(guest.locator(".detail-head h2")).toHaveText(title, { timeout: 15_000 });
  await expect(guest.locator(".timeline li")).toHaveCount(2);
  await expect(guest.locator(".hero img")).toHaveCount(1);

  // offline: the complaint becomes a draft and is sent automatically when the network is back
  await author.page.click("[data-go=map]");
  await author.page.context().setOffline(true);
  const offTitle = `Офлайн черновик ${stamp}`;
  await createComplaint(author.page, offTitle, 56.0201, 92.8601).catch(() => undefined);
  await expect(author.page.locator(".success h2")).toHaveText("Черновик сохранён на устройстве");
  await author.page.context().setOffline(false);
  await author.page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(author.page.locator(".toast")).toContainText(`Черновик «${offTitle}» отправлен`, { timeout: 30_000 });

  expect([...author.errs, ...mod.errs].filter((e) => !/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/.test(e))).toEqual([]);
});
