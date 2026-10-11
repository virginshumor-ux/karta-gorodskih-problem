import { CITY } from "../domain/constants";
import { esc, fmtDate, ico, plural } from "../domain/format";
import { iceRisk, wmo } from "../domain/weather";
import type { Complaint } from "../domain/types";
import { filtered, findComplaint, S } from "../state/store";
import { photoHtml, statusChip } from "./common";

function weatherChip(): string {
  const w = S.weather?.data;
  if (!w) return "";
  const c = w.current;
  const ww = wmo(c.weather_code, c.is_day);
  const t = Math.round(c.temperature_2m);
  return `<button class="weather-chip" data-go="weather" aria-label="Погода в Красноярске: ${t} градусов, ${esc(ww.text)}">${ico(ww.icon, "wicon")}<span><span class="t num">${c.temperature_2m > 0 ? "+" : ""}${t}°</span><small>${esc(ww.text)}</small></span></button>`;
}

function sheetHtml(c: Complaint): string {
  return `<div class="sheet" role="dialog" aria-label="${esc(c.title)}">
    <div class="grip"></div>
    <div class="row" style="align-items:flex-start;gap:12px">
      <div class="thumb">${photoHtml(c)}</div>
      <div class="grow stack" style="gap:4px">
        ${statusChip(c.status, 'style="align-self:flex-start"')}
        <b style="line-height:1.3">${esc(c.title)}</b>
        <span class="small muted">${esc(c.address)} · ${fmtDate(c.createdAt)}</span>
      </div>
      <button class="icon-btn" data-act="closesheet" aria-label="Закрыть">${ico("close")}</button>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn ${c.supportedByMe ? "on" : "tonal"} grow" data-act="support" data-id="${esc(c.id)}" ${c.mine ? "disabled" : ""}>${ico("thumb_up", c.supportedByMe ? "fill" : "")}<span class="num">${c.supports}</span> ${c.supportedByMe ? "Вы поддержали" : "Я тоже видел"}</button>
      <button class="btn primary grow" data-open="${esc(c.id)}">Подробнее</button>
    </div>
  </div>`;
}

export function hudHtml(): { html: string; withBanner: boolean } {
  const risk = iceRisk(S.weather?.data);
  const f = S.filter;
  const sel = findComplaint(S.selected);
  const n = filtered().length;
  const statusChips: [Filter["status"], string][] = [["open", "Актуальные"], ["resolved", "Решённые"], ["all", "Все"]];
  const html = `
    <div class="map-top">
      <button class="brand-chip mobile-only" data-go="list" aria-label="Открыть список обращений">
        <span class="brand-mark">${ico("location_on", "fill")}</span>
        <span class="brand-txt"><b>Карта городских проблем</b><span>${CITY.name} · ${n} ${plural(n, "обращение", "обращения", "обращений")}</span></span>
      </button>
      ${weatherChip()}
    </div>
    ${risk ? `<button class="ice-banner" data-go="weather">${ico("warning", "fill")}<span class="grow">${esc(risk)}</span>${ico("chevron_right")}</button>` : ""}
    <div class="filter-row" role="toolbar" aria-label="Фильтры">
      ${statusChips.map(([k, t]) => `<button class="chip raised ${f.status === k ? "on" : ""}" data-status="${k}" aria-pressed="${f.status === k}">${t}</button>`).join("")}
      <button class="chip raised ${f.mine ? "on" : ""}" data-mine="1" aria-pressed="${f.mine}">${ico("person")}Мои</button>
      ${S.cats.slice(0, 8).map((c) => `<button class="chip raised ${f.cats.has(c.id) ? "on" : ""}" data-cat="${c.id}" aria-pressed="${f.cats.has(c.id)}">${ico(c.icon)}${esc(c.name)}</button>`).join("")}
    </div>
    <div class="map-fabs">
      <button class="icon-btn tonal" data-act="zoomin" aria-label="Приблизить">${ico("add")}</button>
      <button class="icon-btn tonal" data-act="zoomout" aria-label="Отдалить">${ico("remove")}</button>
      <button class="icon-btn tonal" data-act="locate" aria-label="Моё местоположение">${ico("my_location")}</button>
    </div>
    ${S.mapMode === "snapshot" ? `<div class="map-mode">${ico("cloud_off")} Встроенная карта: сервер карт недоступен</div>` : S.offlineSince ? `<div class="map-mode">${ico("cloud_off")} Нет сети — сохранённые данные</div>` : ""}
    ${sel ? sheetHtml(sel) : ""}
  `;
  return { html, withBanner: !!risk };
}

type Filter = typeof S.filter;
