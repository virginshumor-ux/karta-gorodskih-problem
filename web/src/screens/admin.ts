import { DISTRICTS, STATUSES } from "../domain/constants";
import { esc, fmtDate, ico } from "../domain/format";
import type { AdminUser, Report, Stats, Status } from "../domain/types";
import { cat, isAdmin, isModerator, S, user } from "../state/store";
import { photoHtml, statusChip } from "./common";

export type AdminTab = "queue" | "all" | "after" | "reports" | "users" | "dicts" | "analytics";

export const admin = {
  tab: "queue" as AdminTab,
  statusFilter: "" as "" | Status,
  search: "",
  reports: null as Report[] | null,
  users: null as AdminUser[] | null,
  userSearch: "",
  stats: null as Stats | null,
  busy: false,
};

const TABS: [AdminTab, string, string][] = [
  ["queue", "pending_actions", "Очередь"],
  ["all", "list_alt", "Обращения"],
  ["after", "add_photo_alternate", "Фото «после»"],
  ["reports", "flag", "Жалобы"],
  ["users", "group", "Пользователи"],
  ["dicts", "category", "Справочники"],
  ["analytics", "monitoring", "Аналитика"],
];

function row(cId: string, extra = ""): string {
  const c = S.complaints.find((x) => x.id === cId);
  if (!c) return "";
  const k = cat(c.category);
  return `<div class="adm-row">
    <div class="thumb">${photoHtml(c)}</div>
    <div class="grow stack" style="gap:4px;min-width:0">
      <div class="row wrap">${statusChip(c.status)}<span class="small muted">${ico(k.icon)} ${esc(k.name)}</span>${c.demo ? `<span class="demo-tag">${ico("science")}пример</span>` : ""}</div>
      <b>${esc(c.title)}</b>
      <span class="small muted">${esc(c.address)}${c.district ? " · " + esc(c.district) : ""} · ${fmtDate(c.createdAt)} · ${esc(c.author)} · ${ico("thumb_up")} ${c.supports}</span>
      ${c.description ? `<span class="small">${esc(c.description)}</span>` : ""}
      <div class="row wrap" style="margin-top:4px">${extra}<button class="btn text" data-open-admin="${esc(c.id)}">${ico("open_in_new")}Карточка</button></div>
    </div>
  </div>`;
}

function queueTab(): string {
  const q = S.complaints.filter((c) => c.status === "moderation").sort((a, b) => a.createdAt - b.createdAt);
  if (!q.length) return `<div class="empty">${ico("task_alt")}<p>Очередь модерации пуста.</p></div>`;
  return `<p class="small muted">${q.length} на проверке · сначала старые. Проверьте фото: без лиц и номеров машин (ст. 152.1 ГК РФ).</p>` +
    q.map((c) => row(c.id, `<button class="btn primary" data-mod="published" data-id="${esc(c.id)}">${ico("check")}Опубликовать</button><button class="btn outline" data-act="reject" data-id="${esc(c.id)}">${ico("block")}Отклонить</button><button class="btn outline" data-act="dupof" data-id="${esc(c.id)}">${ico("call_merge")}Дубликат…</button>`)).join("");
}

function allTab(): string {
  const q = admin.search.trim().toLowerCase();
  const list = S.complaints
    .filter((c) => (!admin.statusFilter || c.status === admin.statusFilter) && (!q || (c.title + " " + c.address).toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 200);
  return `<div class="row wrap" style="margin-bottom:12px">
      <input class="input grow" id="adm-search" type="search" placeholder="Поиск по заголовку или адресу" value="${esc(admin.search)}" aria-label="Поиск" style="min-width:200px">
      <label class="select-wrap">${ico("filter_list")}<select id="adm-status" aria-label="Статус"><option value="">Все статусы</option>${(Object.keys(STATUSES) as Status[]).map((s) => `<option value="${s}" ${admin.statusFilter === s ? "selected" : ""}>${STATUSES[s].name}</option>`).join("")}</select></label>
    </div>` +
    (list.length
      ? list
          .map((c) =>
            row(
              c.id,
              `<label class="select-wrap">${ico("swap_horiz")}<select data-setstatus="${esc(c.id)}" aria-label="Сменить статус"><option value="">Сменить статус…</option>${(["published", "sent", "work", "resolved_wait", "resolved", "rejected"] as Status[]).filter((s) => s !== c.status).map((s) => `<option value="${s}">${STATUSES[s].name}</option>`).join("")}</select></label>`,
            ),
          )
          .join("")
      : `<div class="empty">${ico("search_off")}<p>Ничего не найдено.</p></div>`);
}

function afterTab(): string {
  const list = S.complaints.filter((c) => c.photos.some((p) => p.kind === "after" && !p.approved));
  if (!list.length) return `<div class="empty">${ico("task_alt")}<p>Нет фото «после», ожидающих проверки.</p><p class="small">Фото «после» видны здесь, когда сервер выдаёт их модератору.</p></div>`;
  return list
    .map((c) =>
      c.photos
        .filter((p) => p.kind === "after" && !p.approved)
        .map((p) => `<div class="adm-row"><div class="thumb" style="width:120px;height:120px">${p.url ? `<img src="${esc(p.url)}" alt="Фото «после»">` : ico("image")}</div><div class="grow stack" style="gap:6px"><b>${esc(c.title)}</b><span class="small muted">${esc(c.address)} · ${statusChip(c.status)}</span><div class="row wrap"><button class="btn primary" data-act="approveafter" data-photo-id="${esc(p.id)}">${ico("check")}Одобрить — решено</button><button class="btn outline" data-act="rejectafter" data-photo-id="${esc(p.id)}">Отклонить</button><button class="btn text" data-open-admin="${esc(c.id)}">Карточка</button></div></div></div>`)
        .join(""),
    )
    .join("");
}

function reportsTab(): string {
  if (!admin.reports) return `<div class="empty" role="status">${ico("hourglass_top")}<p>Загружаем жалобы…</p></div>`;
  if (!admin.reports.length) return `<div class="empty">${ico("verified")}<p>Жалоб нет.</p></div>`;
  return admin.reports
    .map(
      (r) => `<div class="adm-row"><div class="grow stack" style="gap:4px">
      <div class="row wrap">${statusChip(r.complaintStatus)}<span class="small muted">${fmtDate(r.at)} · от ${esc(r.reporter)}</span></div>
      <b>${esc(r.complaintTitle)}</b><span class="small">Причина: ${esc(r.reason)}</span>
      ${r.resolution ? `<span class="small muted">Решение: ${esc(r.resolution)}</span>` : `<div class="row wrap"><button class="btn outline" data-act="reportkeep" data-id="${esc(r.id)}">Нарушений нет</button><button class="btn primary" data-act="reporthide" data-id="${esc(r.id)}">${ico("visibility_off")}Скрыть обращение</button><button class="btn text" data-open-admin="${esc(r.complaintId)}">Карточка</button></div>`}
    </div></div>`,
    )
    .join("");
}

function usersTab(): string {
  const adm = isAdmin();
  return `<div class="row" style="margin-bottom:12px"><input class="input grow" id="adm-users" type="search" placeholder="Поиск по никнейму" value="${esc(admin.userSearch)}" aria-label="Поиск пользователей"><button class="btn tonal" data-act="adm-users-search">${ico("search")}Найти</button></div>
    ${!adm ? `<p class="small muted">Блокировать пользователей и назначать роли может администратор (роль admin).</p>` : ""}
    ${
      !admin.users
        ? `<div class="empty" role="status">${ico("hourglass_top")}<p>Загружаем…</p></div>`
        : admin.users.length
          ? `<div class="table-wrap"><table class="adm-table"><thead><tr><th>Никнейм</th><th>Вход</th><th>Роль</th><th>Обращений</th><th>Жалоб на него</th><th>С</th><th></th></tr></thead><tbody>${admin.users
              .map(
                (u) => `<tr class="${u.isBlocked ? "blocked" : ""}"><td><b>${esc(u.nick)}</b>${u.isBlocked ? ` <span class="status st-rejected">заблокирован</span>` : ""}</td><td>${{ yandex: "Яндекс ID", vk: "VK ID", demo: "демо" }[u.provider]}</td>
                <td>${adm && u.id !== user()?.id ? `<select data-setrole="${esc(u.id)}" aria-label="Роль ${esc(u.nick)}">${(["user", "moderator", "admin"] as const).map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>` : u.role}</td>
                <td class="num">${u.complaints}</td><td class="num">${u.reportsAgainst}</td><td>${new Date(u.createdAt).toLocaleDateString("ru-RU")}</td>
                <td>${adm && u.id !== user()?.id ? `<button class="btn ${u.isBlocked ? "tonal" : "outline"}" data-act="toggleblock" data-id="${esc(u.id)}" data-blocked="${u.isBlocked}">${u.isBlocked ? "Разблокировать" : "Заблокировать"}</button>` : ""}</td></tr>`,
              )
              .join("")}</tbody></table></div>`
          : `<div class="empty">${ico("person_search")}<p>Никого не нашли.</p></div>`
    }`;
}

function dictsTab(): string {
  const adm = isAdmin();
  return `<p class="small muted">Категории и ответственные организации (Ф-19). ${adm ? "Изменения сразу видны всем пользователям." : "Редактировать может администратор."}</p>
    <div class="table-wrap"><table class="adm-table"><thead><tr><th>Код</th><th>Название</th><th>Иконка</th><th>Цвет</th><th>Ответственная организация</th><th></th></tr></thead><tbody>
    ${S.cats
      .map(
        (c) => `<tr data-catrow="${c.id}"><td><code>${c.id}</code></td><td><input class="input" data-f="name" value="${esc(c.name)}" ${adm ? "" : "disabled"} aria-label="Название"></td><td><span class="row">${ico(c.icon)}<input class="input" data-f="icon" value="${esc(c.icon)}" ${adm ? "" : "disabled"} aria-label="Иконка" style="width:140px"></span></td><td><input type="color" data-f="color" value="${c.color}" ${adm ? "" : "disabled"} aria-label="Цвет"></td><td><input class="input" data-f="org" value="${esc(c.org)}" ${adm ? "" : "disabled"} aria-label="Организация"></td><td>${adm ? `<button class="btn tonal" data-act="savecat" data-id="${c.id}">Сохранить</button>` : ""}</td></tr>`,
      )
      .join("")}
    ${adm ? `<tr data-catrow="__new"><td><input class="input" data-f="id" placeholder="code" aria-label="Код" style="width:90px"></td><td><input class="input" data-f="name" placeholder="Новая категория" aria-label="Название"></td><td><input class="input" data-f="icon" value="more_horiz" aria-label="Иконка" style="width:140px"></td><td><input type="color" data-f="color" value="#6a6f73" aria-label="Цвет"></td><td><input class="input" data-f="org" placeholder="Организация" aria-label="Организация"></td><td><button class="btn primary" data-act="savecat" data-id="__new">Добавить</button></td></tr>` : ""}
    </tbody></table></div>
    <div class="section-title" style="margin-left:0">Районы</div>
    <p class="small">${DISTRICTS.map(esc).join(" · ")}</p>
    <p class="small muted">Границы районов не загружены: район обращения берётся из геокодера. Когда в таблицу districts добавят полигоны, сервер будет определять район сам.</p>`;
}

function analyticsTab(): string {
  const st = admin.stats;
  if (!st) return `<div class="empty" role="status">${ico("hourglass_top")}<p>Считаем…</p></div>`;
  const pct = Math.round((st.resolved / Math.max(1, st.total)) * 100);
  return `<div class="kpis" style="padding:0"><div class="stat"><b class="num">${st.total}</b><span>обращений</span></div><div class="stat"><b class="num">${st.open}</b><span>ждут решения</span></div><div class="stat"><b class="num">${pct}%</b><span>решено</span></div><div class="stat"><b class="num">${st.medianModerationHours ?? "—"}</b><span>ч — медиана до модерации</span></div><div class="stat"><b class="num">${st.medianResolutionDays ?? "—"}</b><span>дн — медиана до решения</span></div><div class="stat"><b class="num">${st.supports}</b><span>поддержек</span></div></div>
    <div class="section-title" style="margin-left:0">По районам</div>
    <div class="table-wrap"><table class="adm-table"><tbody>${st.byDistrict.map((d) => `<tr><td>${esc(d.district)}</td><td class="num">${d.n}</td></tr>`).join("")}</tbody></table></div>
    <div class="section-title" style="margin-left:0">Тепловая карта</div>
    <div class="adm-heat" id="adm-heat" role="img" aria-label="Тепловая карта обращений"></div>
    <div class="row wrap" style="margin-top:16px"><button class="btn primary" data-act="exportcsv">${ico("download")}Выгрузить CSV (обезличенно)</button><span class="small muted">UTF-8, разделитель «;» (Ф-22). Для Yandex DataLens подключите представления analytics_* в PostgreSQL.</span></div>`;
}

export function adminHtml(): string {
  if (!isModerator())
    return `<div class="admin"><header class="adm-head"><button class="icon-btn" data-act="adminclose" aria-label="Закрыть">${ico("close")}</button><h1>Панель модератора</h1></header>
      <div class="empty">${ico("admin_panel_settings")}<p>Раздел доступен модераторам и администраторам.${S.backend?.mode === "local" ? " В демо-режиме включите «Режим модератора» в профиле." : " Роль выдаётся в базе (см. README)."}</p>${user() ? "" : `<button class="btn primary" data-act="login">Войти</button>`}</div></div>`;
  const counts: Partial<Record<AdminTab, number>> = {
    queue: S.complaints.filter((c) => c.status === "moderation").length,
    after: S.complaints.filter((c) => c.photos.some((p) => p.kind === "after" && !p.approved)).length,
    reports: admin.reports?.filter((r) => !r.resolution).length ?? 0,
  };
  const body = { queue: queueTab, all: allTab, after: afterTab, reports: reportsTab, users: usersTab, dicts: dictsTab, analytics: analyticsTab }[admin.tab]();
  return `<div class="admin">
    <header class="adm-head"><button class="icon-btn" data-act="adminclose" aria-label="Закрыть панель">${ico("arrow_back")}</button><h1>Панель модератора</h1><span class="small muted">${esc(user()?.nick ?? "")} · ${user()?.role === "admin" ? "администратор" : "модератор"}${S.backend.mode === "local" ? " · демо-режим" : ""}</span><button class="icon-btn" data-act="adminrefresh" aria-label="Обновить">${ico("refresh")}</button></header>
    <nav class="adm-tabs" role="tablist">${TABS.map(([t, i, n]) => `<button role="tab" aria-selected="${admin.tab === t}" data-admtab="${t}">${ico(i)}${n}${counts[t] ? `<span class="nav-badge num" style="position:static">${counts[t]}</span>` : ""}</button>`).join("")}</nav>
    <main class="adm-body" role="tabpanel">${body}</main>
  </div>`;
}
