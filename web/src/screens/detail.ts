import { complaintUrl } from "../config";
import { CONFIRM_NEED, OPEN_STATUSES, STATUSES } from "../domain/constants";
import { esc, fmtDate, ico, plural } from "../domain/format";
import { appealText } from "../domain/logic";
import type { Complaint } from "../domain/types";
import { cat, findComplaint, isModerator, S, user } from "../state/store";
import { galleryPhotos, illuHtml, offlineBanner, photoHtml, statusChip, topbar } from "./common";

function moderatorHtml(c: Complaint): string {
  if (!isModerator()) return "";
  const id = esc(c.id);
  const pendingAfter = c.photos.filter((p) => p.kind === "after" && !p.approved);
  const local = S.backend.mode === "local";
  return `
    <div class="section-title">Модерация${local ? " (демо-режим)" : ""}</div>
    <div class="pad row wrap">
      ${c.status === "moderation" ? `<button class="btn primary" data-mod="published" data-id="${id}">${ico("check")}Опубликовать</button><button class="btn outline" data-act="reject" data-id="${id}">${ico("block")}Отклонить</button><button class="btn outline" data-act="dupof" data-id="${id}">${ico("call_merge")}Дубликат…</button>` : ""}
      ${c.status === "published" ? `<button class="btn tonal" data-mod="sent" data-id="${id}">${ico("forward_to_inbox")}Передано в организацию</button>` : ""}
      ${["published", "sent"].includes(c.status) ? `<button class="btn tonal" data-mod="work" data-id="${id}">${ico("construction")}В работе</button>` : ""}
      ${["sent", "work", "published"].includes(c.status) ? `<button class="btn tonal" data-mod="resolved_wait" data-id="${id}">${ico("task_alt")}Отметить решённым</button>` : ""}
      ${c.status === "resolved_wait" ? `<button class="btn tonal" data-mod="resolved" data-id="${id}">${ico("verified")}Подтвердить решение</button>` : ""}
      ${["published", "sent", "work", "resolved_wait"].includes(c.status) ? `<button class="btn outline" data-act="dupof" data-id="${id}">${ico("call_merge")}Дубликат…</button><button class="btn outline" data-act="reject" data-id="${id}">${ico("visibility_off")}Скрыть</button>` : ""}
    </div>
    ${pendingAfter.map((p) => `<div class="pad row" style="margin-top:8px"><span class="small grow">Фото «после» ждёт проверки</span><button class="btn tonal" data-act="approveafter" data-photo-id="${esc(p.id)}">${ico("check")}Одобрить</button><button class="btn outline" data-act="rejectafter" data-photo-id="${esc(p.id)}">Отклонить</button></div>`).join("")}`;
}

export function viewDetail(): string {
  const c = findComplaint(S.detailId);
  if (!c)
    return `<div class="screen">${topbar("Обращение")}${S.loading ? `<div class="empty" role="status">${ico("hourglass_top")}<p>Загружаем обращение…</p></div>` : `<div class="empty">${ico("help")}<p>Обращение не найдено или ещё не опубликовано.</p><button class="btn tonal" data-go="map">На карту</button></div>`}</div>`;
  const k = cat(c.category);
  const photos = galleryPhotos(c);
  const nPh = Math.max(1, photos.length);
  const idx = Math.min(S.detailPhoto, nPh - 1);
  const open = OPEN_STATUSES.includes(c.status);
  const canConfirm = open && !c.confirmedByMe;
  const after = c.photos.filter((p) => p.kind === "after");
  const cur = photos[idx];
  return `<div class="screen">
    <div class="hero">
      ${photoHtml(c, idx)}
      <div class="hero-top"><button class="icon-btn" data-act="back" aria-label="Назад">${ico("arrow_back")}</button><button class="icon-btn" data-act="share" data-id="${esc(c.id)}" aria-label="Поделиться">${ico("share")}</button></div>
      ${photos.length ? (cur?.kind === "after" ? `<span class="hero-label">Фото «после»${cur.approved ? "" : " — ждёт проверки модератором"}</span>` : "") : `<span class="hero-label">Иллюстрация категории — фото не приложено${c.demo ? " (демо-данные)" : ""}</span>`}
      ${nPh > 1 ? `<button class="icon-btn hero-nav prev" data-photo="${(idx - 1 + nPh) % nPh}" aria-label="Предыдущее фото">${ico("chevron_left")}</button><button class="icon-btn hero-nav next" data-photo="${(idx + 1) % nPh}" aria-label="Следующее фото">${ico("chevron_right")}</button><div class="hero-dots">${Array.from({ length: nPh }, (_, i) => `<i class="${i === idx ? "on" : ""}" data-photo="${i}" role="button" aria-label="Фото ${i + 1} из ${nPh}"></i>`).join("")}</div>` : ""}
    </div>
    ${offlineBanner()}
    <div class="detail-head">
      <div class="row wrap">${statusChip(c.status)}${c.demo ? `<span class="demo-tag">${ico("science")}пример</span>` : ""}</div>
      <h2>${esc(c.title)}</h2>
      ${c.description ? `<p style="margin:0">${esc(c.description)}</p>` : ""}
      ${c.status === "duplicate" && c.duplicateOf ? `<button class="btn text" data-open="${esc(c.duplicateOf)}" style="align-self:flex-start;padding:0">${ico("call_merge")}Открыть основное обращение</button>` : ""}
    </div>
    <div class="kv">
      ${ico(k.icon)}<span>${esc(k.name)}</span>
      ${ico("place")}<span>${esc(c.address)}<br><span class="small muted">${esc(c.district || "")}${c.district ? " · " : ""}${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</span></span>
      ${ico("schedule")}<span>${fmtDate(c.createdAt)} · автор: ${esc(c.mine ? "вы" : c.author)}</span>
      ${ico("apartment")}<span class="small">Ответственная организация (ориентировочно): ${esc(k.org)}</span>
    </div>
    <div class="minimap" id="minimap" style="margin-top:14px" role="img" aria-label="Место на карте"></div>
    <div class="actions">
      <button class="btn ${c.supportedByMe ? "on" : "tonal"}" data-act="support" data-id="${esc(c.id)}" ${c.mine || !open ? "disabled" : ""}>${ico("thumb_up", c.supportedByMe ? "fill" : "")}${c.supportedByMe ? "Поддержано" : "Я тоже видел"}</button>
      <button class="btn outline" data-act="toappeal" data-id="${esc(c.id)}">${ico("description")}Обращение</button>
      ${canConfirm ? `<button class="btn outline" data-act="confirm" data-id="${esc(c.id)}">${ico("task_alt")}Решено</button><button class="btn outline" data-act="notfixed" data-id="${esc(c.id)}" ${c.status !== "resolved_wait" ? "disabled" : ""}>${ico("replay")}Не решено</button>` : ""}
      ${c.confirmedByMe && c.status !== "resolved" ? `<p class="full small muted" style="margin:0">Вы подтвердили, что проблема решена. Подтверждений: ${c.confirms} из ${CONFIRM_NEED}.</p>` : ""}
      ${c.mine && ["published", "sent", "work"].includes(c.status) ? `<label class="btn outline full" for="after-input">${ico("add_photo_alternate")}Добавить фото «после»</label><input id="after-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden>` : ""}
    </div>
    <div class="support-box"><b class="num">${c.supports}</b><span class="small">${plural(c.supports, "житель поддержал", "жителя поддержали", "жителей поддержали")} это обращение${c.status === "resolved_wait" ? `<br>Подтверждений решения: ${c.confirms} из ${CONFIRM_NEED}` : ""}</span></div>
    ${after.length && !photos.some((p) => p.kind === "after") ? `<p class="pad small muted">Автор приложил фото «после» — оно появится после проверки модератором.</p>` : ""}
    ${moderatorHtml(c)}
    <div class="section-title">История статусов</div>
    ${c.history.length ? `<ol class="timeline">${c.history.map((h) => `<li><b>${STATUSES[h.status].name}</b><div class="small muted">${fmtDate(h.at)} · ${esc(h.by)}</div>${h.comment ? `<div class="small">${esc(h.comment)}</div>` : ""}</li>`).join("")}</ol>` : `<p class="pad small muted">${S.offlineSince ? "История недоступна без сети." : "Загружаем историю…"}</p>`}
    <div class="pad"><button class="btn text" data-act="report" data-id="${esc(c.id)}">${ico("flag")}Пожаловаться на обращение</button></div>
  </div>`;
}

export function viewAppeal(): string {
  const c = findComplaint(S.detailId);
  if (!c) return `<div class="screen no-nav">${topbar("Официальное обращение")}<div class="empty">${ico("help")}<p>Обращение не найдено.</p></div></div>`;
  const u = user();
  return `<div class="screen no-nav">
    ${topbar("Официальное обращение")}
    <p class="step-sub">Приложение не отправляет обращения в органы власти. Скопируйте текст и подайте его через платформу «Госуслуги. Решаем вместе» — там ответ обязателен в течение 30 дней.</p>
    <div class="appeal" id="appeal-text">${esc(appealText(c, cat(c.category), c.demo ? "" : complaintUrl(c.id)))}</div>
    <div class="stack" style="padding:16px">
      <button class="btn primary block" data-act="copyappeal">${ico("content_copy")}Скопировать текст</button>
      <a class="btn outline block" href="https://pos.gosuslugi.ru/" target="_blank" rel="noopener">${ico("open_in_new")}Открыть «Решаем вместе»</a>
      ${c.status === "published" && c.mine && u ? `<button class="btn text" data-act="marksent" data-id="${esc(c.id)}">Я отправил обращение — отметить «Передано»</button>` : ""}
    </div>
  </div>`;
}

export { illuHtml };
