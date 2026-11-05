import { distM, type LatLng } from "./format";
import type { Complaint, Filter, User } from "./types";

/**
 * Category suggestion from the title/description (word stems). Used as a hint on the description step:
 * "Похоже на «Снег и наледь» — выбрать?". Returns null when nothing matches clearly.
 */
const STEMS: [string, string[]][] = [
  ["ice", ["сосул", "кровл", "крыш", "наледь на крыш", "снег с крыш", "свес"]],
  ["snow", ["снег", "сугроб", "наледь", "гололёд", "гололед", "скольз", "лёд", "лед ", "не чищ", "неубран", "не убран", "уборк снег"]],
  ["light", ["фонар", "освещ", "свет", "лампа", "темно", "не горит", "не горят"]],
  ["trash", ["мусор", "свалк", "контейнер", "отход", "бак", "грязь", "покрышк", "хлам"]],
  ["road", ["яма", "ямы", "асфальт", "дорог", "колея", "выбоин", "бордюр", "тротуар разруш", "провал"]],
  ["transit", ["остановк", "автобус", "трамва", "троллейбус", "маршрут", "павильон"]],
  ["yard", ["двор", "детск", "площадк", "люк", "подъезд", "ограждени", "забор", "парковк во двор"]],
  ["green", ["дерев", "скамей", "лавочк", "газон", "клумб", "парк", "сквер", "кустарн", "аллея"]],
];

export function suggestCategory(text: string): string | null {
  const t = " " + text.toLowerCase().replace(/ё/g, "е") + " ";
  let best: string | null = null;
  let bestScore = 0;
  for (const [cat, stems] of STEMS) {
    const score = stems.reduce((a, s) => a + (t.includes(s.replace(/ё/g, "е")) ? s.length : 0), 0);
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return bestScore >= 3 ? best : null;
}

/** List order: newest, nearest to the user, or most supported. */
export function sortComplaints(list: Complaint[], sort: Filter["sort"], origin: LatLng | null): Complaint[] {
  const out = list.slice();
  if (sort === "near" && origin) out.sort((a, b) => distM(a, origin) - distM(b, origin));
  else if (sort === "popular") out.sort((a, b) => b.supports - a.supports || b.createdAt - a.createdAt);
  else out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} м`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace(".", ",")} км`;
}

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  desc: string;
  progress: number;
  goal: number;
  done: boolean;
}

/** Resident achievements (gamification from the TZ "directions of development"), computed on the client. */
export function achievements(u: User, all: Complaint[]): Achievement[] {
  const mine = all.filter((c) => c.mine);
  const winter = mine.filter((c) => c.category === "snow" || c.category === "ice").length;
  const resolvedTouched = all.filter((c) => c.status === "resolved" && (c.mine || c.supportedByMe)).length;
  const districts = new Set(mine.map((c) => c.district).filter(Boolean)).size;
  const a = (id: string, icon: string, title: string, desc: string, progress: number, goal: number): Achievement => ({
    id, icon, title, desc, progress: Math.min(progress, goal), goal, done: progress >= goal,
  });
  return [
    a("first", "flag", "Первый шаг", "Отправить первое обращение", Math.max(u.stats.complaints, mine.length), 1),
    a("active", "verified", "Активный житель", "5 обращений о проблемах города", Math.max(u.stats.complaints, mine.length), 5),
    a("neighbour", "groups", "Добрый сосед", "Поддержать 10 обращений других жителей", u.stats.supported, 10),
    a("checker", "task_alt", "Контролёр", "Подтвердить решение 3 проблем", u.stats.confirmed, 3),
    a("result", "check_circle", "Есть результат", "Дождаться решения проблемы, которую вы создали или поддержали", resolvedTouched, 1),
    a("winter", "ac_unit", "Зимний патруль", "Сообщить о 3 случаях снега, наледи или сосулек", winter, 3),
    a("voice", "forum", "Голос района", "Оставить 5 комментариев в обсуждениях", u.stats.comments, 5),
    a("explorer", "location_city", "Знаток города", "Обращения в 2 разных районах", districts, 2),
  ];
}

/** Nearest open complaint for a point ("рядом с вами"), for hints and notifications. */
export function nearest(list: Complaint[], p: LatLng): { c: Complaint; d: number } | null {
  let best: { c: Complaint; d: number } | null = null;
  for (const c of list) {
    const d = distM(c, p);
    if (!best || d < best.d) best = { c, d };
  }
  return best;
}
