// Game layer of the site: XP and levels, daily quests, the "шишки" currency, a cosmetic shop, mini-game rewards
// and easter eggs. Everything is cosmetic and stored on this device only: it never changes complaints, supports or
// moderation, so it cannot be farmed into real influence. XP from civic actions is derived from the feed itself.
import type { Complaint, User } from "../domain/types";
import { ls } from "../state/storage";

export type GameEvent =
  | "weather"
  | "support"
  | "detail"
  | "comment"
  | "game"
  | "heat"
  | "search"
  | "near"
  | "confirm"
  | "share"
  | "quiz5"
  | "create";

export interface GameState {
  coins: number;
  bonusXp: number;
  /** quest id → day it was claimed (daily) or "story" (one-off). */
  claimed: Record<string, string>;
  owned: string[];
  equipped: { skin: string; pins: string; frame: string; title: string; fx: string };
  eggs: string[];
  best: Record<string, number>;
  earned: { day: string; byGame: Record<string, number> };
  counters: { day: string; n: Partial<Record<GameEvent, number>> };
  streak: { last: string; days: number };
  /** Last level the user has seen celebrated (level-up stamp shows once). */
  level: number;
  sound: boolean;
}

const fresh = (): GameState => ({
  coins: 0,
  bonusXp: 0,
  claimed: {},
  owned: ["skin-classic", "pins-sticker", "frame-none", "fx-confetti"],
  equipped: { skin: "classic", pins: "sticker", frame: "none", title: "", fx: "confetti" },
  eggs: [],
  best: {},
  earned: { day: "", byGame: {} },
  counters: { day: "", n: {} },
  streak: { last: "", days: 0 },
  level: 1,
  sound: true,
});

let st: GameState = { ...fresh(), ...ls.get<Partial<GameState>>("game", {}) };
const listeners = new Set<() => void>();

export const game = (): GameState => st;
export function saveGame(): void {
  ls.set("game", st);
  listeners.forEach((f) => f());
}
export function onGameChange(f: () => void): void {
  listeners.add(f);
}
/** Tests and "reset": start over with a clean state. */
export function resetGame(s: Partial<GameState> = {}): void {
  st = { ...fresh(), ...s };
}

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- XP and levels ----------

export const XP_RULES = { complaint: 60, solved: 150, support: 15, confirm: 40, comment: 10 };

/** Civic XP comes from the feed (server truth), plus a small bonus from quests, games and eggs. */
export function xpOf(u: User | null, list: Complaint[], g: GameState = st): number {
  if (!u) return g.bonusXp;
  const mine = list.filter((c) => c.mine);
  const complaints = Math.max(u.stats.complaints, mine.length);
  const solved = mine.filter((c) => c.status === "resolved" || c.status === "resolved_wait").length;
  const supported = list.filter((c) => c.supportedByMe).length;
  const confirmed = list.filter((c) => c.confirmedByMe).length;
  return (
    complaints * XP_RULES.complaint + solved * XP_RULES.solved + supported * XP_RULES.support + confirmed * XP_RULES.confirm + u.stats.comments * XP_RULES.comment + g.bonusXp
  );
}

const LEVELS = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5600];
export const LEVEL_TITLES = [
  "Нуб района",
  "Глазастый",
  "Ямоискатель",
  "Двор-контроль",
  "Гроза ЖКХ",
  "Хранитель квартала",
  "Сибирский урбанист",
  "Легенда Красноярска",
  "Мэр в душе",
  "Босс города",
];

export interface LevelInfo {
  level: number;
  title: string;
  xp: number;
  floor: number;
  next: number | null;
  pct: number;
}

export function levelOf(xp: number): LevelInfo {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= (LEVELS[i + 1] as number)) i++;
  const floor = LEVELS[i] as number;
  const next = LEVELS[i + 1] ?? null;
  return { level: i + 1, title: LEVEL_TITLES[i] as string, xp, floor, next, pct: next == null ? 100 : Math.round(((xp - floor) / (next - floor)) * 100) };
}

// ---------- daily quests ----------

export interface Quest {
  id: string;
  icon: string;
  title: string;
  desc: string;
  event: GameEvent;
  goal: number;
  coins: number;
  xp: number;
}

export const DAILY_POOL: Quest[] = [
  { id: "d-weather", icon: "partly_cloudy_day", title: "Синоптик", desc: "Загляни в погоду и качество воздуха", event: "weather", goal: 1, coins: 10, xp: 10 },
  { id: "d-support", icon: "thumb_up", title: "Респект соседу", desc: "Поддержи чужое обращение «Я тоже видел»", event: "support", goal: 1, coins: 20, xp: 20 },
  { id: "d-detail", icon: "visibility", title: "Насмотренность", desc: "Открой 3 карточки обращений", event: "detail", goal: 3, coins: 15, xp: 15 },
  { id: "d-comment", icon: "forum", title: "Голос в чате", desc: "Оставь комментарий в обсуждении", event: "comment", goal: 1, coins: 20, xp: 20 },
  { id: "d-game", icon: "sports_esports", title: "Перекур", desc: "Сыграй в любую мини-игру", event: "game", goal: 1, coins: 10, xp: 10 },
  { id: "d-heat", icon: "local_fire_department", title: "Где горит?", desc: "Включи тепловую карту", event: "heat", goal: 1, coins: 10, xp: 10 },
  { id: "d-search", icon: "search", title: "Навигатор", desc: "Найди адрес через быстрый поиск", event: "search", goal: 1, coins: 10, xp: 10 },
  { id: "d-near", icon: "near_me", title: "Мой квартал", desc: "Отсортируй обращения «Рядом»", event: "near", goal: 1, coins: 10, xp: 10 },
  { id: "d-confirm", icon: "task_alt", title: "Контроль качества", desc: "Подтверди, решена ли проблема", event: "confirm", goal: 1, coins: 25, xp: 30 },
  { id: "d-share", icon: "share", title: "Раскачай тему", desc: "Поделись обращением", event: "share", goal: 1, coins: 15, xp: 15 },
  { id: "d-quiz", icon: "quiz", title: "Умник", desc: "Набери 5+ в квизе «Кто виноват?»", event: "quiz5", goal: 1, coins: 20, xp: 20 },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Three quests of the day — the same for everyone on the same date. */
export function dailyQuests(day = dayKey()): Quest[] {
  return DAILY_POOL.map((q) => ({ q, k: hash(day + q.id) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 3)
    .map((x) => x.q);
}

export function count(e: GameEvent, day = dayKey()): number {
  return st.counters.day === day ? (st.counters.n[e] ?? 0) : 0;
}

/** Records an action; returns the daily quests it has just completed (to show "Квест выполнен"). */
export function track(e: GameEvent, n = 1, day = dayKey()): Quest[] {
  if (st.counters.day !== day) st.counters = { day, n: {} };
  const before = count(e, day);
  st.counters.n[e] = before + n;
  saveGame();
  return dailyQuests(day).filter((q) => q.event === e && before < q.goal && before + n >= q.goal && st.claimed[q.id] !== day);
}

export type QuestStatus = "todo" | "ready" | "claimed";
export function questStatus(q: Quest, day = dayKey()): QuestStatus {
  if (st.claimed[q.id] === day) return "claimed";
  return count(q.event, day) >= q.goal ? "ready" : "todo";
}

export function claimDaily(id: string, day = dayKey()): Quest | null {
  const q = dailyQuests(day).find((x) => x.id === id);
  if (!q || questStatus(q, day) !== "ready") return null;
  st.claimed[q.id] = day;
  st.coins += q.coins;
  st.bonusXp += q.xp;
  saveGame();
  return q;
}

/** Story quests are the achievements: a one-off reward when one is done. */
export const STORY_REWARD = 40;
export function claimStory(achievementId: string, done: boolean): boolean {
  const key = "a-" + achievementId;
  if (!done || st.claimed[key]) return false;
  st.claimed[key] = "story";
  st.coins += STORY_REWARD;
  st.bonusXp += 25;
  saveGame();
  return true;
}

/** First visit of the day: the streak grows (or restarts) and pays min(days, 7) × 5 шишек. */
export function checkIn(day = dayKey()): { days: number; coins: number } | null {
  if (st.streak.last === day) return null;
  const y = new Date(day + "T12:00:00");
  y.setDate(y.getDate() - 1);
  const days = st.streak.last === dayKey(y) ? st.streak.days + 1 : 1;
  const coins = Math.min(days, 7) * 5;
  st.streak = { last: day, days };
  st.coins += coins;
  saveGame();
  return { days, coins };
}

// ---------- mini-games ----------

export const GAME_DAILY_CAP = 30;
const RATE: Record<string, number> = { yamoboy: 0.5, icicles: 0.2, plow: 1, quiz: 3 };

/** Coins for a finished round, capped per game and day; also stores the best score. */
export function gameReward(gameId: string, score: number, day = dayKey()): { coins: number; best: boolean; capped: boolean } {
  if (st.earned.day !== day) st.earned = { day, byGame: {} };
  const best = score > (st.best[gameId] ?? 0);
  if (best) st.best[gameId] = score;
  const already = st.earned.byGame[gameId] ?? 0;
  const raw = Math.floor(score * (RATE[gameId] ?? 0.5));
  const coins = Math.max(0, Math.min(raw, GAME_DAILY_CAP - already));
  st.earned.byGame[gameId] = already + coins;
  st.coins += coins;
  st.bonusXp += Math.floor(coins / 2);
  saveGame();
  return { coins, best, capped: raw > coins };
}

export const earnedToday = (gameId: string, day = dayKey()): number => (st.earned.day === day ? (st.earned.byGame[gameId] ?? 0) : 0);

// ---------- shop ----------

export type ItemKind = "skin" | "pins" | "frame" | "title" | "fx";
export interface ShopItem {
  id: string;
  kind: ItemKind;
  value: string;
  name: string;
  desc: string;
  price: number;
  icon: string;
  /** Only an easter egg unlocks it. */
  egg?: string;
}

export const SHOP: ShopItem[] = [
  { id: "skin-classic", kind: "skin", value: "classic", name: "Стикербук", desc: "Бумага, чернила, лайм", price: 0, icon: "palette" },
  { id: "skin-neon", kind: "skin", value: "neon", name: "Неон-ночь", desc: "Тёмная тема с неоном", price: 150, icon: "bolt" },
  { id: "skin-stolby", kind: "skin", value: "stolby", name: "Столбы", desc: "Мох, гранит и кедр", price: 120, icon: "forest" },
  { id: "skin-ice", kind: "skin", value: "ice", name: "Енисейский лёд", desc: "Холодная пастель", price: 120, icon: "ac_unit" },
  { id: "skin-pixel", kind: "skin", value: "pixel", name: "8 бит", desc: "Пиксельный режим из 80-х", price: 0, icon: "grid_view", egg: "konami" },
  { id: "pins-sticker", kind: "pins", value: "sticker", name: "Стикеры", desc: "Метки-наклейки", price: 0, icon: "location_on" },
  { id: "pins-emoji", kind: "pins", value: "emoji", name: "Эмодзи", desc: "🕳️ 💡 🗑️ ❄️ вместо значков", price: 80, icon: "auto_awesome" },
  { id: "pins-pixel", kind: "pins", value: "pixel", name: "Квадраты", desc: "Метки-блоки", price: 60, icon: "grid_view" },
  { id: "frame-none", kind: "frame", value: "none", name: "Без рамки", desc: "Классика", price: 0, icon: "account_circle" },
  { id: "frame-fire", kind: "frame", value: "fire", name: "Огонь", desc: "Рамка аватара", price: 60, icon: "whatshot" },
  { id: "frame-ice", kind: "frame", value: "ice", name: "Лёд", desc: "Рамка аватара", price: 60, icon: "ac_unit" },
  { id: "frame-rainbow", kind: "frame", value: "rainbow", name: "Вайб", desc: "Двойная цветная рамка", price: 120, icon: "auto_awesome" },
  { id: "frame-gold", kind: "frame", value: "gold", name: "Золото", desc: "Для легенд района", price: 250, icon: "diamond" },
  { id: "title-pit", kind: "title", value: "Ямный барон", name: "Ямный барон", desc: "Титул под ником", price: 50, icon: "military_tech" },
  { id: "title-icicle", kind: "title", value: "Повелитель сосулек", name: "Повелитель сосулек", desc: "Титул под ником", price: 50, icon: "military_tech" },
  { id: "title-vibe", kind: "title", value: "Сибирский вайб", name: "Сибирский вайб", desc: "Титул под ником", price: 70, icon: "military_tech" },
  { id: "title-cedar", kind: "title", value: "Кедровый король", name: "Кедровый король", desc: "Титул под ником", price: 90, icon: "military_tech" },
  { id: "title-bro", kind: "title", value: "Енисейский бро", name: "Енисейский бро", desc: "Титул под ником", price: 70, icon: "military_tech" },
  { id: "title-dynasty", kind: "title", value: "Династия 👑", name: "Династия 👑", desc: "Только для своих", price: 0, icon: "crown", egg: "dynasty" },
  { id: "fx-confetti", kind: "fx", value: "confetti", name: "Конфетти", desc: "Салют за успехи", price: 0, icon: "celebration" },
  { id: "fx-snow", kind: "fx", value: "snow", name: "Снегопад", desc: "Салют снежинками", price: 40, icon: "ac_unit" },
  { id: "fx-cones", kind: "fx", value: "cones", name: "Шишкопад", desc: "Салют кедровыми шишками", price: 60, icon: "forest" },
];

export const owns = (id: string): boolean => st.owned.includes(id);

export function buy(id: string): "ok" | "owned" | "poor" | "locked" | "unknown" {
  const it = SHOP.find((x) => x.id === id);
  if (!it) return "unknown";
  if (owns(id)) return "owned";
  if (it.egg) return "locked";
  if (st.coins < it.price) return "poor";
  st.coins -= it.price;
  st.owned.push(id);
  saveGame();
  return "ok";
}

export function equip(id: string): boolean {
  const it = SHOP.find((x) => x.id === id);
  if (!it || !owns(id)) return false;
  st.equipped = { ...st.equipped, [it.kind]: it.value };
  saveGame();
  return true;
}

// ---------- easter eggs ----------

export interface Egg {
  id: string;
  name: string;
  hint: string;
  coins: number;
  unlocks?: string;
}

export const EGGS: Egg[] = [
  { id: "dynasty", name: "ДИНАСТИЯЯЯ", hint: "Крикни, как стример в финале (наберите слово в поиске)", coins: 77, unlocks: "title-dynasty" },
  { id: "konami", name: "Код из 80-х", hint: "↑ ↑ ↓ ↓ … продолжение знают все геймеры", coins: 50, unlocks: "skin-pixel" },
  { id: "sixseven", name: "6-7", hint: "Число, которое повторяет каждый школьник", coins: 67 },
  { id: "logo", name: "Кликер", hint: "Уровень не любит, когда его тыкают 7 раз", coins: 7 },
  { id: "siberia", name: "Сибирь", hint: "Напиши, где мы живём", coins: 30 },
  { id: "yenisei", name: "Енисей", hint: "Великая река не замерзает", coins: 30 },
  { id: "night", name: "Ночной дозор", hint: "Зайди, когда все спят", coins: 20 },
];

/** Unlocks an egg once; returns it when it is new. */
export function unlockEgg(id: string): Egg | null {
  const e = EGGS.find((x) => x.id === id);
  if (!e || st.eggs.includes(id)) return null;
  st.eggs.push(id);
  st.coins += e.coins;
  st.bonusXp += 10;
  if (e.unlocks && !st.owned.includes(e.unlocks)) st.owned.push(e.unlocks);
  saveGame();
  return e;
}

const KONAMI = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
const WORDS: [string, string][] = [
  ["династия", "dynasty"],
  ["dynasty", "dynasty"],
  ["сибирь", "siberia"],
  ["енисей", "yenisei"],
  ["67", "sixseven"],
  ["6 7", "sixseven"],
];

/**
 * Typed text → egg id. `exact` for search boxes (the whole query is the word, so "Киренского 67" is just an address);
 * otherwise the keyboard buffer only has to end with the word.
 */
export function eggForText(text: string, exact = false): string | null {
  const t = text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  if (/^д+и+н+а+с+т+и+я+!*$/.test(t) || (!exact && /династия$/.test(t))) return "dynasty";
  for (const [w, id] of WORDS) if (t === w || (!exact && t.endsWith(w))) return id;
  return null;
}

/** Keys pressed outside inputs: the Konami code (also with Cyrillic И/Ф for B/A). */
export function konamiMatch(keys: string[]): boolean {
  const k = keys.slice(-KONAMI.length).map((x) => ({ и: "b", ф: "a" })[x] ?? x);
  return k.length === KONAMI.length && k.every((x, i) => x === KONAMI[i]);
}
