// v1.2 game layer on the standalone demo backend: quests, a mini-game, the shop and easter eggs. Phone viewport.
import { expect, test } from "@playwright/test";
import { dailyQuests, dayKey } from "../../src/game/game";
import { isolate, skipOnboarding, watchErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await isolate(page);
  await page.goto("./");
  await skipOnboarding(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).KGP.S.complaints.length)).toBeGreaterThan(10);
});

test("quests: level card, daily quests, streak reward", async ({ page }) => {
  const errs = watchErrors(page);
  await page.click(".bottom-nav [data-go=quests]");
  await expect(page.locator(".lvl-card")).toContainText("LVL");
  await expect(page.locator(".quest")).toHaveCount(3);
  await expect(page.locator(".game-tile")).toHaveCount(4);
  await expect(page.locator(".eggs .egg")).toHaveCount(7);
  // first visit of the day: the streak paid 5 шишек
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("kgp.game") as string).streak.days)).toBe(1);
  expect(errs).toEqual([]);
});

test("a quest completes from a real action and pays on claim", async ({ page }) => {
  // Pick a day whose quest set has "Синоптик" (the set is the same for everyone on a date) and freeze the clock on it.
  const day = new Date("2026-11-19T12:00:00");
  while (!dailyQuests(dayKey(day)).some((q) => q.id === "d-weather")) day.setDate(day.getDate() + 1);
  await page.clock.setFixedTime(day);
  await page.reload();
  await page.click(".weather-chip");
  await page.click("[data-act=back]");
  await page.click(".bottom-nav [data-go=quests]");
  const weather = page.locator(".quest", { hasText: "Синоптик" });
  await expect(weather.locator("[data-act=claim]")).toBeVisible();
  const before = Number(await page.locator("#coins").innerText());
  await weather.locator("[data-act=claim]").click();
  await expect(page.locator("#coins")).toHaveText(String(before + 10));
  await expect(page.locator(".quest.claimed", { hasText: "Синоптик" })).toHaveCount(1);
});

test("mini-game round pays шишки and keeps the record", async ({ page }) => {
  await page.click(".bottom-nav [data-go=quests]");
  await page.click("[data-act=play][data-id=quiz]");
  await page.click("[data-g=start]");
  for (let i = 0; i < 7; i++) {
    await page.locator('.quiz-opt[data-ok="true"]').click();
    await page.waitForTimeout(900);
  }
  await expect(page.locator(".game-score-big")).toHaveText("7");
  await expect(page.locator(".game-card")).toContainText("+21 🌰");
  await page.click("[data-g=exit]");
  await expect(page.locator("[data-act=play][data-id=quiz]")).toContainText("7");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("kgp.game") as string).best.quiz)).toBe(7);
});

test("ДИНАСТИЯ egg, the shop and a skin", async ({ page }) => {
  const errs = watchErrors(page);
  await page.click(".bottom-nav [data-go=list]");
  await page.fill("#search", "династияяя");
  await expect(page.locator(".fx-over.dynasty")).toBeVisible();
  await expect(page.locator(".dyn-word")).toContainText("ДИНАСТИ");
  await page.locator(".fx-over.dynasty").click();
  await page.click(".bottom-nav [data-go=quests]");
  await expect(page.locator(".egg.found")).toHaveCount(1);
  const dynasty = page.locator(".shop-item", { hasText: "Династия 👑" });
  await dynasty.locator("[data-act=equip]").click();
  await expect(dynasty).toContainText("надето");
  // 5 (streak) + 77 (egg) = 82 шишки: enough for the emoji pins
  const emoji = page.locator(".shop-item", { hasText: "Эмодзи" });
  await emoji.locator("[data-act=buy]").click();
  await expect(emoji).toContainText("надето");
  await page.click(".bottom-nav [data-go=map]");
  await expect(page.locator("#map .pin .emo").first()).toBeVisible();
  expect(errs).toEqual([]);
});

test("Konami code unlocks the 8-bit skin", async ({ page }) => {
  for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) await page.keyboard.press(k);
  await expect(page.locator(".toast")).toContainText("8 бит");
  await page.click(".bottom-nav [data-go=quests]");
  const px = page.locator(".shop-item", { hasText: "8 бит" });
  await px.locator("[data-act=equip]").click();
  expect(await page.evaluate(() => document.documentElement.dataset.skin)).toBe("pixel");
});
