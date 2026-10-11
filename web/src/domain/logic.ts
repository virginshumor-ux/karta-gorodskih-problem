import { DAY, OPEN_STATUSES } from "./constants";
import { plural } from "./format";
import type { Category, Complaint, Filter } from "./types";

/**
 * Text of the official appeal for pos.gosuslugi.ru — the prototype text plus, when known,
 * a link to the public complaint page with photos (Ф-10 asks for a photo link).
 */
export function appealText(c: Complaint, cat: Category, pageUrl = ""): string {
  const n = c.supports + 1;
  return (
    `Прошу принять меры по проблеме «${c.title}».\n\n` +
    `Категория: ${cat.name}.\n` +
    `Адрес: г. Красноярск, ${c.address} (${c.district || "район не определён"}).\n` +
    `Координаты: ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}.\n` +
    `Дата обнаружения: ${new Date(c.createdAt).toLocaleDateString("ru-RU")}.\n\n` +
    `${c.description || ""}\n\n` +
    (pageUrl ? `Фото и подробности: ${pageUrl}\n\n` : "") +
    `Проблему подтвердили ${n} ${plural(n, "житель", "жителя", "жителей")} в приложении «Карта городских проблем».`
  );
}

export interface FilterContext {
  moderator: boolean;
  catName: (id: string) => string;
  now?: number;
}

/** Visible complaints for the map and the list, newest first. */
export function filterComplaints(all: Complaint[], f: Filter, search: string, ctx: FilterContext): Complaint[] {
  const q = search.trim().toLowerCase();
  const now = ctx.now ?? Date.now();
  const since = f.period === "all" ? 0 : now - Number(f.period) * DAY;
  return all
    .filter((c) => {
      if (c.status === "duplicate") return false;
      if (c.status === "moderation" && !c.mine && !ctx.moderator) return false;
      if (c.status === "rejected" && !c.mine) return false;
      if (f.cats.size && !f.cats.has(c.category)) return false;
      if (f.mine && !c.mine) return false;
      if (f.district && c.district !== f.district) return false;
      if (c.createdAt < since) return false;
      if (
        f.status === "open" &&
        !(OPEN_STATUSES.includes(c.status) || (c.status === "moderation" && (c.mine || ctx.moderator)))
      )
        return false;
      if (f.status === "resolved" && c.status !== "resolved") return false;
      if (q && !(c.title + " " + c.address + " " + c.description + " " + ctx.catName(c.category)).toLowerCase().includes(q))
        return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function emptyFilter(): Filter {
  return { cats: new Set(), status: "open", mine: false, district: "", period: "all" };
}

/** Rows for the anonymous CSV export (Ф-22): UTF-8, separator ";". */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0] as object);
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((k) => cell(r[k])).join(";"))].join("\r\n");
}
