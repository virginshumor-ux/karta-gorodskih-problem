import { beforeEach, describe, expect, it } from "vitest";
import {
  buy,
  checkIn,
  claimDaily,
  claimStory,
  dailyQuests,
  eggForText,
  equip,
  game,
  GAME_DAILY_CAP,
  gameReward,
  konamiMatch,
  levelOf,
  questStatus,
  resetGame,
  track,
  unlockEgg,
  xpOf,
} from "../../src/game/game";
import type { Complaint, User } from "../../src/domain/types";

const DAY = "2026-11-19";

const user = (comments = 0): User => ({
  id: "u", nick: "житель", role: "user", provider: "demo", notifyEnabled: true, isBlocked: false, home: null,
  stats: { complaints: 0, solved: 0, supported: 0, confirmed: 0, comments },
});
const c = (p: Partial<Complaint>): Complaint => ({
  id: "x", demo: false, title: "Яма", category: "road", description: "", lat: 56, lng: 92.8, address: "", district: "", status: "published",
  duplicateOf: null, createdAt: 0, updatedAt: 0, photos: [], author: "", mine: false, supports: 0, supportedByMe: false, confirms: 0,
  confirmedByMe: false, history: [], comments: 0, ...p,
});

beforeEach(() => resetGame());

describe("levels and XP", () => {
  it("level thresholds and titles", () => {
    expect(levelOf(0)).toMatchObject({ level: 1, title: "Нуб района", pct: 0 });
    expect(levelOf(99).level).toBe(1);
    expect(levelOf(100)).toMatchObject({ level: 2, title: "Глазастый" });
    expect(levelOf(175).pct).toBe(50);
    expect(levelOf(99_999)).toMatchObject({ level: 10, next: null, pct: 100 });
  });
  it("civic XP comes from the feed; guests only have bonus XP", () => {
    const list = [c({ id: "1", mine: true, status: "resolved" }), c({ id: "2", supportedByMe: true }), c({ id: "3", confirmedByMe: true })];
    expect(xpOf(user(2), list)).toBe(60 + 150 + 15 + 40 + 20);
    game().bonusXp = 5;
    expect(xpOf(null, list)).toBe(5);
  });
});

describe("daily quests", () => {
  it("three quests, the same for the same day", () => {
    expect(dailyQuests(DAY)).toHaveLength(3);
    expect(dailyQuests(DAY).map((q) => q.id)).toEqual(dailyQuests(DAY).map((q) => q.id));
    expect(new Set(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((d) => dailyQuests(d).map((q) => q.id).join())).size).toBeGreaterThan(1);
  });
  it("progress → ready → claimed once, rewards coins and XP", () => {
    const q = dailyQuests(DAY)[0]!;
    expect(questStatus(q, DAY)).toBe("todo");
    const done = track(q.event, q.goal, DAY);
    expect(done.map((x) => x.id)).toContain(q.id);
    expect(questStatus(q, DAY)).toBe("ready");
    expect(claimDaily(q.id, DAY)?.id).toBe(q.id);
    expect(game().coins).toBe(q.coins);
    expect(questStatus(q, DAY)).toBe("claimed");
    expect(claimDaily(q.id, DAY)).toBeNull();
    expect(track(q.event, 5, DAY)).toEqual([]);
  });
  it("counters reset on a new day", () => {
    const q = dailyQuests(DAY)[0]!;
    track(q.event, q.goal, DAY);
    expect(questStatus(q, "2026-11-20")).not.toBe("ready");
  });
  it("story quests pay once and only when done", () => {
    expect(claimStory("first", false)).toBe(false);
    expect(claimStory("first", true)).toBe(true);
    expect(claimStory("first", true)).toBe(false);
    expect(game().coins).toBe(40);
  });
});

describe("streak", () => {
  it("grows on consecutive days, restarts after a gap, pays up to 35", () => {
    expect(checkIn("2026-11-01")).toEqual({ days: 1, coins: 5 });
    expect(checkIn("2026-11-01")).toBeNull();
    expect(checkIn("2026-11-02")).toEqual({ days: 2, coins: 10 });
    for (let d = 3; d <= 9; d++) checkIn(`2026-11-0${d}`);
    expect(game().streak.days).toBe(9);
    expect(checkIn("2026-11-10")).toEqual({ days: 10, coins: 35 });
    expect(checkIn("2026-11-15")).toEqual({ days: 1, coins: 5 });
  });
});

describe("mini-game rewards", () => {
  it("score → coins with a daily cap per game; best score kept", () => {
    expect(gameReward("yamoboy", 20, DAY)).toEqual({ coins: 10, best: true, capped: false });
    expect(gameReward("yamoboy", 100, DAY)).toEqual({ coins: GAME_DAILY_CAP - 10, best: true, capped: true });
    expect(gameReward("yamoboy", 10, DAY)).toEqual({ coins: 0, best: false, capped: true });
    expect(game().best.yamoboy).toBe(100);
    expect(gameReward("yamoboy", 4, "2026-11-20").coins).toBe(2);
  });
});

describe("shop", () => {
  it("buy needs coins, egg items cannot be bought, equip needs ownership", () => {
    expect(buy("skin-neon")).toBe("poor");
    game().coins = 200;
    expect(equip("skin-neon")).toBe(false);
    expect(buy("skin-neon")).toBe("ok");
    expect(game().coins).toBe(50);
    expect(buy("skin-neon")).toBe("owned");
    expect(equip("skin-neon")).toBe(true);
    expect(game().equipped.skin).toBe("neon");
    expect(buy("title-dynasty")).toBe("locked");
  });
});

describe("easter eggs", () => {
  it("secret words in search boxes match exactly, the keyboard buffer by suffix", () => {
    expect(eggForText("ДИНАСТИЯЯЯЯ")).toBe("dynasty");
    expect(eggForText("  Династия! ", true)).toBe("dynasty");
    expect(eggForText("67", true)).toBe("sixseven");
    expect(eggForText("Киренского 67", true)).toBeNull();
    expect(eggForText("абвгсибирь")).toBe("siberia");
    expect(eggForText("Енисей", true)).toBe("yenisei");
    expect(eggForText("яма у подъезда", true)).toBeNull();
  });
  it("the Konami code, also on the Russian layout", () => {
    const seq = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright"];
    expect(konamiMatch([...seq, "b", "a"])).toBe(true);
    expect(konamiMatch(["x", ...seq, "и", "ф"])).toBe(true);
    expect(konamiMatch([...seq, "a", "b"])).toBe(false);
  });
  it("an egg pays once and unlocks its item", () => {
    expect(unlockEgg("dynasty")?.coins).toBe(77);
    expect(unlockEgg("dynasty")).toBeNull();
    expect(game().owned).toContain("title-dynasty");
    expect(equip("title-dynasty")).toBe(true);
    expect(game().equipped.title).toBe("Династия 👑");
  });
});
