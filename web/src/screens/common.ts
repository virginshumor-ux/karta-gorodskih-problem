import { STATUSES } from "../domain/constants";
import { esc, fmtDate, ico } from "../domain/format";
import type { Complaint } from "../domain/types";
import { cat, S } from "../state/store";

export function topbar(title: string, { backBtn = true, right = "" } = {}): string {
  return `<header class="topbar">${backBtn ? `<button class="icon-btn" data-act="back" aria-label="Назад">${ico("arrow_back")}</button>` : ""}<h1>${title}</h1>${right}</header>`;
}

export const statusChip = (s: Complaint["status"], extra = ""): string =>
  `<span class="status st-${s}" ${extra}>${STATUSES[s].name}</span>`;

/** Photos shown publicly: all "before" photos plus approved "after" photos. */
export function galleryPhotos(c: Complaint): Complaint["photos"] {
  return c.photos.filter((p) => p.kind === "before" || p.approved || c.mine);
}

export function illuHtml(c: Complaint): string {
  const k = cat(c.category);
  return `<div class="illu" style="background:linear-gradient(135deg, ${k.color}, ${k.color}cc 60%, #00000055)" role="img" aria-label="Иллюстрация категории ${esc(k.name)}">${ico(k.icon, "fill")}</div>`;
}

export function photoHtml(c: Complaint, i = 0): string {
  const p = galleryPhotos(c)[i];
  if (p?.url) return `<img src="${esc(p.url)}" alt="Фото проблемы: ${esc(c.title)}" loading="lazy" data-fallback="${esc(c.id)}">${illuHtml(c).replace('class="illu"', 'class="illu fallback"')}`;
  return illuHtml(c);
}

export function itemHtml(c: Complaint): string {
  const k = cat(c.category);
  return `<button class="c-item" data-open="${esc(c.id)}">
    <div class="thumb">${photoHtml(c)}</div>
    <div class="c-body">
      <span class="row wrap" style="gap:6px">${statusChip(c.status, 'style="align-self:flex-start"')}${c.demo ? `<span class="demo-tag">${ico("science")}пример</span>` : ""}</span>
      <span class="c-title">${esc(c.title)}</span>
      <span class="c-meta"><span>${ico(k.icon)} ${esc(k.name)}</span><span>${ico("thumb_up")} <span class="num">${c.supports}</span></span></span>
      <span class="c-meta"><span>${ico("place")} ${esc(c.address)}</span><span>${fmtDate(c.createdAt)}</span></span>
    </div>
  </button>`;
}

const NAV: [string, string, string][] = [
  ["map", "map", "Карта"],
  ["list", "format_list_bulleted", "Список"],
  ["create", "add", ""],
  ["notif", "notifications", "Уведомления"],
  ["profile", "person", "Профиль"],
];

export function navHtml(rail: boolean): string {
  const unread = S.notifications.filter((n) => !n.read).length;
  const cur =
    S.view === "detail" || S.view === "appeal"
      ? (S.prev[S.prev.length - 1] ?? "map")
      : ["stats", "weather", "about", "privacy", "admin"].includes(S.view)
        ? "profile"
        : S.view;
  const curN = rail && cur === "map" ? "list" : cur;
  return NAV.filter(([v]) => !(rail && v === "map"))
    .map(([v, i, t]) =>
      v === "create"
        ? `<button class="nav-fab" data-go="create" aria-label="Сообщить о проблеме" title="Сообщить о проблеме">${ico("add_a_photo")}</button>`
        : `<button class="nav-item" data-go="${v}" ${curN === v ? 'aria-current="page"' : ""}><span class="pill">${ico(i)}</span>${rail && v === "list" ? "Обращения" : t}${v === "notif" && unread ? `<span class="nav-badge num" aria-label="${unread} непрочитанных">${unread}</span>` : ""}</button>`,
    )
    .join("");
}

/** Banner on top of a screen when data comes from the device cache. */
export function offlineBanner(): string {
  if (!S.offlineSince && S.backend?.mode !== "local") return "";
  if (S.backend?.mode === "local")
    return `<div class="mode-banner">${ico("science")}<span>Автономный демо-режим: сервер не подключён, данные хранятся только на этом устройстве.</span></div>`;
  return `<div class="mode-banner warn" role="status">${ico("cloud_off")}<span>Нет связи с сервером — показаны сохранённые данные на ${fmtDate(S.offlineSince as number)}.${S.pendingDrafts ? ` Черновиков к отправке: ${S.pendingDrafts}.` : ""}</span></div>`;
}
