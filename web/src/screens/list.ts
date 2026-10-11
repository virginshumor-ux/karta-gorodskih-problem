import { DISTRICTS } from "../domain/constants";
import { esc, ico, plural } from "../domain/format";
import { filtered, S } from "../state/store";
import { itemHtml, offlineBanner, topbar } from "./common";

export function viewList(): string {
  const f = S.filter;
  const districts = [...new Set([...DISTRICTS, ...S.complaints.map((c) => c.district).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "ru"));
  return `<div class="screen">
    ${topbar("Обращения", { backBtn: false, right: `<button class="icon-btn" data-go="map" aria-label="Показать на карте">${ico("map")}</button>` })}
    ${offlineBanner()}
    <div class="pad"><input class="input" id="search" type="search" placeholder="Поиск по адресу или описанию" value="${esc(S.search)}" aria-label="Поиск"></div>
    <div class="row" style="overflow-x:auto;padding:12px 16px 4px;scrollbar-width:none">
      ${([["open", "Актуальные"], ["resolved", "Решённые"], ["all", "Все"]] as const).map(([k, t]) => `<button class="chip ${f.status === k ? "on" : ""}" data-status="${k}" aria-pressed="${f.status === k}">${t}</button>`).join("")}
      <button class="chip ${f.mine ? "on" : ""}" data-mine="1" aria-pressed="${f.mine}">${ico("person")}Мои</button>
      ${S.cats.map((c) => `<button class="chip ${f.cats.has(c.id) ? "on" : ""}" data-cat="${c.id}" aria-pressed="${f.cats.has(c.id)}">${ico(c.icon)}${esc(c.name)}</button>`).join("")}
    </div>
    <div class="row filter-selects pad">
      <label class="select-wrap grow">${ico("location_city")}<select id="f-district" aria-label="Район"><option value="">Все районы</option>${districts.map((d) => `<option ${f.district === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></label>
      <label class="select-wrap grow">${ico("date_range")}<select id="f-period" aria-label="Период"><option value="all" ${f.period === "all" ? "selected" : ""}>За всё время</option><option value="7" ${f.period === "7" ? "selected" : ""}>За 7 дней</option><option value="30" ${f.period === "30" ? "selected" : ""}>За 30 дней</option></select></label>
    </div>
    <div id="list-results">${listResults()}</div>
  </div>`;
}

export function listResults(): string {
  if (S.loading && !S.complaints.length)
    return `<div class="empty" role="status">${ico("hourglass_top")}<p>Загружаем обращения…</p></div>`;
  const items = filtered();
  return `<p class="pad small muted" style="margin:8px 0">${items.length} ${plural(items.length, "обращение", "обращения", "обращений")} · сначала новые</p>
    ${items.length ? `<div class="c-list">${items.map(itemHtml).join("")}</div>` : `<div class="empty">${ico("search_off")}<p>Ничего не найдено. Сбросьте фильтры или сообщите о новой проблеме.</p><button class="btn tonal" data-act="resetfilters">Сбросить фильтры</button></div>`}`;
}
