"use strict";
/* Карта городских проблем — клиентское приложение.
   Хранилище: IndexedDB (локальная БД на устройстве), открытые API:
   Open-Meteo (погода), Nominatim/OpenStreetMap (адреса), тайлы OSM (карта). */

// ---------- справочники ----------
const CITY = { name: "Красноярск", lat: 56.0153, lng: 92.8932 };
const CAMPUS = { lat: 56.0005, lng: 92.7820, zoom: 15 };
const KRSK_BOX = { s: 55.90, n: 56.14, w: 92.60, e: 93.20 };

const CATS = [
  { id: "road",   name: "Дороги и ямы",              icon: "add_road",          color: "#5b5f97", org: "МКУ «Управление дорог, инфраструктуры и благоустройства»" },
  { id: "light",  name: "Освещение",                 icon: "lightbulb",         color: "#c08a00", org: "Эксплуатирующая организация сетей наружного освещения" },
  { id: "trash",  name: "Мусор и свалки",            icon: "delete",            color: "#6b7b2a", org: "Региональный оператор по обращению с ТКО" },
  { id: "snow",   name: "Снег и наледь",             icon: "ac_unit",           color: "#2f7fb5", org: "Администрация района / управляющая компания" },
  { id: "ice",    name: "Сосульки и опасные кровли", icon: "warning",           color: "#b3471d", org: "Управляющая компания / собственник здания" },
  { id: "yard",   name: "Двор и придомовая территория", icon: "holiday_village", color: "#8a4f8f", org: "Управляющая компания / ТСЖ" },
  { id: "green",  name: "Благоустройство и озеленение", icon: "park",          color: "#2e7d4f", org: "Администрация района" },
  { id: "transit",name: "Транспорт и остановки",     icon: "directions_bus",    color: "#0b6c78", org: "Департамент транспорта администрации города" },
  { id: "other",  name: "Прочее",                    icon: "more_horiz",        color: "#6a6f73", org: "Администрация района" },
];
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
const STATUSES = {
  moderation:    { name: "На модерации" },
  published:     { name: "Опубликовано" },
  sent:          { name: "Передано в организацию" },
  work:          { name: "В работе" },
  resolved_wait: { name: "Решено — ждёт подтверждения" },
  resolved:      { name: "Решено" },
  rejected:      { name: "Отклонено" },
  duplicate:     { name: "Дубликат" },
};
const STATUS_COLOR = { moderation: "#7a8a89", published: "#2f5fa8", sent: "#0b5d66", work: "#c27c00", resolved_wait: "#3d9a63", resolved: "#2e7d4f", rejected: "#b3261e", duplicate: "#8a9393" };
const OPEN_STATUSES = ["published", "sent", "work", "resolved_wait"];
const CONFIRM_NEED = 3;

// ---------- утилиты ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ico = (name, cls = "") => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const DAY = 864e5;
function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return Math.floor(diff / 60) + " мин назад";
  if (diff < 86400 && d.getDate() === now.getDate()) return "сегодня, " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) + ", " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many; }
function distM(a, b) { const R = 6371e3, t = Math.PI / 180; const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function inKrsk(p) { return p.lat > KRSK_BOX.s && p.lat < KRSK_BOX.n && p.lng > KRSK_BOX.w && p.lng < KRSK_BOX.e; }
const ls = { get(k, d) { try { const v = localStorage.getItem("kgp." + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem("kgp." + k, JSON.stringify(v)); } catch {} } };
const isDesktop = () => matchMedia("(min-width: 900px)").matches;

// ---------- локальная БД (IndexedDB с запасным вариантом в памяти) ----------
const DB = {
  db: null, mem: { complaints: new Map(), notifications: new Map(), meta: new Map() },
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open("kgp", 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          const c = d.createObjectStore("complaints", { keyPath: "id" });
          c.createIndex("status", "status"); c.createIndex("category", "category"); c.createIndex("createdAt", "createdAt");
          d.createObjectStore("notifications", { keyPath: "id" });
          d.createObjectStore("meta", { keyPath: "key" });
        };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        setTimeout(() => rej(new Error("timeout")), 3000);
      });
    } catch { this.db = null; }
  },
  tx(store, mode, fn) {
    if (!this.db) return Promise.resolve(fn(null));
    return new Promise((res, rej) => { const t = this.db.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); });
  },
  async all(store) { if (!this.db) return [...this.mem[store].values()]; return this.tx(store, "readonly", s => s.getAll()); },
  async get(store, id) { if (!this.db) return this.mem[store].get(id); return this.tx(store, "readonly", s => s.get(id)); },
  async put(store, obj) { if (!this.db) { this.mem[store].set(obj.id ?? obj.key, obj); return; } return this.tx(store, "readwrite", s => { s.put(obj); }); },
  async del(store, id) { if (!this.db) { this.mem[store].delete(id); return; } return this.tx(store, "readwrite", s => { s.delete(id); }); },
  async clear(store) { if (!this.db) { this.mem[store].clear(); return; } return this.tx(store, "readwrite", s => { s.clear(); }); },
};

// ---------- демо-данные (адреса получены геокодером Nominatim) ----------
function seedComplaints() {
  const now = Date.now();
  const mk = (o) => {
    const created = now - o.days * DAY - (o.h || 0) * 36e5;
    const hist = [{ status: "moderation", at: created, by: "Автор", comment: "Обращение создано" }];
    const chain = { published: ["published"], sent: ["published", "sent"], work: ["published", "sent", "work"], resolved_wait: ["published", "sent", "work", "resolved_wait"], resolved: ["published", "sent", "work", "resolved_wait", "resolved"], moderation: [] }[o.status] || ["published"];
    const notes = { published: "Проверено модератором и опубликовано", sent: "Обращение направлено: " + CAT[o.cat].org, work: "Организация сообщила о начале работ", resolved_wait: "Отмечено как решённое, ждём подтверждения жителей", resolved: "Решение подтвердили жители" };
    chain.forEach((s, i) => hist.push({ status: s, at: created + (i + 1) * (o.days * DAY / (chain.length + 1)), by: s === "resolved" ? "Жители" : "Модератор", comment: notes[s] }));
    return { id: "demo-" + o.n, demo: true, title: o.title, category: o.cat, description: o.desc, lat: o.lat, lng: o.lng, address: o.addr, district: o.district, status: o.status, createdAt: created, updatedAt: hist[hist.length - 1].at, photos: [], author: o.author || "житель_" + (100 + o.n), mine: !!o.mine, supports: o.sup, supportedByMe: false, confirms: o.status === "resolved" ? CONFIRM_NEED : (o.conf || 0), confirmedByMe: false, history: hist.reverse() };
  };
  return [
    { n: 1, cat: "snow", title: "Наледь на ступенях у входа в корпус", desc: "Ступени у главного входа покрыты льдом, песка нет. Утром несколько человек поскользнулись.", lat: 56.0042, lng: 92.7735, addr: "Свободный проспект, 79 с1", district: "Октябрьский район", status: "work", days: 2, sup: 31 },
    { n: 2, cat: "transit", title: "Разбито стекло остановочного павильона", desc: "Осколки лежат на скамейке и под ногами, павильон не защищает от ветра.", lat: 56.0031, lng: 92.7668, addr: "Свободный проспект", district: "Октябрьский район", status: "published", days: 1, h: 5, sup: 24 },
    { n: 3, cat: "light", title: "Не горят фонари во дворе общежития", desc: "Третий вечер подряд не работают два фонаря вдоль дорожки к общежитию, после 18:00 темно.", lat: 55.9998, lng: 92.7752, addr: "Свободный проспект, 81В", district: "Октябрьский район", status: "sent", days: 4, sup: 18 },
    { n: 4, cat: "road", title: "Глубокая яма на въезде во двор", desc: "Яма около 40 см в диаметре, после дождя заполняется водой и её не видно.", lat: 55.9952, lng: 92.7965, addr: "улица Борисова, 5", district: "Октябрьский район", status: "resolved_wait", days: 9, sup: 12, conf: 1, mine: true, author: "вы" },
    { n: 5, cat: "trash", title: "Переполнены мусорные контейнеры", desc: "Контейнеры не вывозили несколько дней, мусор разносит ветром.", lat: 55.9938, lng: 92.7905, addr: "Студгородок СФУ", district: "Октябрьский район", status: "resolved", days: 14, sup: 9 },
    { n: 6, cat: "green", title: "Сломана скамейка на аллее", desc: "У скамейки отломана спинка, торчат болты.", lat: 55.9921, lng: 92.7662, addr: "Академгородок", district: "Октябрьский район", status: "published", days: 3, sup: 5 },
    { n: 7, cat: "yard", title: "Разрушено ограждение детской площадки", desc: "Секция забора лежит на земле, рядом проезжая часть.", lat: 55.9960, lng: 92.7600, addr: "улица Академгородок, 23", district: "Октябрьский район", status: "moderation", days: 0, h: 2, sup: 0, mine: true, author: "вы" },
    { n: 8, cat: "trash", title: "Несанкционированная свалка у гаражей", desc: "Строительный мусор, покрышки и старая мебель. Куча растёт каждую неделю.", lat: 56.0075, lng: 92.7820, addr: "улица Бригада № 5", district: "Октябрьский район", status: "published", days: 6, sup: 47 },
    { n: 9, cat: "road", title: "Колея и ямы на проезжей части", desc: "Участок около 50 м, машины объезжают ямы по встречной полосе.", lat: 56.0102, lng: 92.8130, addr: "улица Ладо Кецховели, 35", district: "Октябрьский район", status: "work", days: 11, sup: 63 },
    { n: 10, cat: "snow", title: "Не убран тротуар после снегопада", desc: "Тротуар засыпан, пешеходы идут по проезжей части.", lat: 56.0060, lng: 92.8050, addr: "Сопочная улица, 54А", district: "Октябрьский район", status: "published", days: 1, sup: 15 },
    { n: 11, cat: "light", title: "Не работает фонарь у пешеходного перехода", desc: "Переход не освещён, водители замечают пешеходов в последний момент.", lat: 56.0010, lng: 92.8000, addr: "улица Академика Киренского, 56", district: "Октябрьский район", status: "sent", days: 5, sup: 22 },
    { n: 13, cat: "ice", title: "Сосульки над тротуаром", desc: "Крупные сосульки над входом в магазин, зона не огорожена.", lat: 56.0150, lng: 92.7980, addr: "улица Менжинского", district: "Октябрьский район", status: "published", days: 2, sup: 11 },
    { n: 14, cat: "green", title: "Упавшее дерево перегородило дорожку", desc: "После ветра упала берёза, проход перекрыт.", lat: 56.0120, lng: 92.7700, addr: "улица Забобонова", district: "Октябрьский район", status: "resolved", days: 20, sup: 8 },
    { n: 15, cat: "yard", title: "Открытый люк во дворе", desc: "Крышка люка сдвинута, вечером его не видно. Опасно для детей.", lat: 55.9975, lng: 92.8080, addr: "Мелькомбинатская улица, 3А", district: "Октябрьский район", status: "work", days: 3, sup: 29 },
    { n: 16, cat: "road", title: "Разрушен бордюр у перекрёстка", desc: "Куски бордюра на проезжей части.", lat: 56.0185, lng: 92.8200, addr: "Новосибирская улица, 42", district: "Железнодорожный район", status: "published", days: 7, sup: 6 },
  ].map(mk);
}
function seedNotifications(cs) {
  const byId = Object.fromEntries(cs.map(c => [c.id, c]));
  const n = (id, cid, text, ago, read) => ({ id, complaintId: cid, text, at: Date.now() - ago, read, cat: byId[cid].category });
  return [
    n("n1", "demo-7", "Обращение «Разрушено ограждение детской площадки» отправлено на модерацию", 2 * 36e5, false),
    n("n2", "demo-4", "Обращение «Глубокая яма на въезде во двор» отмечено как решённое. Подтвердите, если это так", 20 * 36e5, false),
    n("n3", "demo-9", "Поддержанное вами обращение «Колея и ямы на проезжей части» в работе", 3 * DAY, true),
    n("n4", "demo-4", "Обращение «Глубокая яма на въезде во двор» передано в МКУ «Управление дорог, инфраструктуры и благоустройства»", 6 * DAY, true),
  ];
}

// ---------- состояние ----------
const S = {
  user: ls.get("user", null),
  onboarded: ls.get("onboarded", false),
  moderator: ls.get("moderator", false),
  view: "map", prev: [],
  complaints: [], notifications: [],
  filter: { cats: new Set(), status: "open", mine: false },
  search: "",
  selected: null,
  detailId: null, detailPhoto: 0,
  draft: null,
  weather: null, weatherLive: false,
  mapMode: "live",
};

// ---------- погода (Open-Meteo, открытый API без ключа) ----------
const WMO = {
  0: ["Ясно", "clear_day", "clear_night"], 1: ["Преимущественно ясно", "partly_cloudy_day", "partly_cloudy_night"], 2: ["Переменная облачность", "partly_cloudy_day", "partly_cloudy_night"], 3: ["Пасмурно", "cloud", "cloud"],
  45: ["Туман", "foggy", "foggy"], 48: ["Изморозь, туман", "foggy", "foggy"],
  51: ["Слабая морось", "rainy_light", "rainy_light"], 53: ["Морось", "rainy_light", "rainy_light"], 55: ["Сильная морось", "rainy", "rainy"],
  56: ["Ледяная морось", "weather_mix", "weather_mix"], 57: ["Ледяная морось", "weather_mix", "weather_mix"],
  61: ["Небольшой дождь", "rainy_light", "rainy_light"], 63: ["Дождь", "rainy", "rainy"], 65: ["Ливень", "rainy_heavy", "rainy_heavy"],
  66: ["Ледяной дождь", "weather_mix", "weather_mix"], 67: ["Ледяной дождь", "weather_mix", "weather_mix"],
  71: ["Небольшой снег", "weather_snowy", "weather_snowy"], 73: ["Снег", "weather_snowy", "weather_snowy"], 75: ["Сильный снег", "snowing_heavy", "snowing_heavy"], 77: ["Снежные зёрна", "weather_snowy", "weather_snowy"],
  80: ["Ливневый дождь", "rainy", "rainy"], 81: ["Ливневый дождь", "rainy", "rainy"], 82: ["Сильный ливень", "rainy_heavy", "rainy_heavy"],
  85: ["Снегопад", "weather_snowy", "weather_snowy"], 86: ["Сильный снегопад", "snowing_heavy", "snowing_heavy"],
  95: ["Гроза", "thunderstorm", "thunderstorm"], 96: ["Гроза с градом", "thunderstorm", "thunderstorm"], 99: ["Гроза с градом", "thunderstorm", "thunderstorm"],
};
const wmo = (code, day = 1) => { const w = WMO[code] || ["—", "cloud", "cloud"]; return { text: w[0], icon: day ? w[1] : w[2] }; };
const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?latitude=${CITY.lat}&longitude=${CITY.lng}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FKrasnoyarsk&forecast_days=3&wind_speed_unit=ms`;
async function loadWeather() {
  const cached = ls.get("weather", null);
  if (cached) { S.weather = cached; S.weatherLive = false; }
  else { S.weather = WEATHER_SNAPSHOT; S.weatherLive = false; }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(WEATHER_URL, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json(); d._fetchedAt = Date.now();
    S.weather = d; S.weatherLive = true; ls.set("weather", d);
  } catch { /* остаётся кэш или снимок */ }
  renderHud();
  if (S.view === "weather") render();
}
function iceRisk(w) {
  if (!w) return null;
  const c = w.current; const t = c.temperature_2m;
  const code = c.weather_code;
  const nextHours = (w.hourly?.temperature_2m || []).slice(0, 24);
  const crosses = nextHours.some(x => x > 0) && nextHours.some(x => x < 0);
  if ([56, 57, 66, 67].includes(code)) return "Ледяной дождь — высокий риск гололёда. Сообщайте о наледи на тротуарах.";
  if (t <= 2 && t >= -4 && (c.precipitation > 0 || crosses)) return "Температура около нуля — возможен гололёд. Отметьте опасные участки на карте.";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Снегопад — проверьте, убраны ли тротуары и остановки рядом с вами.";
  return null;
}

// ---------- карта (Leaflet + OpenStreetMap) ----------
// Под живой картой всегда лежит встроенная карта Красноярска (обзор города + подробный район СФУ),
// поэтому экран не бывает пустым. Живые тайлы берутся из первого источника, который отвечает:
// серверы OSM отказывают браузерам без адреса сайта (Referer), поэтому источник проверяется заранее.
const TILE_SOURCES = [
  { id: "osm", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", probe: "https://tile.openstreetmap.org/15/24828/10203.png", attr: "© участники OpenStreetMap", maxZoom: 19 },
  { id: "osmde", url: "https://tile.openstreetmap.de/{z}/{x}/{y}.png", probe: "https://tile.openstreetmap.de/15/24828/10203.png", attr: "© участники OpenStreetMap · сервер openstreetmap.de", maxZoom: 18 },
  { id: "osmfr", url: "https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", probe: "https://a.tile.openstreetmap.fr/osmfr/15/24828/10203.png", attr: "© участники OpenStreetMap · сервер OSM France", maxZoom: 19 },
];
let tileSourceP = null;
function isBlockedTile(img) {
  // Заглушка OSM «Access blocked» содержит жёлто-чёрную полосу; в настоящих тайлах OSM
  // насыщенного жёлтого и чистого чёрного почти нет.
  try {
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128; const g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, 128, 128); const d = g.getImageData(0, 0, 128, 128).data;
    let black = 0, yellow = 0;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], b = d[i + 2]; if (r < 45 && gg < 45 && b < 45) black++; else if (r > 150 && gg > 150 && b < 80 && Math.abs(r - gg) < 50) yellow++; }
    return black > 250 && yellow > 150;
  } catch { return false; }
}
function probeSource(s) {
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = "anonymous"; let done = false;
    const fin = ok => { if (!done) { done = true; res(ok); } };
    img.onload = () => fin(img.naturalWidth >= 256 && !isBlockedTile(img));
    img.onerror = () => fin(false);
    setTimeout(() => fin(false), 5000);
    img.src = s.probe + "?probe=" + Date.now().toString(36);
  });
}
function pickTileSource() {
  if (!tileSourceP) tileSourceP = (async () => { for (const s of TILE_SOURCES) { if (await probeSource(s)) return s; } return null; })();
  return tileSourceP;
}
function addSnapshots(m) {
  L.imageOverlay(CITY_SNAPSHOT.url, CITY_SNAPSHOT.bounds, { attribution: "© участники OpenStreetMap", className: "snap-layer" }).addTo(m);
  L.imageOverlay(MAP_SNAPSHOT.url, MAP_SNAPSHOT.bounds, { className: "snap-layer" }).addTo(m);
}
function makeBase(m, onMode) {
  addSnapshots(m);
  const limitToSnapshot = () => {
    const bb = L.latLngBounds(CITY_SNAPSHOT.bounds);
    m.setMaxBounds(bb.pad(0.02)); m.setMinZoom(11); m.setMaxZoom(18);
  };
  limitToSnapshot();
  onMode && onMode("pending");
  pickTileSource().then(src => {
    if (!m._mapPane || !m.getContainer().isConnected) return;
    if (!src) { onMode && onMode("snapshot"); return; }
    let loaded = 0, failed = 0, blocked = 0, checked = 0;
    const tiles = L.tileLayer(src.url, { maxZoom: src.maxZoom, attribution: src.attr, crossOrigin: "anonymous" });
    tiles.on("tileload", e => {
      loaded++;
      if (checked < 6) { checked++; if (isBlockedTile(e.tile)) blocked++; if (blocked >= 2) { m.removeLayer(tiles); onMode && onMode("snapshot"); } }
    });
    tiles.on("tileerror", () => { failed++; if (failed >= 6 && loaded === 0) { m.removeLayer(tiles); onMode && onMode("snapshot"); } });
    m.setMaxBounds(null); m.setMinZoom(3); m.setMaxZoom(src.maxZoom);
    tiles.addTo(m);
    onMode && onMode("live");
  });
}
function initMap() {
  if (typeof L === "undefined") { $("#map").innerHTML = `<div class="empty">${ico("map")}<p>Не удалось загрузить картографический модуль. Проверьте подключение к интернету.</p></div>`; return; }
  map = L.map("map", { zoomControl: false, attributionControl: true }).setView([CAMPUS.lat, CAMPUS.lng], CAMPUS.zoom);
  makeBase(map, mode => { S.mapMode = mode; renderHud(); });
  markersLayer = L.layerGroup().addTo(map);
  const pts = S.complaints.filter(c => OPEN_STATUSES.includes(c.status)).map(c => [c.lat, c.lng]);
  if (pts.length) map.fitBounds(pts, { padding: isDesktop() ? [60, 60] : [30, 30], maxZoom: 16 });
  map.on("click", () => { if (S.selected) { S.selected = null; renderHud(); drawMarkers(); } });
  drawMarkers();
}
function pinIcon(c, sel) {
  const cat = CAT[c.category];
  const col = c.status === "resolved" ? "#2e7d4f" : cat.color;
  return L.divIcon({ className: "", iconSize: [36, 44], iconAnchor: [4, 40], html: `<div class="pin ${sel ? "sel" : ""}" style="--c:${col}"><div class="head"></div>${ico(c.status === "resolved" ? "check" : cat.icon, "fill")}${c.supports >= 10 ? `<span class="cnt">${c.supports}</span>` : ""}</div>` });
}
function filtered() {
  const f = S.filter, q = S.search.trim().toLowerCase();
  return S.complaints.filter(c => {
    if (c.status === "duplicate") return false;
    if (c.status === "moderation" && !c.mine && !S.moderator) return false;
    if (c.status === "rejected" && !c.mine) return false;
    if (f.cats.size && !f.cats.has(c.category)) return false;
    if (f.mine && !c.mine) return false;
    if (f.status === "open" && !(OPEN_STATUSES.includes(c.status) || (c.mine && c.status === "moderation") || (S.moderator && c.status === "moderation"))) return false;
    if (f.status === "resolved" && c.status !== "resolved") return false;
    if (q && !(c.title + " " + c.address + " " + CAT[c.category].name).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => b.createdAt - a.createdAt);
}
function drawMarkers() {
  if (!map) return;
  markersLayer.clearLayers();
  filtered().forEach(c => {
    const m = L.marker([c.lat, c.lng], { icon: pinIcon(c, S.selected === c.id), keyboard: true, title: c.title, zIndexOffset: S.selected === c.id ? 1000 : 0 });
    m.on("click", e => { L.DomEvent.stopPropagation(e); S.selected = c.id; drawMarkers(); renderHud(); if (isDesktop()) { /* на компьютере показываем лист на карте */ } });
    markersLayer.addLayer(m);
  });
}

// ---------- HUD поверх карты ----------
function weatherChip() {
  const w = S.weather; if (!w) return "";
  const c = w.current; const ww = wmo(c.weather_code, c.is_day);
  return `<button class="weather-chip" data-go="weather" aria-label="Погода в Красноярске: ${Math.round(c.temperature_2m)} градусов, ${esc(ww.text)}">${ico(ww.icon, "wicon")}<span><span class="t num">${c.temperature_2m > 0 ? "+" : ""}${Math.round(c.temperature_2m)}°</span><small>${esc(ww.text)}</small></span></button>`;
}
function renderHud() {
  const hud = $("#hud"); if (!hud) return;
  const risk = iceRisk(S.weather);
  const f = S.filter;
  const sel = S.selected ? S.complaints.find(c => c.id === S.selected) : null;
  const statusChips = [["open", "Актуальные"], ["resolved", "Решённые"], ["all", "Все"]];
  hud.className = risk ? "with-banner" : "";
  hud.innerHTML = `
    <div class="map-top">
      <button class="brand-chip mobile-only" data-go="list" aria-label="Открыть список обращений">
        <span class="brand-mark">${ico("location_on", "fill")}</span>
        <span class="brand-txt"><b>Карта городских проблем</b><span>${CITY.name} · ${filtered().length} ${plural(filtered().length, "обращение", "обращения", "обращений")}</span></span>
      </button>
      ${weatherChip()}
    </div>
    ${risk ? `<button class="ice-banner" data-go="weather">${ico("warning", "fill")}<span class="grow">${esc(risk)}</span>${ico("chevron_right")}</button>` : ""}
    <div class="filter-row" role="toolbar" aria-label="Фильтры">
      ${statusChips.map(([k, t]) => `<button class="chip raised ${f.status === k ? "on" : ""}" data-status="${k}">${t}</button>`).join("")}
      <button class="chip raised ${f.mine ? "on" : ""}" data-mine="1">${ico("person")}Мои</button>
      ${CATS.slice(0, 8).map(c => `<button class="chip raised ${f.cats.has(c.id) ? "on" : ""}" data-cat="${c.id}">${ico(c.icon)}${esc(c.name)}</button>`).join("")}
    </div>
    <div class="map-fabs">
      <button class="icon-btn tonal" data-act="zoomin" aria-label="Приблизить">${ico("add")}</button>
      <button class="icon-btn tonal" data-act="zoomout" aria-label="Отдалить">${ico("remove")}</button>
      <button class="icon-btn tonal" data-act="locate" aria-label="Моё местоположение">${ico("my_location")}</button>
    </div>
    ${S.mapMode === "snapshot" ? `<div class="map-mode">${ico("cloud_off")} Встроенная карта: сервер карт недоступен</div>` : ""}
    ${sel ? sheetHtml(sel) : ""}
  `;
}
function photoHtml(c, i = 0, big = false) {
  if (c.photos && c.photos[i]) return `<img src="${c.photos[i]}" alt="Фото проблемы: ${esc(c.title)}">`;
  const cat = CAT[c.category];
  return `<div class="illu" style="background:linear-gradient(135deg, ${cat.color}, ${cat.color}cc 60%, #00000055)" role="img" aria-label="Иллюстрация категории ${esc(cat.name)}">${ico(cat.icon, "fill")}</div>`;
}
function sheetHtml(c) {
  const cat = CAT[c.category];
  return `<div class="sheet" role="dialog" aria-label="${esc(c.title)}">
    <div class="grip"></div>
    <div class="row" style="align-items:flex-start;gap:12px">
      <div class="thumb">${photoHtml(c)}</div>
      <div class="grow stack" style="gap:4px">
        <span class="status st-${c.status}">${STATUSES[c.status].name}</span>
        <b style="line-height:1.3">${esc(c.title)}</b>
        <span class="small muted">${esc(c.address)} · ${fmtDate(c.createdAt)}</span>
      </div>
      <button class="icon-btn" data-act="closesheet" aria-label="Закрыть">${ico("close")}</button>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn ${c.supportedByMe ? "on" : "tonal"} grow" data-act="support" data-id="${c.id}" ${c.mine ? "disabled" : ""}>${ico("thumb_up", c.supportedByMe ? "fill" : "")}<span class="num">${c.supports}</span> ${c.supportedByMe ? "Вы поддержали" : "Я тоже видел"}</button>
      <button class="btn primary grow" data-open="${c.id}">Подробнее</button>
    </div>
  </div>`;
}

// ---------- навигация ----------
const NAV = [["map", "map", "Карта"], ["list", "format_list_bulleted", "Список"], ["create", "add", ""], ["notif", "notifications", "Уведомления"], ["profile", "person", "Профиль"]];
function navHtml(rail) {
  const unread = S.notifications.filter(n => !n.read).length;
  const cur = S.view === "detail" || S.view === "appeal" ? (S.prev[S.prev.length - 1] || "map") : (["stats", "weather", "about"].includes(S.view) ? "profile" : S.view);
  const curN = rail && cur === "map" ? "list" : cur;
  return NAV.filter(([v]) => !(rail && v === "map")).map(([v, i, t]) => v === "create"
    ? `<button class="nav-fab" data-go="create" aria-label="Сообщить о проблеме" title="Сообщить о проблеме">${ico("add_a_photo")}</button>`
    : `<button class="nav-item" data-go="${v}" ${curN === v ? 'aria-current="page"' : ""}><span class="pill">${ico(i)}</span>${rail && v === "list" ? "Обращения" : t}${v === "notif" && unread ? `<span class="nav-badge num">${unread}</span>` : ""}</button>`).join("");
}
function renderNav() {
  $("#bottom-nav").innerHTML = navHtml(false);
  $("#bottom-nav").classList.toggle("hide", ["create", "appeal"].includes(S.view));
  $("#rail").innerHTML = `<span class="brand-mark" title="Карта городских проблем">${ico("location_on", "fill")}</span>` + navHtml(true);
}
function go(view, opts = {}) {
  if (view === "create" && !S.user) { openLogin("Чтобы сообщить о проблеме, войдите — так вы получите уведомления о статусе.", { go: "create" }); return; }
  if (view === S.view && !opts.force) { if (view === "map") { S.selected = null; renderHud(); drawMarkers(); } return; }
  if (!opts.back) S.prev.push(S.view);
  if (S.prev.length > 20) S.prev.shift();
  S.view = view;
  if (view === "create" && !opts.keepDraft) S.draft = { step: 0, photos: [], lat: null, lng: null, address: "", district: "", category: null, description: "", title: "" };
  render();
}
function back() { const v = S.prev.pop() || "map"; S.view = v; render(); }

// ---------- рендер экранов ----------
let placeMap = null, miniMap = null;
function render() {
  renderNav();
  const panel = $("#panel");
  const v = S.view === "map" && isDesktop() ? "list" : S.view;
  if (S.view === "map" && !isDesktop()) { panel.hidden = true; destroySubmaps(); renderHud(); setTimeout(() => map && map.invalidateSize(), 50); return; }
  panel.hidden = false;
  destroySubmaps();
  const fn = { list: viewList, detail: viewDetail, create: viewCreate, notif: viewNotif, profile: viewProfile, stats: viewStats, weather: viewWeather, appeal: viewAppeal, about: viewAbout }[v] || viewList;
  panel.innerHTML = fn();
  const sc = panel.querySelector(".screen"); if (sc) sc.scrollTop = 0;
  afterRender(v);
  renderHud();
  setTimeout(() => map && map.invalidateSize(), 50);
}
function destroySubmaps() { if (placeMap) { placeMap.remove(); placeMap = null; } if (miniMap) { miniMap.remove(); miniMap = null; } }
function topbar(title, { backBtn = true, right = "" } = {}) {
  return `<header class="topbar">${backBtn ? `<button class="icon-btn" data-act="back" aria-label="Назад">${ico("arrow_back")}</button>` : ""}<h1>${title}</h1>${right}</header>`;
}

// Список
function viewList() {
  const f = S.filter;
  return `<div class="screen">
    ${topbar("Обращения", { backBtn: false, right: `<button class="icon-btn" data-go="map" aria-label="Показать на карте">${ico("map")}</button>` })}
    <div class="pad"><input class="input" id="search" type="search" placeholder="Поиск по адресу или описанию" value="${esc(S.search)}" aria-label="Поиск"></div>
    <div class="row" style="overflow-x:auto;padding:12px 16px 4px;scrollbar-width:none">
      ${[["open", "Актуальные"], ["resolved", "Решённые"], ["all", "Все"]].map(([k, t]) => `<button class="chip ${f.status === k ? "on" : ""}" data-status="${k}">${t}</button>`).join("")}
      <button class="chip ${f.mine ? "on" : ""}" data-mine="1">${ico("person")}Мои</button>
      ${CATS.map(c => `<button class="chip ${f.cats.has(c.id) ? "on" : ""}" data-cat="${c.id}">${ico(c.icon)}${esc(c.name)}</button>`).join("")}
    </div>
    <div id="list-results">${listResults()}</div>
  </div>`;
}
function listResults() {
  const items = filtered();
  return `<p class="pad small muted" style="margin:8px 0">${items.length} ${plural(items.length, "обращение", "обращения", "обращений")} · сначала новые</p>
    ${items.length ? `<div class="c-list">${items.map(itemHtml).join("")}</div>` : `<div class="empty">${ico("search_off")}<p>Ничего не найдено. Сбросьте фильтры или сообщите о новой проблеме.</p><button class="btn tonal" data-act="resetfilters">Сбросить фильтры</button></div>`}`;
}
function itemHtml(c) {
  const cat = CAT[c.category];
  return `<button class="c-item" data-open="${c.id}">
    <div class="thumb">${photoHtml(c)}</div>
    <div class="c-body">
      <span class="status st-${c.status}" style="align-self:flex-start">${STATUSES[c.status].name}</span>
      <span class="c-title">${esc(c.title)}</span>
      <span class="c-meta"><span>${ico(cat.icon)} ${esc(cat.name)}</span><span>${ico("thumb_up")} <span class="num">${c.supports}</span></span></span>
      <span class="c-meta"><span>${ico("place")} ${esc(c.address)}</span><span>${fmtDate(c.createdAt)}</span></span>
    </div>
  </button>`;
}

// Детали
function viewDetail() {
  const c = S.complaints.find(x => x.id === S.detailId);
  if (!c) return `<div class="screen">${topbar("Обращение")}<div class="empty">${ico("help")}<p>Обращение не найдено.</p></div></div>`;
  const cat = CAT[c.category];
  const nPh = Math.max(1, c.photos.length);
  const canConfirm = ["resolved_wait", "work", "sent", "published"].includes(c.status);
  const modBtns = S.moderator ? `
    <div class="section-title">Модерация (демо-режим)</div>
    <div class="pad row wrap">
      ${c.status === "moderation" ? `<button class="btn primary" data-mod="published" data-id="${c.id}">${ico("check")}Опубликовать</button><button class="btn outline" data-mod="rejected" data-id="${c.id}">${ico("block")}Отклонить</button>` : ""}
      ${c.status === "published" ? `<button class="btn tonal" data-mod="sent" data-id="${c.id}">${ico("forward_to_inbox")}Передано в организацию</button>` : ""}
      ${["published", "sent"].includes(c.status) ? `<button class="btn tonal" data-mod="work" data-id="${c.id}">${ico("construction")}В работе</button>` : ""}
      ${["sent", "work", "published"].includes(c.status) ? `<button class="btn tonal" data-mod="resolved_wait" data-id="${c.id}">${ico("task_alt")}Отметить решённым</button>` : ""}
    </div>` : "";
  return `<div class="screen">
    <div class="hero">
      ${photoHtml(c, S.detailPhoto, true)}
      <div class="hero-top"><button class="icon-btn" data-act="back" aria-label="Назад">${ico("arrow_back")}</button><button class="icon-btn" data-act="share" data-id="${c.id}" aria-label="Скопировать ссылку">${ico("share")}</button></div>
      ${c.photos.length ? "" : `<span class="hero-label">Иллюстрация категории — фото не приложено (демо-данные)</span>`}
      ${nPh > 1 ? `<div class="hero-dots">${Array.from({ length: nPh }, (_, i) => `<i class="${i === S.detailPhoto ? "on" : ""}" data-photo="${i}"></i>`).join("")}</div>` : ""}
    </div>
    <div class="detail-head">
      <div class="row wrap"><span class="status st-${c.status}">${STATUSES[c.status].name}</span>${c.demo ? `<span class="demo-tag">${ico("science")}пример</span>` : ""}</div>
      <h2>${esc(c.title)}</h2>
      ${c.description ? `<p style="margin:0">${esc(c.description)}</p>` : ""}
    </div>
    <div class="kv">
      ${ico(cat.icon)}<span>${esc(cat.name)}</span>
      ${ico("place")}<span>${esc(c.address)}<br><span class="small muted">${esc(c.district || "")} · ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</span></span>
      ${ico("schedule")}<span>${fmtDate(c.createdAt)} · автор: ${esc(c.mine ? "вы" : c.author)}</span>
      ${ico("apartment")}<span class="small">Ответственная организация (ориентировочно): ${esc(cat.org)}</span>
    </div>
    <div class="minimap" id="minimap" style="margin-top:14px"></div>
    <div class="actions">
      <button class="btn ${c.supportedByMe ? "on" : "tonal"}" data-act="support" data-id="${c.id}" ${c.mine || !OPEN_STATUSES.includes(c.status) ? "disabled" : ""}>${ico("thumb_up", c.supportedByMe ? "fill" : "")}${c.supportedByMe ? "Поддержано" : "Я тоже видел"}</button>
      <button class="btn outline" data-go="appeal">${ico("description")}Обращение</button>
      ${canConfirm && !c.confirmedByMe ? `<button class="btn outline" data-act="confirm" data-id="${c.id}">${ico("task_alt")}Решено</button><button class="btn outline" data-act="notfixed" data-id="${c.id}" ${c.status !== "resolved_wait" ? "disabled" : ""}>${ico("replay")}Не решено</button>` : ""}
      ${c.confirmedByMe ? `<p class="full small muted" style="margin:0">Вы подтвердили, что проблема решена. Подтверждений: ${c.confirms} из ${CONFIRM_NEED}.</p>` : ""}
    </div>
    <div class="support-box"><b class="num">${c.supports}</b><span class="small">${plural(c.supports, "житель поддержал", "жителя поддержали", "жителей поддержали")} это обращение${c.status === "resolved_wait" ? `<br>Подтверждений решения: ${c.confirms} из ${CONFIRM_NEED}` : ""}</span></div>
    ${modBtns}
    <div class="section-title">История статусов</div>
    <ol class="timeline">${c.history.map(h => `<li><b>${STATUSES[h.status].name}</b><div class="small muted">${fmtDate(h.at)} · ${esc(h.by)}</div>${h.comment ? `<div class="small">${esc(h.comment)}</div>` : ""}</li>`).join("")}</ol>
    <div class="pad"><button class="btn text" data-act="report" data-id="${c.id}">${ico("flag")}Пожаловаться на обращение</button></div>
  </div>`;
}
function appealText(c) {
  const cat = CAT[c.category];
  return `Прошу принять меры по проблеме «${c.title}».\n\nКатегория: ${cat.name}.\nАдрес: г. Красноярск, ${c.address} (${c.district || "район не определён"}).\nКоординаты: ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}.\nДата обнаружения: ${new Date(c.createdAt).toLocaleDateString("ru-RU")}.\n\n${c.description || ""}\n\nПроблему подтвердили ${c.supports + 1} ${plural(c.supports + 1, "житель", "жителя", "жителей")} в приложении «Карта городских проблем».`;
}
function viewAppeal() {
  const c = S.complaints.find(x => x.id === S.detailId);
  return `<div class="screen no-nav">
    ${topbar("Официальное обращение")}
    <p class="step-sub">Приложение не отправляет обращения в органы власти. Скопируйте текст и подайте его через платформу «Госуслуги. Решаем вместе» — там ответ обязателен в течение 30 дней.</p>
    <div class="appeal" id="appeal-text">${esc(appealText(c))}</div>
    <div class="stack" style="padding:16px">
      <button class="btn primary block" data-act="copyappeal">${ico("content_copy")}Скопировать текст</button>
      <a class="btn outline block" href="https://pos.gosuslugi.ru/" target="_blank" rel="noopener">${ico("open_in_new")}Открыть «Решаем вместе»</a>
      ${c.status === "published" && c.mine ? `<button class="btn text" data-act="marksent" data-id="${c.id}">Я отправил обращение — отметить «Передано»</button>` : ""}
    </div>
  </div>`;
}

// Мастер создания
const STEP_TITLES = ["Фото проблемы", "Где это?", "Что случилось?", "Описание", "Проверка"];
function viewCreate() {
  const d = S.draft;
  const steps = `<div class="steps" aria-label="Шаг ${d.step + 1} из 5">${STEP_TITLES.map((_, i) => `<i class="${i <= d.step ? "on" : ""}"></i>`).join("")}</div>`;
  const head = topbar(`Новое обращение <span class="small muted num" style="font-weight:400">· шаг ${d.step + 1} из 5</span>`, { right: `<button class="icon-btn" data-act="cancelcreate" aria-label="Отменить">${ico("close")}</button>`, backBtn: d.step > 0 });
  let body = "", nextOk = true, nextLabel = "Далее";
  if (d.step === 0) {
    body = `<h2 class="step-title">Сфотографируйте проблему</h2><p class="step-sub">До трёх фото. Не снимайте лица людей и номера машин — такие фото не пройдут модерацию.</p>
      <div class="photo-grid">
        ${d.photos.map((p, i) => `<div class="photo-slot"><img src="${p}" alt="Фото ${i + 1}"><button class="rm" data-rmphoto="${i}" aria-label="Удалить фото">${ico("close")}</button></div>`).join("")}
        ${d.photos.length < 3 ? `<label class="photo-slot add" for="photo-camera">${ico("photo_camera")}<span>Снять фото</span></label><label class="photo-slot add" for="photo-input">${ico("photo_library")}<span>Из галереи</span></label>` : ""}
      </div>
      <input id="photo-camera" type="file" accept="image/*" capture="environment" hidden>
      <input id="photo-input" type="file" accept="image/*" multiple hidden>
      <div class="pad" style="margin-top:12px"><button class="btn text" data-act="demophoto">${ico("image")}Нет фото под рукой — добавить демо-иллюстрацию</button></div>`;
    nextOk = d.photos.length > 0;
  } else if (d.step === 1) {
    body = `<h2 class="step-title">Отметьте место</h2><p class="step-sub">Передвиньте карту так, чтобы метка указывала на проблему.</p>
      <div class="place-map"><div id="placemap" style="position:absolute;inset:0"></div><div class="place-pin">${ico("location_on", "fill")}</div></div>
      <div class="addr-box">${ico("place")}<div class="grow"><b id="addr-line">${esc(d.address || "Определяем адрес…")}</b><div class="small muted" id="addr-sub">${d.lat ? `${esc(d.district || "")} · ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : ""}</div></div></div>
      <div class="pad" style="margin-top:8px"><button class="btn text" data-act="geolocate">${ico("my_location")}Определить моё местоположение</button></div>
      <p class="pad hint" id="geo-hint"></p>`;
    nextOk = !!d.lat && inKrsk(d) && !!d.address;
  } else if (d.step === 2) {
    body = `<h2 class="step-title">Выберите категорию</h2><p class="step-sub">От категории зависит, какой организации будет адресовано обращение.</p>
      <div class="cat-grid">${CATS.map(c => `<button class="cat-btn" data-pickcat="${c.id}" aria-pressed="${d.category === c.id}"><span class="cat-ico" style="background:${c.color}">${ico(c.icon, "fill")}</span>${esc(c.name)}</button>`).join("")}</div>`;
    nextOk = !!d.category;
  } else if (d.step === 3) {
    body = `<h2 class="step-title">Опишите проблему</h2><p class="step-sub">Коротко: что, где именно и почему опасно. Можно пропустить подробности.</p>
      <div class="stack pad">
        <div class="field"><label for="f-title">Заголовок</label><input class="input" id="f-title" maxlength="80" value="${esc(d.title)}" placeholder="Например: Яма на въезде во двор"></div>
        <div class="field"><label for="f-desc">Подробности (необязательно)</label><textarea class="input" id="f-desc" maxlength="500" placeholder="Яма около 40 см, после дождя не видна">${esc(d.description)}</textarea><span class="hint num" id="desc-count">${d.description.length} / 500</span></div>
      </div>`;
    nextOk = d.title.trim().length >= 5;
  } else if (d.step === 4) {
    const dups = S.complaints.filter(c => c.category === d.category && OPEN_STATUSES.concat("moderation").includes(c.status) && distM(c, d) <= 30);
    const cat = CAT[d.category];
    body = `<h2 class="step-title">Проверьте и отправьте</h2>
      ${dups.length ? `<div class="dup card" style="padding:14px;border-color:var(--warn);background:var(--warn-soft)"><div class="row" style="align-items:flex-start">${ico("info", "fill")}<div class="grow stack" style="gap:8px"><b>Рядом уже есть похожее обращение</b><span class="small">В радиусе 30 м: «${esc(dups[0].title)}». Поддержите его — так проблему решат быстрее.</span><div class="row wrap"><button class="btn primary" data-act="supportdup" data-id="${dups[0].id}">${ico("thumb_up")}Поддержать</button><button class="btn outline" data-open="${dups[0].id}">Открыть</button></div></div></div></div>` : ""}
      <div class="c-list" style="margin-top:12px"><div class="c-item" style="cursor:default"><div class="thumb"><img src="${d.photos[0]}" alt=""></div><div class="c-body"><span class="c-title">${esc(d.title)}</span><span class="c-meta">${ico(cat.icon)} ${esc(cat.name)}</span><span class="c-meta">${ico("place")} ${esc(d.address)}</span></div></div></div>
      <p class="pad small muted" style="margin-top:12px">После отправки обращение проверит модератор. Публично отображается только ваш никнейм «${esc(S.user?.nick)}».</p>`;
    nextLabel = dups.length ? "Всё равно отправить" : "Отправить";
  } else if (d.step === 5) {
    return `<div class="screen no-nav">${topbar("Готово", { backBtn: false })}<div class="success"><div class="big">${ico("check_circle", "fill")}</div><h2 class="step-title" style="margin:0">Обращение отправлено на модерацию</h2><p class="muted" style="margin:0">Обычно проверка занимает до 24 часов. Мы пришлём уведомление, когда обращение появится на карте.</p>
      <div class="stack" style="width:100%;max-width:360px;margin-top:8px"><button class="btn primary block" data-open="${d.createdId}">Открыть обращение</button><button class="btn tonal block" data-act="toappeal" data-id="${d.createdId}">${ico("description")}Подготовить официальное обращение</button><button class="btn text" data-go="map">На карту</button></div></div></div>`;
  }
  return `<div class="screen no-nav">${head}${steps}${body}<div class="wizard-foot">${d.step > 0 ? `<button class="btn outline" data-act="back">Назад</button>` : ""}<button class="btn ${d.step === 4 ? "accent" : "primary"}" data-act="next" ${nextOk ? "" : "disabled"}>${nextLabel}</button></div></div>`;
}

// Уведомления
function viewNotif() {
  const ns = [...S.notifications].sort((a, b) => b.at - a.at);
  return `<div class="screen">${topbar("Уведомления", { backBtn: false, right: ns.some(n => !n.read) ? `<button class="btn text" data-act="readall">Прочитать все</button>` : "" })}
    ${ns.length ? ns.map(n => { const cat = CAT[n.cat] || CAT.other; return `<button class="notif ${n.read ? "" : "unread"}" data-notif="${n.id}"><span class="cat-ico" style="background:${cat.color}">${ico(cat.icon, "fill")}</span><span><span style="display:block">${esc(n.text)}</span><span class="small muted">${fmtDate(n.at)}</span></span></button>`; }).join("") : `<div class="empty">${ico("notifications_off")}<p>Пока нет уведомлений. Здесь появятся изменения статусов ваших и поддержанных обращений.</p></div>`}
  </div>`;
}

// Профиль
function viewProfile() {
  if (!S.user) return `<div class="screen">${topbar("Профиль", { backBtn: false })}<div class="empty">${ico("account_circle")}<p>Войдите, чтобы сообщать о проблемах и получать уведомления о статусе.</p><button class="btn primary" data-act="login">Войти</button></div>${settingsHtml()}</div>`;
  const mine = S.complaints.filter(c => c.mine);
  const solved = mine.filter(c => c.status === "resolved" || c.status === "resolved_wait").length;
  const supported = S.complaints.filter(c => c.supportedByMe).length;
  return `<div class="screen">${topbar("Профиль", { backBtn: false })}
    <div class="profile-head"><div class="avatar">${esc(S.user.nick[0].toUpperCase())}</div><div class="grow"><b style="font-size:18px">${esc(S.user.nick)}</b><div class="small muted">Вход через ${esc(S.user.provider)} · ${CITY.name}</div></div></div>
    <div class="stat-row"><div class="stat"><b class="num">${mine.length}</b><span>${plural(mine.length, "обращение", "обращения", "обращений")}</span></div><div class="stat"><b class="num">${solved}</b><span>решено</span></div><div class="stat"><b class="num">${supported}</b><span>поддержано</span></div></div>
    <div class="section-title">Мои обращения</div>
    ${mine.length ? `<div class="c-list">${mine.sort((a, b) => b.createdAt - a.createdAt).map(itemHtml).join("")}</div>` : `<p class="pad muted">Вы ещё не сообщали о проблемах.</p>`}
    ${settingsHtml()}
  </div>`;
}
function settingsHtml() {
  const theme = ls.get("theme", "system");
  return `<div class="section-title">Разделы</div>
    <div class="list-group">
      <button class="list-row" data-go="stats">${ico("bar_chart")}<span class="grow">Статистика по району</span>${ico("chevron_right")}</button>
      <button class="list-row" data-go="weather">${ico("partly_cloudy_day")}<span class="grow">Погода и городские предупреждения</span>${ico("chevron_right")}</button>
      <button class="list-row" data-go="about">${ico("info")}<span class="grow">О приложении и правила публикации</span>${ico("chevron_right")}</button>
    </div>
    <div class="section-title">Настройки</div>
    <div class="list-group">
      <button class="list-row" data-act="theme">${ico("dark_mode")}<span class="grow">Тема оформления</span><span class="small muted">${{ system: "как в системе", light: "светлая", dark: "тёмная" }[theme]}</span></button>
      <button class="list-row" data-act="togglemod" role="switch" aria-checked="${S.moderator}">${ico("shield_person")}<span class="grow">Режим модератора (демо)<br><span class="small muted">Показывает кнопки модерации в карточке обращения</span></span><span class="switch ${S.moderator ? "on" : ""}"></span></button>
      <button class="list-row" data-act="resetdemo">${ico("restart_alt")}<span class="grow">Сбросить демо-данные</span></button>
      ${S.user ? `<button class="list-row" data-act="logout">${ico("logout")}<span class="grow">Выйти</span></button>
      <button class="list-row" data-act="deleteacc" style="color:var(--bad)">${ico("person_remove")}<span class="grow">Удалить учётную запись и мои данные</span></button>` : ""}
    </div>
    <p class="pad tiny muted" style="margin-top:16px">Версия 0.2.0 (прототип) · данные хранятся в локальной базе на этом устройстве</p>`;
}

// Статистика
function viewStats() {
  const all = S.complaints.filter(c => !["duplicate", "rejected"].includes(c.status));
  const total = all.length, solved = all.filter(c => c.status === "resolved").length;
  const open = all.filter(c => OPEN_STATUSES.includes(c.status)).length;
  const sup = all.reduce((a, c) => a + c.supports, 0);
  const byCat = CATS.map(c => [c, all.filter(x => x.category === c.id).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...byCat.map(x => x[1]));
  const byStatus = Object.keys(STATUSES).map(s => [s, all.filter(c => c.status === s).length]).filter(x => x[1]);
  // по дням за 21 день
  const days = 21, today = new Date(); today.setHours(0, 0, 0, 0);
  const counts = Array.from({ length: days }, (_, i) => { const d0 = today.getTime() - (days - 1 - i) * DAY; return all.filter(c => c.createdAt >= d0 && c.createdAt < d0 + DAY).length; });
  const cmax = Math.max(2, ...counts), W = 340, H = 110, pl = 20, pb = 18;
  const x = i => pl + i * (W - pl - 6) / (days - 1), y = v => 8 + (H - pb - 8) * (1 - v / cmax);
  const path = counts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = path + `L${x(days - 1)},${H - pb}L${x(0)},${H - pb}Z`;
  return `<div class="screen">${topbar("Статистика")}
    <p class="step-sub">Октябрьский район и кампус СФУ · все опубликованные обращения</p>
    <div class="kpis"><div class="stat"><b class="num">${total}</b><span>обращений всего</span></div><div class="stat"><b class="num">${open}</b><span>ждут решения</span></div><div class="stat"><b class="num">${Math.round(solved / Math.max(1, total) * 100)}%</b><span>решено и подтверждено</span></div><div class="stat"><b class="num">${sup}</b><span>поддержек жителей</span></div></div>
    <div class="section-title">Новые обращения за 3 недели</div>
    <div class="card" style="margin:0 16px;padding:10px 6px 4px">
      <svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Число новых обращений по дням">
        <line x1="${pl}" x2="${W - 6}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>
        <line x1="${pl}" x2="${W - 6}" y1="${y(cmax)}" y2="${y(cmax)}" stroke="var(--line)" stroke-dasharray="3 3"/>
        <text x="2" y="${y(cmax) + 4}" font-size="10" fill="var(--fg-3)">${cmax}</text><text x="2" y="${y(0) + 4}" font-size="10" fill="var(--fg-3)">0</text>
        <path d="${area}" fill="var(--primary-soft)"/><path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2"/>
        <circle cx="${x(days - 1)}" cy="${y(counts[days - 1])}" r="3.5" fill="var(--primary)"/>
        <text x="${pl}" y="${H - 4}" font-size="10" fill="var(--fg-3)">${new Date(today.getTime() - 20 * DAY).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</text><text x="${W - 6}" y="${H - 4}" font-size="10" fill="var(--fg-3)" text-anchor="end">сегодня</text>
      </svg>
    </div>
    <div class="section-title">По категориям</div>
    <div class="card" style="margin:0 16px"><div class="bars">${byCat.map(([c, n]) => `<div class="bar-row"><span>${esc(c.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${n / max * 100}%;background:${c.color}"></div></div><b class="num" style="text-align:right">${n}</b></div>`).join("")}</div></div>
    <div class="section-title">По статусам</div>
    <div class="pad row wrap">${byStatus.map(([s, n]) => `<span class="status st-${s}">${STATUSES[s].name}: <span class="num">${n}</span></span>`).join("")}</div>
    <p class="api-note">В рабочей версии эти показатели строятся в Yandex DataLens по обезличенным данным сервера.</p>
  </div>`;
}

// Погода
function viewWeather() {
  const w = S.weather;
  if (!w) return `<div class="screen">${topbar("Погода")}<div class="empty">${ico("cloud_off")}<p>Данные о погоде пока не загружены.</p></div></div>`;
  const c = w.current, now = wmo(c.weather_code, c.is_day);
  const t0 = new Date(c.time).getTime();
  const hrs = (w.hourly.time || []).map((t, i) => ({ t: new Date(t).getTime(), temp: w.hourly.temperature_2m[i], code: w.hourly.weather_code[i], p: w.hourly.precipitation_probability?.[i] })).filter(h => h.t >= t0 - 36e5).slice(0, 24);
  const risk = iceRisk(w);
  const src = S.weatherLive ? `обновлено ${fmtDate(w._fetchedAt || Date.now())}` : `сохранённые данные на ${new Date(c.time).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`;
  return `<div class="screen">${topbar("Погода в Красноярске", { right: `<button class="icon-btn" data-act="refreshwx" aria-label="Обновить">${ico("refresh")}</button>` })}
    <div class="wx-now"><div><div class="t num">${c.temperature_2m > 0 ? "+" : ""}${Math.round(c.temperature_2m)}°</div><div style="font-weight:600;margin-top:6px">${esc(now.text)}</div><small>Ощущается как ${Math.round(c.apparent_temperature)}° · ветер ${c.wind_speed_10m.toFixed(1)} м/с · влажность ${c.relative_humidity_2m}%</small></div>${ico(now.icon)}</div>
    ${risk ? `<div class="card" style="margin:12px 16px 0;padding:12px 14px;background:var(--warn-soft);border-color:transparent"><div class="row" style="align-items:flex-start">${ico("warning", "fill")}<span class="small">${esc(risk)}</span></div></div>` : `<div class="card" style="margin:12px 16px 0;padding:12px 14px"><div class="row">${ico("verified")}<span class="small">Погодных предупреждений для городской среды нет.</span></div></div>`}
    <div class="section-title">Ближайшие 24 часа</div>
    <div class="hours">${hrs.map(h => { const ww = wmo(h.code, new Date(h.t).getHours() >= 7 && new Date(h.t).getHours() < 19); return `<div class="hour"><span class="muted num">${new Date(h.t).getHours().toString().padStart(2, "0")}:00</span>${ico(ww.icon)}<b class="num">${h.temp > 0 ? "+" : ""}${Math.round(h.temp)}°</b>${h.p ? `<span class="tiny muted num">${h.p}%</span>` : `<span class="tiny muted">&nbsp;</span>`}</div>`; }).join("")}</div>
    <div class="section-title">3 дня</div>
    <div class="list-group days">${w.daily.time.map((d, i) => { const ww = wmo(w.daily.weather_code[i]); return `<div class="list-row">${ico(ww.icon)}<span class="grow">${i === 0 ? "Сегодня" : new Date(d).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "short" })}<br><span class="small muted">${esc(ww.text)}</span></span><b class="num">${Math.round(w.daily.temperature_2m_max[i])}°</b><span class="muted num">${Math.round(w.daily.temperature_2m_min[i])}°</span></div>`; }).join("")}</div>
    <p class="api-note">Источник: открытый API Open-Meteo (open-meteo.com), ${src}.</p>
  </div>`;
}

function viewAbout() {
  return `<div class="screen">${topbar("О приложении")}
    <div class="pad stack">
      <p style="margin:0">«Карта городских проблем» помогает жителям Красноярска сообщать о проблемах городской среды, видеть их на карте и доводить до решения.</p>
      <div class="card" style="padding:14px"><b>Это не официальный канал обращений</b><p class="small" style="margin:6px 0 0">Публикация на карте не является обращением в орган власти. Для официального ответа используйте кнопку «Обращение» в карточке — она готовит текст для платформы «Госуслуги. Решаем вместе».</p></div>
      <b>Правила публикации</b>
      <ul class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px"><li>Одна проблема — одно обращение с реальным фото.</li><li>На фото не должно быть узнаваемых лиц и номеров автомобилей.</li><li>Без оскорблений, рекламы и политической агитации.</li><li>Не более 5 обращений в час.</li></ul>
      <b>Открытые данные и сервисы</b>
      <p class="small" style="margin:0">Карта © участники OpenStreetMap. Погода — Open-Meteo. Адреса — геокодер Nominatim (OpenStreetMap).</p>
      <p class="small muted" style="margin:0">Учебный проект СФУ, Институт управления бизнес-процессами, 2026. Команда: Д. Д. Кутненко, Т. А. Гончаров, Е. В. Эбель.</p>
    </div></div>`;
}

// ---------- после рендера: карты в экранах, поля ввода ----------
function afterRender(v) {
  if (v === "detail") {
    const c = S.complaints.find(x => x.id === S.detailId);
    if (c && typeof L !== "undefined" && $("#minimap")) {
      miniMap = L.map("minimap", { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, attributionControl: false }).setView([c.lat, c.lng], 16);
      makeBase(miniMap);
      L.marker([c.lat, c.lng], { icon: pinIcon(c, true) }).addTo(miniMap);
      if (map) { map.setView([c.lat, c.lng], Math.max(map.getZoom(), 16), { animate: true }); S.selected = c.id; drawMarkers(); }
    }
  }
  if (v === "create") {
    const d = S.draft;
    if (d.step === 0) { $("#photo-input")?.addEventListener("change", onPhotos); $("#photo-camera")?.addEventListener("change", onPhotos); }
    if (d.step === 1 && typeof L !== "undefined") {
      const start = d.lat ? [d.lat, d.lng] : (map ? [map.getCenter().lat, map.getCenter().lng] : [CAMPUS.lat, CAMPUS.lng]);
      placeMap = L.map("placemap", { zoomControl: false, attributionControl: false }).setView(start, 17);
      makeBase(placeMap);
      const upd = () => { const c = placeMap.getCenter(); d.lat = c.lat; d.lng = c.lng; d.address = ""; $("#addr-line").textContent = "Определяем адрес…"; $("#addr-sub").textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`; geocodeDebounced(); updateNext(); };
      placeMap.on("moveend", upd);
      if (!d.lat) upd(); else updateNext();
    }
    if (d.step === 3) {
      $("#f-title").addEventListener("input", e => { d.title = e.target.value; updateNext(); });
      $("#f-desc").addEventListener("input", e => { d.description = e.target.value; $("#desc-count").textContent = `${d.description.length} / 500`; });
      if (!d.title) { d.title = ""; }
      setTimeout(() => $("#f-title")?.focus(), 50);
    }
  }
  if (v === "list") $("#search")?.addEventListener("input", e => { S.search = e.target.value; $("#list-results").innerHTML = listResults(); drawMarkers(); renderHud(); });
}
function updateNext() {
  const d = S.draft, b = $('[data-act="next"]'); if (!b) return;
  const ok = d.step === 1 ? (!!d.lat && inKrsk(d) && !!d.address) : d.step === 3 ? d.title.trim().length >= 5 : true;
  b.disabled = !ok;
  const hint = $("#geo-hint"); if (hint && d.step === 1) hint.textContent = d.lat && !inKrsk(d) ? "Точка за пределами Красноярска — приложение принимает обращения только по городу." : "";
}
let geoTimer = null, geoSeq = 0;
function geocodeDebounced() { clearTimeout(geoTimer); geoTimer = setTimeout(reverseGeocode, 700); }
async function fetchJSON(url, ms = 4500) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); } finally { clearTimeout(t); }
}
// Обратное геокодирование: Nominatim (OSM) → Photon (OSM, komoot) → ближайшее известное обращение.
async function geocodePoint(lat, lng) {
  try {
    const j = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=ru&lat=${lat}&lon=${lng}`);
    const a = j.address || {};
    const road = a.road || a.pedestrian || a.footway || a.path || a.neighbourhood || a.suburb || "";
    const addr = road ? road + (a.house_number ? ", " + a.house_number : "") : (j.name || "");
    if (addr) return { address: addr, district: a.city_district || a.suburb || "", source: "nominatim" };
  } catch {}
  try {
    const j = await fetchJSON(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
    const p = (j.features && j.features[0] && j.features[0].properties) || {};
    const addr = p.street ? p.street + (p.housenumber ? ", " + p.housenumber : "") : (p.name || "");
    if (addr) return { address: addr, district: p.district || "", source: "photon" };
  } catch {}
  const pt = { lat, lng };
  const near = S.complaints.slice().sort((a, b) => distM(a, pt) - distM(b, pt))[0];
  if (near && distM(near, pt) < 300) return { address: "рядом с: " + near.address, district: near.district, source: "local" };
  return { address: "Точка на карте (адрес не определён)", district: "", source: "none" };
}
async function reverseGeocode() {
  const d = S.draft; if (!d || !d.lat) return; const seq = ++geoSeq;
  const g = await geocodePoint(d.lat, d.lng);
  if (seq !== geoSeq || !S.draft) return;
  d.address = g.address; d.district = g.district;
  const l = $("#addr-line"), s = $("#addr-sub");
  if (l) l.textContent = d.address;
  if (s) s.textContent = `${g.district ? g.district + " · " : ""}${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`;
  updateNext();
}
async function onPhotos(e) {
  const files = [...e.target.files].slice(0, 3 - S.draft.photos.length);
  for (const f of files) { try { S.draft.photos.push(await compress(f)); } catch { toast("Не удалось прочитать файл. Выберите фото в формате JPEG, PNG или HEIC."); } }
  render();
}
function compress(file, max = 1280) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); res(cv.toDataURL("image/jpeg", 0.8)); }; img.onerror = rej; img.src = r.result; };
    r.onerror = rej; r.readAsDataURL(file);
  });
}
function demoPhoto() {
  const cv = document.createElement("canvas"); cv.width = 800; cv.height = 600; const g = cv.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 800, 600); grd.addColorStop(0, "#9fb3b5"); grd.addColorStop(1, "#4d6466"); g.fillStyle = grd; g.fillRect(0, 0, 800, 600);
  g.fillStyle = "#3a4a4b"; g.fillRect(0, 380, 800, 220); g.fillStyle = "#26302f"; g.beginPath(); g.ellipse(400, 470, 170, 55, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,.9)"; g.font = "600 34px Golos Text, sans-serif"; g.textAlign = "center"; g.fillText("Демо-иллюстрация", 400, 120); g.font = "24px Golos Text, sans-serif"; g.fillText("вместо фото проблемы", 400, 160);
  return cv.toDataURL("image/jpeg", 0.8);
}

// ---------- действия ----------
async function saveC(c) { c.updatedAt = Date.now(); await DB.put("complaints", c); }
async function notify(c, text) { const n = { id: uid(), complaintId: c.id, text, at: Date.now(), read: false, cat: c.category }; S.notifications.push(n); await DB.put("notifications", n); renderNav(); }
async function setStatus(c, status, by, comment) {
  c.status = status; c.history.unshift({ status, at: Date.now(), by, comment });
  await saveC(c);
  if (c.mine || c.supportedByMe) await notify(c, `Обращение «${c.title}»: ${STATUSES[status].name.toLowerCase()}`);
}
async function submitDraft() {
  const d = S.draft;
  const recent = S.complaints.filter(c => c.mine && Date.now() - c.createdAt < 36e5).length;
  if (recent >= 5) { toast("Можно отправить не более 5 обращений в час. Попробуйте позже."); return; }
  const c = { id: uid(), demo: false, title: d.title.trim(), category: d.category, description: d.description.trim(), lat: d.lat, lng: d.lng, address: d.address, district: d.district, status: "moderation", createdAt: Date.now(), updatedAt: Date.now(), photos: d.photos, author: S.user.nick, mine: true, supports: 0, supportedByMe: false, confirms: 0, confirmedByMe: false, history: [{ status: "moderation", at: Date.now(), by: "Вы", comment: "Обращение создано" }] };
  S.complaints.push(c); await DB.put("complaints", c);
  await notify(c, `Обращение «${c.title}» отправлено на модерацию`);
  d.createdId = c.id; d.step = 5; render(); drawMarkers();
  // В прототипе модерацию имитирует таймер; в рабочей версии решение принимает модератор.
  setTimeout(async () => { const x = S.complaints.find(y => y.id === c.id); if (x && x.status === "moderation" && !S.moderator) { await setStatus(x, "published", "Модератор", "Проверено модератором и опубликовано (демо: автоматически)"); toast("Ваше обращение опубликовано на карте"); drawMarkers(); if (["detail", "profile", "list", "notif"].includes(S.view)) render(); else renderHud(); } }, 15000);
}
function toast(msg) { const t = $("#toast-root"); t.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => t.innerHTML = "", 3200); }
function openDetail(id) { S.detailId = id; S.detailPhoto = 0; go("detail", { force: true }); }
function applyTheme() { const t = ls.get("theme", "system"); if (t === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); }

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-go],[data-act],[data-open],[data-status],[data-cat],[data-mine],[data-pickcat],[data-rmphoto],[data-mod],[data-notif],[data-photo],[data-onb]");
  if (!el) return;
  const ds = el.dataset;
  if (ds.go) { if (ds.go === "appeal" && S.view !== "detail") return; S.selected = ds.go === "map" ? S.selected : null; go(ds.go); return; }
  if (ds.open) { openDetail(ds.open); return; }
  if (ds.status) { S.filter.status = ds.status; refreshAll(); return; }
  if (ds.mine) { S.filter.mine = !S.filter.mine; refreshAll(); return; }
  if (ds.cat) { const s = S.filter.cats; s.has(ds.cat) ? s.delete(ds.cat) : s.add(ds.cat); refreshAll(); return; }
  if (ds.pickcat) { S.draft.category = ds.pickcat; render(); return; }
  if (ds.rmphoto) { S.draft.photos.splice(+ds.rmphoto, 1); render(); return; }
  if (ds.photo) { S.detailPhoto = +ds.photo; render(); return; }
  if (ds.notif) { const n = S.notifications.find(x => x.id === ds.notif); if (n) { n.read = true; await DB.put("notifications", n); openDetail(n.complaintId); } return; }
  if (ds.onb) { onbStep(+ds.onb); return; }
  if (ds.mod) { const c = S.complaints.find(x => x.id === ds.id); const notes = { published: "Проверено модератором и опубликовано", rejected: "Нарушены правила публикации", sent: "Обращение направлено: " + CAT[c.category].org, work: "Организация сообщила о начале работ", resolved_wait: "Отмечено как решённое, ждём подтверждения жителей" }; await setStatus(c, ds.mod, "Модератор", notes[ds.mod]); toast("Статус изменён: " + STATUSES[ds.mod].name); render(); drawMarkers(); return; }
  const c = ds.id ? S.complaints.find(x => x.id === ds.id) : null;
  switch (ds.act) {
    case "back": if (S.view === "create" && S.draft.step > 0 && S.draft.step < 5) { S.draft.step--; render(); } else back(); break;
    case "next": {
      const d = S.draft;
      if (d.step === 3) { d.title = $("#f-title").value; d.description = $("#f-desc").value; }
      if (d.step === 4) { await submitDraft(); return; }
      d.step++; render(); break;
    }
    case "cancelcreate": S.draft = null; back(); break;
    case "demophoto": S.draft.photos.push(demoPhoto()); render(); break;
    case "geolocate":
      if (!navigator.geolocation) { $("#geo-hint").textContent = "Геолокация недоступна. Передвиньте карту вручную."; break; }
      $("#geo-hint").textContent = "Определяем местоположение…";
      navigator.geolocation.getCurrentPosition(p => { placeMap && placeMap.setView([p.coords.latitude, p.coords.longitude], 18); $("#geo-hint").textContent = p.coords.accuracy > 50 ? `Точность около ${Math.round(p.coords.accuracy)} м — уточните метку вручную.` : ""; }, () => { $("#geo-hint").textContent = "Не удалось определить местоположение. Передвиньте карту вручную."; }, { enableHighAccuracy: true, timeout: 8000 });
      break;
    case "support":
      if (!S.user) { openLogin("Войдите, чтобы поддержать обращение.", { click: `[data-act="support"][data-id="${c.id}"]` }); break; }
      c.supportedByMe = !c.supportedByMe; c.supports += c.supportedByMe ? 1 : -1; await saveC(c);
      toast(c.supportedByMe ? "Вы поддержали обращение. Сообщим об изменениях статуса." : "Поддержка отменена");
      if (S.view === "map" || (isDesktop() && S.view === "list")) { renderHud(); drawMarkers(); } if (S.view !== "map") render(); break;
    case "supportdup":
      if (!c.supportedByMe) { c.supportedByMe = true; c.supports++; await saveC(c); }
      S.draft = null; toast("Спасибо! Вы поддержали существующее обращение."); openDetail(c.id); break;
    case "confirm":
      if (!S.user) { openLogin("Войдите, чтобы подтвердить решение.", { click: `[data-act="confirm"][data-id="${c.id}"]` }); break; }
      c.confirmedByMe = true; c.confirms++;
      if (c.status !== "resolved_wait") { c.status = "resolved_wait"; c.history.unshift({ status: "resolved_wait", at: Date.now(), by: S.user.nick, comment: "Житель сообщил, что проблема решена" }); }
      if (c.confirms >= CONFIRM_NEED) await setStatus(c, "resolved", "Жители", `Решение подтвердили ${c.confirms} жителя`); else await saveC(c);
      toast(c.status === "resolved" ? "Проблема отмечена как решённая" : `Спасибо! Подтверждений: ${c.confirms} из ${CONFIRM_NEED}`); render(); drawMarkers(); break;
    case "notfixed": c.confirms = 0; await setStatus(c, "published", S.user?.nick || "Житель", "Житель сообщил, что проблема не решена"); toast("Обращение снова в списке актуальных"); render(); drawMarkers(); break;
    case "toappeal": S.detailId = ds.id; S.prev.push("detail"); S.view = "appeal"; render(); break;
    case "copyappeal": { const txt = $("#appeal-text").textContent; try { await navigator.clipboard.writeText(txt); toast("Текст скопирован"); } catch { const r = document.createRange(); r.selectNodeContents($("#appeal-text")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Текст выделен — скопируйте его"); } break; }
    case "marksent": await setStatus(c, "sent", S.user.nick, "Автор подал официальное обращение через «Решаем вместе»"); toast("Статус: передано в организацию"); back(); break;
    case "share": { const t = `${c.title} — ${c.address}, Красноярск`; try { await navigator.clipboard.writeText(t); toast("Описание скопировано"); } catch { toast(t); } break; }
    case "report": openModal(`<h3>Пожаловаться на обращение</h3><p class="small muted" style="margin:0">Модератор проверит обращение и скроет его, если оно нарушает правила.</p>
      <div class="stack" style="gap:8px">${["Недостоверная информация", "На фото узнаваемые люди или номера машин", "Оскорбления или реклама", "Проблема уже решена", "Дубликат другого обращения"].map((r, i) => `<label class="row"><input type="radio" name="rep" value="${i}" ${i === 0 ? "checked" : ""} style="width:20px;height:20px;margin:0"> <span>${r}</span></label>`).join("")}</div>
      <div class="row"><button class="btn outline grow" data-act="closemodal">Отмена</button><button class="btn primary grow" data-act="sendreport">Отправить</button></div>`); break;
    case "sendreport": closeModal(); toast("Жалоба отправлена модератору. Спасибо!"); break;
    case "closesheet": S.selected = null; renderHud(); drawMarkers(); break;
    case "zoomin": map && map.zoomIn(); break;
    case "zoomout": map && map.zoomOut(); break;
    case "locate":
      if (!navigator.geolocation) { toast("Геолокация недоступна на этом устройстве"); break; }
      navigator.geolocation.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 16), () => { toast("Не удалось определить местоположение — показываем район СФУ"); map.setView([CAMPUS.lat, CAMPUS.lng], CAMPUS.zoom); }, { timeout: 8000 });
      break;
    case "resetfilters": S.filter = { cats: new Set(), status: "all", mine: false }; S.search = ""; refreshAll(); break;
    case "readall": S.notifications.forEach(n => { n.read = true; }); render(); for (const n of S.notifications) await DB.put("notifications", n); break;
    case "login": openLogin(); break;
    case "logout": S.user = null; ls.set("user", null); toast("Вы вышли из учётной записи"); render(); break;
    case "deleteacc": openModal(`<h3>Удалить учётную запись?</h3><p class="muted" style="margin:0">Будут удалены ваш профиль и созданные вами обращения на этом устройстве. Действие нельзя отменить.</p><div class="row"><button class="btn outline grow" data-act="closemodal">Отмена</button><button class="btn grow" style="background:var(--bad);color:var(--surface)" data-act="confirmdelete">Удалить</button></div>`); break;
    case "confirmdelete": for (const x of S.complaints.filter(x => x.mine && !x.demo)) await DB.del("complaints", x.id); S.complaints = S.complaints.filter(x => !(x.mine && !x.demo)); S.user = null; ls.set("user", null); closeModal(); toast("Учётная запись и ваши данные удалены"); render(); drawMarkers(); break;
    case "togglemod": S.moderator = !S.moderator; ls.set("moderator", S.moderator); render(); drawMarkers(); break;
    case "theme": { const order = ["system", "light", "dark"]; const t = ls.get("theme", "system"); ls.set("theme", order[(order.indexOf(t) + 1) % 3]); applyTheme(); render(); break; }
    case "resetdemo": await DB.clear("complaints"); await DB.clear("notifications"); await bootData(true); toast("Демо-данные восстановлены"); render(); drawMarkers(); break;
    case "refreshwx": toast("Обновляем погоду…"); loadWeather(); break;
    case "closemodal": closeModal(); break;
    case "vk": case "ya": doLogin(ds.act === "vk" ? "VK ID" : "Яндекс ID"); break;
    case "dologin": finishLogin(); break;
    case "skiplogin": closeOverlay(); break;
  }
});
function refreshAll() { drawMarkers(); if (S.view === "map") renderHud(); else render(); }

// ---------- онбординг и вход ----------
const ONB = [
  { icon: "add_location_alt", color: "var(--primary)", title: "Увидели яму, свалку или наледь?", text: "Сфотографируйте и отметьте место — на обращение уходит меньше минуты." },
  { icon: "groups", color: "#2f7fb5", title: "Объединяемся с соседями", text: "Поддерживайте обращения других жителей и подтверждайте, когда проблему решили." },
  { icon: "gavel", color: "#b3471d", title: "Это не официальный канал", text: "Карта делает проблемы видимыми. Для официального ответа приложение подготовит текст обращения для «Госуслуги. Решаем вместе»." },
];
function onbStep(i) {
  if (i >= ONB.length) { S.onboarded = true; ls.set("onboarded", true); if (!S.user) openLogin(); else closeOverlay(); return; }
  const o = ONB[i];
  $("#overlay-root").innerHTML = `<div class="overlay"><div class="onb">
    <div class="row" style="justify-content:space-between"><div class="dots">${ONB.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div><button class="btn text" data-onb="3">Пропустить</button></div>
    <div class="onb-art" style="background:${o.color}">${ico(o.icon, "fill")}</div>
    <h2>${o.title}</h2><p>${o.text}</p>
    ${i === 2 ? `<p class="small muted" style="margin:0">Приложению понадобятся доступ к камере, геолокации и уведомлениям — система спросит разрешение в момент использования.</p>` : ""}
    <button class="btn primary block" data-onb="${i + 1}">${i < 2 ? "Далее" : "Начать"}</button>
  </div></div>`;
}
function openLogin(reason, pending) {
  S.pending = pending || null;
  $("#overlay-root").innerHTML = `<div class="overlay"><div class="onb" style="justify-content:flex-start">
    <div class="login-logo"><span class="brand-mark">${ico("location_on", "fill")}</span><span class="small muted">Красноярск</span></div>
    <h2 class="login-title">Карта городских проблем</h2>
    <p>${esc(reason || "Войдите, чтобы сообщать о проблемах, поддерживать обращения соседей и получать уведомления о статусе.")}</p>
    <div class="stack" style="margin-top:8px">
      <button class="btn vk block" data-act="vk"><span class="idmark">VK</span>Войти через VK ID</button>
      <button class="btn ya block" data-act="ya"><span class="idmark">Я</span>Войти через Яндекс ID</button>
      <button class="btn text block" data-act="skiplogin">Продолжить без входа</button>
    </div>
    <p class="legal">Продолжая, вы принимаете <u>Политику обработки персональных данных</u> и даёте согласие на обработку данных (оформляется отдельным документом). Публично показывается только ваш никнейм.</p>
  </div></div>`;
}
function doLogin(provider) {
  openModal(`<h3>Вход через ${esc(provider)}</h3><p class="small muted" style="margin:0">В прототипе вход имитируется: настоящая авторизация ${esc(provider)} подключается на сервере. Придумайте никнейм — он будет виден на карте вместо имени.</p>
    <div class="field"><label for="nick">Никнейм</label><input class="input" id="nick" maxlength="24" value="житель_${Math.floor(100 + Math.random() * 900)}"></div>
    <label class="row small" style="align-items:flex-start"><input type="checkbox" id="pd-consent" style="width:20px;height:20px;margin:2px 0 0"> <span>Даю согласие на обработку персональных данных</span></label>
    <div class="row"><button class="btn outline grow" data-act="closemodal">Отмена</button><button class="btn primary grow" data-act="dologin">Войти</button></div>`);
  S._provider = provider;
}
function finishLogin() {
  const nick = ($("#nick").value || "").trim();
  if (nick.length < 3) { toast("Никнейм — от 3 символов"); return; }
  if (!$("#pd-consent").checked) { toast("Отметьте согласие на обработку персональных данных"); return; }
  S.user = { nick, provider: S._provider, since: Date.now() }; ls.set("user", S.user);
  closeModal(); closeOverlay(); toast(`Добро пожаловать, ${nick}!`); render();
  const pend = S.pending; S.pending = null;
  if (pend && pend.go) go(pend.go);
  else if (pend && pend.click) setTimeout(() => document.querySelector(pend.click)?.click(), 50);
}
function openModal(html) { $("#modal-root").innerHTML = `<div class="modal-scrim" data-act="closemodal-scrim"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`; $("#modal-root .modal-scrim").addEventListener("click", ev => { if (ev.target.classList.contains("modal-scrim")) closeModal(); }); }
function closeModal() { $("#modal-root").innerHTML = ""; }
function closeOverlay() { $("#overlay-root").innerHTML = ""; }

// ---------- запуск ----------
async function bootData(forceSeed) {
  const seeded = await DB.get("meta", "seeded");
  let cs = await DB.all("complaints");
  if (!seeded || forceSeed || !cs.length) {
    cs = seedComplaints(); for (const c of cs) await DB.put("complaints", c);
    for (const n of seedNotifications(cs)) await DB.put("notifications", n);
    await DB.put("meta", { key: "seeded", at: Date.now() });
  }
  S.complaints = await DB.all("complaints");
  S.notifications = await DB.all("notifications");
}
async function start() {
  applyTheme();
  await DB.open();
  await bootData(false);
  S.weather = ls.get("weather", null) || WEATHER_SNAPSHOT;
  initMap();
  render();
  loadWeather();
  const params = location.hash.replace("#", "");
  if (params === "skip") { S.onboarded = true; }
  if (!S.onboarded) onbStep(0);
  addEventListener("resize", () => { clearTimeout(start.rt); start.rt = setTimeout(render, 150); });
  addEventListener("keydown", e => { if (e.key === "Escape") { if ($("#modal-root").innerHTML) closeModal(); else if (S.view !== "map") back(); } });
  window.KGP = { S, go, openDetail, render, DB, onbStep, openLogin, closeOverlay, doLogin, map: () => map, placeMap: () => placeMap, renderHud, drawMarkers };
}
start();
