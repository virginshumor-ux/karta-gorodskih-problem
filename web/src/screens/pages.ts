import privacyMd from "../../../docs/privacy.md?raw";
import { CONFIG } from "../config";
import { CITY, DAY, STATUSES } from "../domain/constants";
import { esc, fmtDate, ico, plural } from "../domain/format";
import { iceRisk, wmo } from "../domain/weather";
import type { Stats } from "../domain/types";
import { ls } from "../state/storage";
import { cat, isModerator, S, user } from "../state/store";
import { markdown } from "../ui/dom";
import { itemHtml, offlineBanner, topbar } from "./common";

// ---------- уведомления ----------

export function viewNotif(): string {
  const ns = [...S.notifications].sort((a, b) => b.at - a.at);
  if (!user())
    return `<div class="screen">${topbar("Уведомления", { backBtn: false })}<div class="empty">${ico("notifications_off")}<p>Войдите, чтобы получать уведомления об изменении статуса ваших и поддержанных обращений.</p><button class="btn primary" data-act="login">Войти</button></div></div>`;
  return `<div class="screen">${topbar("Уведомления", { backBtn: false, right: ns.some((n) => !n.read) ? `<button class="btn text" data-act="readall">Прочитать все</button>` : "" })}
    ${offlineBanner()}
    ${
      ns.length
        ? ns
            .map((n) => {
              const k = cat(n.cat || S.complaints.find((c) => c.id === n.complaintId)?.category || "other");
              return `<button class="notif ${n.read ? "" : "unread"}" data-notif="${esc(n.id)}"><span class="cat-ico" style="background:${k.color}">${ico(k.icon, "fill")}</span><span><span style="display:block">${esc(n.text)}</span><span class="small muted">${fmtDate(n.at)}${n.read ? "" : " · новое"}</span></span></button>`;
            })
            .join("")
        : `<div class="empty">${ico("notifications_off")}<p>Пока нет уведомлений. Здесь появятся изменения статусов ваших и поддержанных обращений.</p></div>`
    }
  </div>`;
}

// ---------- профиль ----------

export function viewProfile(): string {
  const u = user();
  if (!u)
    return `<div class="screen">${topbar("Профиль", { backBtn: false })}${offlineBanner()}<div class="empty">${ico("account_circle")}<p>Войдите, чтобы сообщать о проблемах и получать уведомления о статусе.</p><button class="btn primary" data-act="login">Войти</button></div>${settingsHtml()}</div>`;
  const mine = S.complaints.filter((c) => c.mine).sort((a, b) => b.createdAt - a.createdAt);
  const supported = S.complaints.filter((c) => c.supportedByMe).sort((a, b) => b.createdAt - a.createdAt);
  const solved = mine.filter((c) => c.status === "resolved" || c.status === "resolved_wait").length;
  const provider = { yandex: "Яндекс ID", vk: "VK ID", demo: "демо-вход" }[u.provider];
  const role = u.role === "admin" ? " · администратор" : u.role === "moderator" ? " · модератор" : "";
  return `<div class="screen">${topbar("Профиль", { backBtn: false })}
    ${offlineBanner()}
    <div class="profile-head"><div class="avatar" aria-hidden="true">${esc((u.nick[0] ?? "?").toUpperCase())}</div><div class="grow"><b style="font-size:18px">${esc(u.nick)}</b><div class="small muted">Вход через ${provider} · ${CITY.name}${role}</div></div></div>
    <div class="stat-row"><div class="stat"><b class="num">${mine.length}</b><span>${plural(mine.length, "обращение", "обращения", "обращений")}</span></div><div class="stat"><b class="num">${solved}</b><span>решено</span></div><div class="stat"><b class="num">${supported.length}</b><span>поддержано</span></div></div>
    ${S.pendingDrafts ? `<div class="mode-banner warn" style="margin-top:12px">${ico("cloud_upload")}<span>Черновиков ждут отправки: ${S.pendingDrafts}. Отправим при появлении сети.</span><button class="btn text" data-act="flushdrafts">Отправить</button></div>` : ""}
    <div class="section-title">Мои обращения</div>
    ${mine.length ? `<div class="c-list">${mine.map(itemHtml).join("")}</div>` : `<p class="pad muted">Вы ещё не сообщали о проблемах.</p>`}
    <div class="section-title">Поддержанные</div>
    ${supported.length ? `<div class="c-list">${supported.map(itemHtml).join("")}</div>` : `<p class="pad muted">Нажмите «Я тоже видел» в карточке обращения — оно появится здесь, а вы будете получать уведомления.</p>`}
    ${settingsHtml()}
  </div>`;
}

function settingsHtml(): string {
  const theme = ls.get("theme", "system");
  const u = user();
  const local = S.backend?.mode === "local";
  const modOn = ls.get("moderator", false);
  return `<div class="section-title">Разделы</div>
    <div class="list-group">
      <button class="list-row" data-go="stats">${ico("bar_chart")}<span class="grow">Статистика по району</span>${ico("chevron_right")}</button>
      <button class="list-row" data-go="weather">${ico("partly_cloudy_day")}<span class="grow">Погода и городские предупреждения</span>${ico("chevron_right")}</button>
      <button class="list-row" data-go="about">${ico("info")}<span class="grow">О приложении и правила публикации</span>${ico("chevron_right")}</button>
      <button class="list-row" data-go="privacy">${ico("policy")}<span class="grow">Политика обработки персональных данных</span>${ico("chevron_right")}</button>
      ${isModerator() ? `<button class="list-row" data-go="admin">${ico("admin_panel_settings")}<span class="grow">Панель модератора</span>${ico("chevron_right")}</button>` : ""}
      ${CONFIG.apkUrl ? `<a class="list-row" href="${esc(CONFIG.apkUrl)}" target="_blank" rel="noopener">${ico("android")}<span class="grow">Скачать приложение для Android</span>${ico("open_in_new")}</a>` : ""}
    </div>
    <div class="section-title">Настройки</div>
    <div class="list-group">
      <button class="list-row" data-act="theme">${ico("dark_mode")}<span class="grow">Тема оформления</span><span class="small muted">${{ system: "как в системе", light: "светлая", dark: "тёмная" }[theme as "system" | "light" | "dark"]}</span></button>
      ${u ? `<button class="list-row" data-act="togglenotify" role="switch" aria-checked="${u.notifyEnabled}">${ico("notifications")}<span class="grow">Уведомления о статусах<br><span class="small muted">Ваши и поддержанные обращения</span></span><span class="switch ${u.notifyEnabled ? "on" : ""}"></span></button>` : ""}
      ${local ? `<button class="list-row" data-act="togglemod" role="switch" aria-checked="${modOn}">${ico("shield_person")}<span class="grow">Режим модератора (демо)<br><span class="small muted">Показывает кнопки модерации в карточке обращения</span></span><span class="switch ${modOn ? "on" : ""}"></span></button>
      <button class="list-row" data-act="resetdemo">${ico("restart_alt")}<span class="grow">Сбросить демо-данные</span></button>` : ""}
      ${u ? `<button class="list-row" data-act="logout">${ico("logout")}<span class="grow">Выйти</span></button>
      <button class="list-row" data-act="deleteacc" style="color:var(--bad)">${ico("person_remove")}<span class="grow">Удалить учётную запись и мои данные</span></button>` : ""}
    </div>
    <p class="pad tiny muted" style="margin-top:16px">Версия ${esc(CONFIG.version)}${CONFIG.buildDate ? ` от ${esc(CONFIG.buildDate)}` : ""} · ${local ? "автономный демо-режим: данные хранятся на этом устройстве" : "данные хранятся на сервере проекта"}</p>`;
}

// ---------- статистика ----------

export function viewStats(st: Stats | null): string {
  if (!st)
    return `<div class="screen">${topbar("Статистика")}<div class="empty" role="status">${ico(S.offlineSince ? "cloud_off" : "hourglass_top")}<p>${S.offlineSince ? "Статистика недоступна без сети." : "Считаем показатели…"}</p></div></div>`;
  const byCat = st.byCategory.filter((x) => x.n);
  const max = Math.max(1, ...byCat.map((x) => x.n));
  const counts = st.byDay.map((d) => d.n);
  const days = counts.length;
  const cmax = Math.max(2, ...counts);
  const W = 340,
    H = 110,
    pl = 20,
    pb = 18;
  const x = (i: number) => pl + (i * (W - pl - 6)) / Math.max(1, days - 1);
  const y = (v: number) => 8 + (H - pb - 8) * (1 - v / cmax);
  const path = counts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = path + `L${x(days - 1)},${H - pb}L${x(0)},${H - pb}Z`;
  const first = st.byDay[0]?.day ? new Date(st.byDay[0].day) : new Date(Date.now() - 20 * DAY);
  const dmax = Math.max(1, ...st.byDistrict.map((d) => d.n));
  return `<div class="screen">${topbar("Статистика")}
    <p class="step-sub">${CITY.name} · все опубликованные обращения и обращения на модерации</p>
    <div class="kpis"><div class="stat"><b class="num">${st.total}</b><span>обращений всего</span></div><div class="stat"><b class="num">${st.open}</b><span>ждут решения</span></div><div class="stat"><b class="num">${Math.round((st.resolved / Math.max(1, st.total)) * 100)}%</b><span>решено и подтверждено</span></div><div class="stat"><b class="num">${st.supports}</b><span>поддержек жителей</span></div></div>
    <div class="section-title">Новые обращения за 3 недели</div>
    <div class="card" style="margin:0 16px;padding:10px 6px 4px">
      <svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Число новых обращений по дням: всего ${counts.reduce((a, b) => a + b, 0)} за ${days} дней">
        <line x1="${pl}" x2="${W - 6}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>
        <line x1="${pl}" x2="${W - 6}" y1="${y(cmax)}" y2="${y(cmax)}" stroke="var(--line)" stroke-dasharray="3 3"/>
        <text x="2" y="${y(cmax) + 4}" font-size="10" fill="var(--fg-3)">${cmax}</text><text x="2" y="${y(0) + 4}" font-size="10" fill="var(--fg-3)">0</text>
        <path d="${area}" fill="var(--primary-soft)"/><path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2"/>
        <circle cx="${x(days - 1)}" cy="${y(counts[days - 1] ?? 0)}" r="3.5" fill="var(--primary)"/>
        <text x="${pl}" y="${H - 4}" font-size="10" fill="var(--fg-3)">${first.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</text><text x="${W - 6}" y="${H - 4}" font-size="10" fill="var(--fg-3)" text-anchor="end">сегодня</text>
      </svg>
    </div>
    <div class="section-title">По категориям</div>
    <div class="card" style="margin:0 16px"><div class="bars">${byCat.map((b) => { const k = cat(b.categoryId); return `<div class="bar-row"><span>${esc(k.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${(b.n / max) * 100}%;background:${k.color}"></div></div><b class="num" style="text-align:right">${b.n}</b></div>`; }).join("")}</div></div>
    <div class="section-title">По статусам</div>
    <div class="pad row wrap">${st.byStatus.filter((s) => s.n).map((s) => `<span class="status st-${s.status}">${STATUSES[s.status].name}: <span class="num">${s.n}</span></span>`).join("")}</div>
    ${st.byDistrict.length ? `<div class="section-title">По районам</div><div class="card" style="margin:0 16px"><div class="bars">${st.byDistrict.map((d) => `<div class="bar-row"><span>${esc(d.district.replace(" район", ""))}</span><div class="bar-track"><div class="bar-fill" style="width:${(d.n / dmax) * 100}%"></div></div><b class="num" style="text-align:right">${d.n}</b></div>`).join("")}</div></div>` : ""}
    ${st.medianModerationHours != null || st.medianResolutionDays != null ? `<div class="section-title">Скорость</div><div class="kpis">${st.medianModerationHours != null ? `<div class="stat"><b class="num">${st.medianModerationHours} ч</b><span>медиана до модерации</span></div>` : ""}${st.medianResolutionDays != null ? `<div class="stat"><b class="num">${st.medianResolutionDays} дн</b><span>медиана до решения</span></div>` : ""}</div>` : ""}
    <p class="api-note">Обезличенные данные с сервера. Те же показатели доступны для Yandex DataLens через представления analytics_*.</p>
  </div>`;
}

// ---------- погода ----------

export function viewWeather(): string {
  const w = S.weather?.data;
  if (!w) return `<div class="screen">${topbar("Погода")}<div class="empty">${ico("cloud_off")}<p>Данные о погоде пока не загружены.</p></div></div>`;
  const c = w.current;
  const now = wmo(c.weather_code, c.is_day);
  const t0 = new Date(c.time).getTime();
  const hrs = (w.hourly.time || [])
    .map((t, i) => ({ t: new Date(t).getTime(), temp: w.hourly.temperature_2m[i] ?? 0, code: w.hourly.weather_code[i] ?? 0, p: w.hourly.precipitation_probability?.[i] }))
    .filter((h) => h.t >= t0 - 36e5)
    .slice(0, 24);
  const risk = iceRisk(w);
  const src = S.weather?.live
    ? `обновлено ${fmtDate(w._fetchedAt || Date.now())}`
    : `сохранённые данные на ${new Date(w._fetchedAt || c.time).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`;
  return `<div class="screen">${topbar("Погода в Красноярске", { right: `<button class="icon-btn" data-act="refreshwx" aria-label="Обновить">${ico("refresh")}</button>` })}
    <div class="wx-now"><div><div class="t num">${c.temperature_2m > 0 ? "+" : ""}${Math.round(c.temperature_2m)}°</div><div style="font-weight:600;margin-top:6px">${esc(now.text)}</div><small>Ощущается как ${Math.round(c.apparent_temperature)}° · ветер ${c.wind_speed_10m.toFixed(1)} м/с · влажность ${c.relative_humidity_2m}%</small></div>${ico(now.icon)}</div>
    ${risk ? `<div class="card" style="margin:12px 16px 0;padding:12px 14px;background:var(--warn-soft);border-color:transparent"><div class="row" style="align-items:flex-start">${ico("warning", "fill")}<span class="small">${esc(risk)}</span></div></div>` : `<div class="card" style="margin:12px 16px 0;padding:12px 14px"><div class="row">${ico("verified")}<span class="small">Погодных предупреждений для городской среды нет.</span></div></div>`}
    <div class="section-title">Ближайшие 24 часа</div>
    <div class="hours">${hrs.map((h) => { const hh = new Date(h.t).getHours(); const ww = wmo(h.code, hh >= 7 && hh < 19); return `<div class="hour"><span class="muted num">${String(hh).padStart(2, "0")}:00</span>${ico(ww.icon)}<b class="num">${h.temp > 0 ? "+" : ""}${Math.round(h.temp)}°</b>${h.p ? `<span class="tiny muted num">${h.p}%</span>` : `<span class="tiny muted">&nbsp;</span>`}</div>`; }).join("")}</div>
    <div class="section-title">3 дня</div>
    <div class="list-group days">${w.daily.time.map((d, i) => { const ww = wmo(w.daily.weather_code[i] ?? 0); return `<div class="list-row">${ico(ww.icon)}<span class="grow">${i === 0 ? "Сегодня" : new Date(d).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "short" })}<br><span class="small muted">${esc(ww.text)}</span></span><b class="num">${Math.round(w.daily.temperature_2m_max[i] ?? 0)}°</b><span class="muted num">${Math.round(w.daily.temperature_2m_min[i] ?? 0)}°</span></div>`; }).join("")}</div>
    <p class="api-note">Источник: открытый API Open-Meteo (open-meteo.com), ${src}.</p>
  </div>`;
}

// ---------- о приложении и политика ----------

export function viewAbout(): string {
  return `<div class="screen">${topbar("О приложении")}
    <div class="pad stack">
      <p style="margin:0">«Карта городских проблем» помогает жителям Красноярска сообщать о проблемах городской среды, видеть их на карте и доводить до решения.</p>
      <div class="card" style="padding:14px"><b>Это не официальный канал обращений</b><p class="small" style="margin:6px 0 0">Публикация на карте не является обращением в орган власти. Для официального ответа используйте кнопку «Обращение» в карточке — она готовит текст для платформы «Госуслуги. Решаем вместе».</p></div>
      <b>Правила публикации</b>
      <ul class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px"><li>Одна проблема — одно обращение с реальным фото.</li><li>На фото не должно быть узнаваемых лиц и номеров автомобилей.</li><li>Без оскорблений, рекламы и политической агитации.</li><li>Не более 5 обращений в час.</li></ul>
      <b>Открытые данные и сервисы</b>
      <p class="small" style="margin:0">Карта © участники OpenStreetMap (серверы openstreetmap.org, openstreetmap.de, openstreetmap.fr). Погода — Open-Meteo. Адреса — геокодеры Nominatim (OpenStreetMap) и Photon (komoot).</p>
      <button class="btn text" data-go="privacy" style="align-self:flex-start;padding:0">${ico("policy")}Политика обработки персональных данных</button>
      <p class="small muted" style="margin:0">Учебный проект СФУ, Институт управления бизнес-процессами, 2026. Команда: Д. Д. Кутненко, Т. А. Гончаров, Е. В. Эбель.</p>
      <p class="tiny muted" style="margin:0">Версия ${esc(CONFIG.version)}${CONFIG.buildDate ? ` · сборка ${esc(CONFIG.buildDate)}` : ""}</p>
    </div></div>`;
}

export const privacyHtml = (): string => `<div class="prose">${markdown(privacyMd)}</div>`;

export function viewPrivacy(): string {
  return `<div class="screen">${topbar("Персональные данные")}<div class="pad">${privacyHtml()}</div></div>`;
}

// ---------- онбординг и вход ----------

export const ONB = [
  { icon: "add_location_alt", color: "var(--primary)", title: "Увидели яму, свалку или наледь?", text: "Сфотографируйте и отметьте место — на обращение уходит меньше минуты." },
  { icon: "groups", color: "#2f7fb5", title: "Объединяемся с соседями", text: "Поддерживайте обращения других жителей и подтверждайте, когда проблему решили." },
  { icon: "gavel", color: "#b3471d", title: "Это не официальный канал", text: "Карта делает проблемы видимыми. Для официального ответа приложение подготовит текст обращения для «Госуслуги. Решаем вместе»." },
];

export function onboardingHtml(i: number): string {
  const o = ONB[i] as (typeof ONB)[number];
  return `<div class="overlay"><div class="onb" role="dialog" aria-label="Знакомство с приложением, шаг ${i + 1} из 3">
    <div class="row" style="justify-content:space-between"><div class="dots">${ONB.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div><button class="btn text" data-onb="3">Пропустить</button></div>
    <div class="onb-art" style="background:${o.color}">${ico(o.icon, "fill")}</div>
    <h2>${o.title}</h2><p>${o.text}</p>
    ${i === 2 ? `<p class="small muted" style="margin:0">Приложению понадобятся доступ к камере, геолокации и уведомлениям — браузер спросит разрешение в момент использования.</p>` : ""}
    <button class="btn primary block" data-onb="${i + 1}">${i < 2 ? "Далее" : "Начать"}</button>
  </div></div>`;
}

export function loginHtml(reason?: string): string {
  const b = S.backend;
  const ya = b.providerAvailable("yandex");
  const vk = b.providerAvailable("vk");
  const soon = (ok: boolean) => (ok ? "" : `<span class="soon">${b.mode === "local" ? "нужен сервер" : "скоро"}</span>`);
  return `<div class="overlay"><div class="onb" style="justify-content:flex-start" role="dialog" aria-label="Вход">
    <div class="login-logo"><span class="brand-mark">${ico("location_on", "fill")}</span><span class="small muted">Красноярск</span></div>
    <h2 class="login-title">Карта городских проблем</h2>
    <p>${esc(reason || "Войдите, чтобы сообщать о проблемах, поддерживать обращения соседей и получать уведомления о статусе.")}</p>
    <div class="stack" style="margin-top:8px">
      <button class="btn vk block" data-act="vk" ${vk ? "" : 'aria-disabled="true"'}><span class="idmark">VK</span>Войти через VK ID${soon(vk)}</button>
      <button class="btn ya block" data-act="ya" ${ya ? "" : 'aria-disabled="true"'}><span class="idmark">Я</span>Войти через Яндекс ID${soon(ya)}</button>
      ${CONFIG.demoLoginEnabled ? `<button class="btn tonal block" data-act="demologin">${ico("science")}Демо-вход без аккаунта</button>` : ""}
      <button class="btn text block" data-act="skiplogin">Продолжить без входа</button>
    </div>
    <p class="legal">Публично показывается только ваш никнейм. Перед первым входом вы отдельно дадите согласие на обработку данных по <button class="link" data-act="privacy">Политике обработки персональных данных</button>.</p>
  </div></div>`;
}

export function profileFormHtml(): string {
  return `<h3>Придумайте никнейм</h3><p class="small muted" style="margin:0">Он будет виден на карте вместо имени. Реальные имя, телефон и почта не публикуются.</p>
    <div class="field"><label for="nick">Никнейм</label><input class="input" id="nick" maxlength="24" autocomplete="nickname" value="житель_${Math.floor(100 + Math.random() * 900)}" aria-describedby="nick-hint"><span class="hint" id="nick-hint">От 3 до 24 символов: буквы, цифры, пробел, _ . -</span></div>
    <label class="row small" style="align-items:flex-start"><input type="checkbox" id="pd-consent" style="width:20px;height:20px;margin:2px 0 0;flex:none"> <span>Даю согласие на обработку персональных данных в соответствии с <button class="link" data-act="privacy">Политикой обработки персональных данных</button> (152-ФЗ)</span></label>
    <div class="row"><button class="btn outline grow" data-act="cancelprofile">Отмена</button><button class="btn primary grow" data-act="dologin">Войти</button></div>`;
}
