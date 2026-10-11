import type * as Leaflet from "leaflet";
import type { AuthState, Backend, NewComplaint } from "./api/backend";
import { deleteDraft, kvGet, kvSet, listDrafts, saveDraft } from "./api/db";
import { geocodePoint } from "./api/geocode";
import { LocalBackend } from "./api/localBackend";
import { compress, demoPhoto } from "./api/photos";
import { cachedWeather, fetchWeather } from "./api/weather";
import { complaintUrl, CONFIG } from "./config";
import { CAMPUS, CONFIRM_NEED, REPORT_REASONS, STATUSES } from "./domain/constants";
import { AppError, toAppError } from "./domain/errors";
import { distM, esc, ico, inKrsk, uuid } from "./domain/format";
import { appealText, emptyFilter, toCsv } from "./domain/logic";
import type { Complaint, Status, User } from "./domain/types";
import { L } from "./map/leaflet";
import { createMainMap, pinIcon, type MainMap } from "./map/mainMap";
import { makeBase } from "./map/tiles";
import { admin, adminHtml, type AdminTab } from "./screens/admin";
import { navHtml } from "./screens/common";
import { stepReady, viewCreate, wizard } from "./screens/create";
import { viewAppeal, viewDetail } from "./screens/detail";
import { hudHtml } from "./screens/hud";
import { listResults, viewList } from "./screens/list";
import { loginHtml, onboardingHtml, ONB, privacyHtml, profileFormHtml, viewAbout, viewNotif, viewPrivacy, viewProfile, viewStats, viewWeather } from "./screens/pages";
import { hashFor, parseHash, type Route } from "./state/router";
import { ls } from "./state/storage";
import { cat, filtered, findComplaint, isDesktop, isModerator, S, upsertComplaint, user, type Pending, type View } from "./state/store";
import { $, closeModal, closeOverlay, markdown, modalOpen, openModal, overlayOpen, toast } from "./ui/dom";

let mainMap: MainMap | null = null;
let placeMap: Leaflet.Map | null = null;
let miniMap: Leaflet.Map | null = null;
let statsCache: Awaited<ReturnType<Backend["stats"]>> | null = null;

// ---------- rendering ----------

function renderNav(): void {
  const bn = $("#bottom-nav");
  if (bn) {
    bn.innerHTML = navHtml(false);
    bn.classList.toggle("hide", ["create", "appeal"].includes(S.view));
  }
  const rail = $("#rail");
  if (rail) rail.innerHTML = `<span class="brand-mark" title="Карта городских проблем">${ico("location_on", "fill")}</span>` + navHtml(true);
}

function renderHud(): void {
  const hud = $("#hud");
  if (!hud) return;
  const { html, withBanner } = hudHtml();
  hud.className = withBanner ? "with-banner" : "";
  hud.innerHTML = html;
}

function drawMarkers(): void {
  mainMap?.draw(filtered(), S.selected);
}

function destroySubmaps(): void {
  placeMap?.remove();
  placeMap = null;
  miniMap?.remove();
  miniMap = null;
}

export function render(): void {
  renderNav();
  const panel = $("#panel") as HTMLElement;
  const adminRoot = $("#admin-root") as HTMLElement;
  adminRoot.innerHTML = S.view === "admin" ? adminHtml() : "";
  adminRoot.hidden = S.view !== "admin";
  if (S.view === "admin") afterAdminRender();
  const v: View = S.view === "map" && isDesktop() ? "list" : S.view === "admin" ? (S.prev[S.prev.length - 1] ?? "list") : S.view;
  if (v === "map") {
    panel.hidden = true;
    destroySubmaps();
    renderHud();
    setTimeout(() => mainMap?.map.invalidateSize(), 50);
    return;
  }
  panel.hidden = false;
  destroySubmaps();
  const fns: Partial<Record<View, () => string>> = {
    list: viewList,
    detail: viewDetail,
    create: viewCreate,
    notif: viewNotif,
    profile: viewProfile,
    stats: () => viewStats(statsCache),
    weather: viewWeather,
    appeal: viewAppeal,
    about: viewAbout,
    privacy: viewPrivacy,
  };
  const keepScroll = panel.querySelector(".screen")?.scrollTop ?? 0;
  panel.innerHTML = (fns[v] ?? viewList)();
  const sc = panel.querySelector(".screen");
  if (sc) sc.scrollTop = renderKeepsScroll ? keepScroll : 0;
  renderKeepsScroll = false;
  afterRender(v);
  renderHud();
  setTimeout(() => mainMap?.map.invalidateSize(), 50);
}
let renderKeepsScroll = false;
/** Re-render the current screen without jumping to the top (data refresh, toggles). */
function refresh(): void {
  renderKeepsScroll = true;
  render();
}

function afterRender(v: View): void {
  if (v === "detail") {
    const c = findComplaint(S.detailId);
    const el = $("#minimap");
    if (c && el) {
      miniMap = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false, attributionControl: false }).setView([c.lat, c.lng], 16);
      makeBase(miniMap);
      L.marker([c.lat, c.lng], { icon: pinIcon(c, cat(c.category), true), interactive: false }).addTo(miniMap);
      if (mainMap && isDesktop()) {
        mainMap.map.setView([c.lat, c.lng], Math.max(mainMap.map.getZoom(), 16), { animate: true });
        S.selected = c.id;
        drawMarkers();
      }
    }
    $("#after-input")?.addEventListener("change", onAfterPhoto);
  }
  if (v === "create" && S.draft) {
    const d = S.draft;
    if (d.step === 0) {
      $("#photo-input")?.addEventListener("change", onPhotos);
      $("#photo-camera")?.addEventListener("change", onPhotos);
    }
    if (d.step === 1) {
      const start: [number, number] = d.lat != null && d.lng != null ? [d.lat, d.lng] : mainMap ? [mainMap.map.getCenter().lat, mainMap.map.getCenter().lng] : [CAMPUS.lat, CAMPUS.lng];
      placeMap = L.map($("#placemap") as HTMLElement, { zoomControl: false, attributionControl: false }).setView(start, 17);
      makeBase(placeMap);
      const upd = () => {
        if (!placeMap) return;
        const c = placeMap.getCenter();
        d.lat = c.lat;
        d.lng = c.lng;
        d.address = "";
        d.district = "";
        setText("#addr-line", "Определяем адрес…");
        setText("#addr-sub", `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`);
        geocodeDebounced();
        updateNext();
      };
      placeMap.on("moveend", upd);
      if (d.lat == null) {
        upd();
        autoLocate();
      } else updateNext();
    }
    if (d.step === 3) {
      const t = $("#f-title") as HTMLInputElement;
      const ds = $("#f-desc") as HTMLTextAreaElement;
      t.addEventListener("input", () => {
        d.title = t.value;
        updateNext();
      });
      ds.addEventListener("input", () => {
        d.description = ds.value;
        setText("#desc-count", `${d.description.length} / 500`);
      });
      // Focus right away (a delayed focus could steal it from the description field).
      if (!document.activeElement || document.activeElement === document.body) t.focus({ preventScroll: true });
    }
  }
  if (v === "list") {
    $("#search")?.addEventListener("input", (e) => {
      S.search = (e.target as HTMLInputElement).value;
      const r = $("#list-results");
      if (r) r.innerHTML = listResults();
      drawMarkers();
      renderHud();
    });
    $("#f-district")?.addEventListener("change", (e) => {
      S.filter.district = (e.target as HTMLSelectElement).value;
      refreshAll();
    });
    $("#f-period")?.addEventListener("change", (e) => {
      S.filter.period = (e.target as HTMLSelectElement).value as typeof S.filter.period;
      refreshAll();
    });
  }
}

const setText = (sel: string, t: string) => {
  const el = $(sel);
  if (el) el.textContent = t;
};

function updateNext(): void {
  const b = $<HTMLButtonElement>('[data-act="next"]');
  if (b) b.disabled = !stepReady();
  const d = S.draft;
  if (d?.step === 1) setText("#geo-hint", d.lat != null && !inKrsk(d) ? "Точка за пределами Красноярска — приложение принимает обращения только по городу." : ($("#geo-hint")?.textContent ?? ""));
}

function refreshAll(): void {
  drawMarkers();
  if (S.view === "map") renderHud();
  else refresh();
}

// ---------- navigation ----------

interface GoOpts {
  force?: boolean;
  back?: boolean;
  keepDraft?: boolean;
  fromHistory?: boolean;
}

export function go(view: View, opts: GoOpts = {}): void {
  if (view === "create" && !user()) {
    openLogin("Чтобы сообщить о проблеме, войдите — так вы получите уведомления о статусе.", { go: "create" });
    return;
  }
  if (view === S.view && !opts.force) {
    if (view === "map") {
      S.selected = null;
      renderHud();
      drawMarkers();
    }
    return;
  }
  if (!opts.back) S.prev.push(S.view);
  if (S.prev.length > 20) S.prev.shift();
  S.view = view;
  if (view === "create" && !opts.keepDraft) newDraft();
  if (!opts.fromHistory) history.pushState({ kgp: true }, "", hashFor(view, S.detailId));
  render();
  onEnter(view);
}

function back(): void {
  if (history.state?.kgp) {
    history.back();
    return;
  }
  const v = S.prev.pop() ?? "map";
  S.view = v;
  history.replaceState(null, "", hashFor(v, S.detailId));
  render();
  onEnter(v);
}

/** Browser back/forward and deep links (#/c/<id>). */
function applyRoute(r: Route, fromHistory: boolean): void {
  if (r.id) {
    S.detailId = r.id;
    S.detailPhoto = 0;
  }
  if (r.view === "create" && !user()) r = { ...r, view: "map" };
  if (fromHistory && S.prev[S.prev.length - 1] === r.view) {
    S.prev.pop();
    S.view = r.view;
    render();
    onEnter(r.view);
    return;
  }
  go(r.view, { force: true, fromHistory: true, keepDraft: !!S.draft });
}

function openDetail(id: string): void {
  S.detailId = id;
  S.detailPhoto = 0;
  if (S.detail?.id !== id) S.detail = null;
  go("detail", { force: true });
}

async function onEnter(view: View): Promise<void> {
  try {
    if (view === "detail" && S.detailId) await loadDetail(S.detailId);
    if (view === "stats") {
      statsCache = await S.backend.stats();
      if (S.view === "stats") refresh();
    }
    if (view === "notif" && user()) {
      S.notifications = await S.backend.notifications();
      if (S.view === "notif") refresh();
      renderNav();
    }
    if (view === "admin") await loadAdmin();
  } catch (e) {
    const err = toAppError(e);
    if (!err.offline) toast(err.message);
    if (S.view === view) refresh();
  }
}

async function loadDetail(id: string): Promise<void> {
  const c = await S.backend.complaint(id);
  if (c) {
    S.detail = c;
    upsertComplaint(c);
  }
  S.loading = false;
  if (S.view === "detail" && S.detailId === id) refresh();
}

// ---------- data ----------

async function loadFeed(): Promise<void> {
  try {
    S.complaints = await S.backend.feed();
    S.offlineSince = null;
    if (S.backend.mode === "supabase") await kvSet("feed", S.complaints);
  } catch (e) {
    const err = toAppError(e);
    const cached = await kvGet<Complaint[]>("feed");
    if (cached) {
      S.complaints = cached.value;
      S.offlineSince = cached.at;
      if (err.offline) toast("Нет сети — показаны сохранённые обращения");
    } else toast(err.offline ? "Нет сети. Карта работает, обращения загрузятся при подключении." : err.message);
  } finally {
    S.loading = false;
  }
  drawMarkers();
}

let feedTimer: ReturnType<typeof setTimeout> | undefined;
function refreshFeedSoon(): void {
  clearTimeout(feedTimer);
  feedTimer = setTimeout(async () => {
    await loadFeed();
    if (["list", "profile", "admin"].includes(S.view) || (S.view === "map" && !isDesktop())) refresh();
    else renderHud();
  }, 600);
}

async function loadNotifications(): Promise<void> {
  try {
    S.notifications = await S.backend.notifications();
  } catch {
    /* keep the old list */
  }
  renderNav();
}

// ---------- auth ----------

function openLogin(reason?: string, pending?: Pending): void {
  S.pending = pending ?? null;
  const root = $("#overlay-root");
  if (root) root.innerHTML = loginHtml(reason);
}

function onbStep(i: number): void {
  if (i >= ONB.length) {
    S.onboarded = true;
    ls.set("onboarded", true);
    if (!user()) openLogin();
    else closeOverlay();
    return;
  }
  const root = $("#overlay-root");
  if (root) root.innerHTML = onboardingHtml(i);
}

async function applyAuth(st: AuthState): Promise<void> {
  S.auth = st;
  if (st.kind === "needsProfile") {
    openModal(profileFormHtml());
    return;
  }
  if (st.kind === "user") {
    closeModal();
    closeOverlay();
    toast(`Добро пожаловать, ${st.user.nick}!`);
    await Promise.all([loadFeed(), loadNotifications()]);
    render();
    void flushDrafts();
    const pend = S.pending ?? ls.get<Pending>("pending", null);
    S.pending = null;
    ls.set("pending", null);
    if (pend && "go" in pend) go(pend.go);
    else if (pend && "act" in pend) setTimeout(() => void runAction(pend.act, pend.id), 50);
  }
}

// ---------- create wizard ----------

function newDraft(): void {
  S.draft = { id: uuid(), step: 0, photos: [], photoUrls: [], lat: null, lng: null, address: "", district: "", category: null, title: "", description: "" };
  wizard.dups = null;
  wizard.busy = false;
}

async function onPhotos(e: Event): Promise<void> {
  const d = S.draft;
  if (!d) return;
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])].slice(0, 3 - d.photos.length);
  for (const f of files) {
    try {
      const b = await compress(f);
      d.photos.push(b);
      d.photoUrls.push(URL.createObjectURL(b));
    } catch {
      toast("Не удалось прочитать файл. Выберите фото в формате JPEG, PNG или HEIC.");
    }
  }
  render();
}

let geoTimer: ReturnType<typeof setTimeout> | undefined;
let geoSeq = 0;
function geocodeDebounced(): void {
  clearTimeout(geoTimer);
  geoTimer = setTimeout(reverseGeocode, 700);
}
async function reverseGeocode(): Promise<void> {
  const d = S.draft;
  if (!d || d.lat == null || d.lng == null) return;
  const seq = ++geoSeq;
  const g = await geocodePoint(d.lat, d.lng, S.complaints);
  if (seq !== geoSeq || S.draft !== d) return;
  d.address = g.address;
  d.district = g.district;
  setText("#addr-line", d.address);
  setText("#addr-sub", `${g.district ? g.district + " · " : ""}${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`);
  updateNext();
}

function geolocate(onDone?: (ok: boolean) => void): void {
  if (!navigator.geolocation) {
    setText("#geo-hint", "Геолокация недоступна. Передвиньте карту вручную.");
    onDone?.(false);
    return;
  }
  setText("#geo-hint", "Определяем местоположение…");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const inside = inKrsk({ lat: p.coords.latitude, lng: p.coords.longitude });
      if (inside) placeMap?.setView([p.coords.latitude, p.coords.longitude], 18);
      setText("#geo-hint", !inside ? "Вы находитесь за пределами Красноярска — передвиньте карту к месту проблемы." : p.coords.accuracy > 50 ? `Точность около ${Math.round(p.coords.accuracy)} м — уточните метку вручную.` : "");
      onDone?.(true);
    },
    () => {
      setText("#geo-hint", "Не удалось определить местоположение. Передвиньте карту вручную.");
      onDone?.(false);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

/** Auto geolocation on the place step only when permission was already granted (no surprise prompt). */
function autoLocate(): void {
  void navigator.permissions
    ?.query({ name: "geolocation" as PermissionName })
    .then((p) => {
      if (p.state === "granted") geolocate();
    })
    .catch(() => undefined);
}

async function findDuplicates(): Promise<void> {
  const d = S.draft;
  if (!d || d.lat == null || d.lng == null || !d.category) return;
  wizard.dups = null;
  try {
    wizard.dups = await S.backend.nearbyDuplicates(d.lat, d.lng, d.category);
  } catch {
    // Offline: local check over the cached feed, same 30 m rule.
    const pt = { lat: d.lat, lng: d.lng };
    wizard.dups = S.complaints
      .filter((c) => c.category === d.category && ["moderation", "published", "sent", "work", "resolved_wait"].includes(c.status) && distM(c, pt) <= 30)
      .map((c) => ({ id: c.id, title: c.title, status: c.status, supports: c.supports, address: c.address, distance: distM(c, pt) }));
  }
  if (S.view === "create" && S.draft === d && d.step === 4) refresh();
}

async function submitDraft(): Promise<void> {
  const d = S.draft;
  if (!d || d.lat == null || d.lng == null || !d.category) return;
  const payload: NewComplaint = { id: d.id, category: d.category, title: d.title.trim(), description: d.description.trim(), lat: d.lat, lng: d.lng, address: d.address, district: d.district, photos: d.photos };
  wizard.busy = true;
  refresh();
  try {
    d.createdId = await S.backend.createComplaint(payload);
    d.step = 5;
    void loadFeed().then(() => renderHud());
    void loadNotifications();
  } catch (e) {
    const err = toAppError(e);
    if (err.offline) {
      try {
        await saveDraft({ ...payload, createdAt: Date.now(), attempts: 0 });
        d.savedOffline = true;
        d.step = 5;
        S.pendingDrafts = (await listDrafts()).length;
      } catch (e2) {
        toast((e2 as Error).message);
      }
    } else toast(err.message);
  } finally {
    wizard.busy = false;
    render();
  }
}

let flushing = false;
/** Ф-07: offline drafts go out automatically when the connection is back. */
async function flushDrafts(): Promise<void> {
  if (flushing || S.backend.mode !== "supabase" || !user() || !navigator.onLine) return;
  flushing = true;
  try {
    for (const dr of await listDrafts()) {
      try {
        await S.backend.createComplaint(dr);
        await deleteDraft(dr.id);
        toast(`Черновик «${dr.title}» отправлен на модерацию`);
      } catch (e) {
        const err = toAppError(e);
        if (err.offline) break;
        if (err.code === "KGP_RATE_LIMIT" || err.code === "KGP_AUTH") {
          await saveDraft({ ...dr, attempts: dr.attempts + 1, lastError: err.message });
          continue;
        }
        await deleteDraft(dr.id);
        toast(`Черновик «${dr.title}» не принят: ${err.message}`);
      }
    }
    S.pendingDrafts = (await listDrafts()).length;
    await loadFeed();
    if (["profile", "list"].includes(S.view)) refresh();
  } finally {
    flushing = false;
  }
}

// ---------- complaint actions ----------

const FAIL = Symbol("fail");
/** Runs an action, shows the success toast or a readable error; returns FAIL on error. */
async function act<T>(fn: () => Promise<T>, ok?: string): Promise<T | typeof FAIL> {
  try {
    const r = await fn();
    if (ok) toast(ok);
    return r;
  } catch (e) {
    const err = toAppError(e);
    toast(err.offline ? "Нет сети — действие не выполнено. Повторите, когда появится связь." : err.message);
    return FAIL;
  }
}

async function reloadComplaint(id: string): Promise<void> {
  try {
    const c = await S.backend.complaint(id);
    if (c) upsertComplaint(c);
  } catch {
    /* keep */
  }
  drawMarkers();
  if (S.view === "map") renderHud();
  else refresh();
}

async function runAction(a: string, id: string): Promise<void> {
  const c = findComplaint(id);
  if (!c) return;
  if (a === "support") {
    const on = !c.supportedByMe;
    const n = await act(() => S.backend.setSupport(id, on), on ? "Вы поддержали обращение. Сообщим об изменениях статуса." : "Поддержка отменена");
    if (n !== FAIL) upsertComplaint({ ...c, supports: n, supportedByMe: on });
    drawMarkers();
    if (S.view === "map" || (isDesktop() && S.view === "list")) renderHud();
    if (S.view !== "map") refresh();
  } else if (a === "confirm") {
    const r = await act(() => S.backend.confirm(id, true));
    if (r !== FAIL) {
      toast(r.status === "resolved" ? "Проблема отмечена как решённая" : `Спасибо! Подтверждений: ${r.confirms} из ${CONFIRM_NEED}`);
      await reloadComplaint(id);
    }
  } else if (a === "notfixed") {
    const r = await act(() => S.backend.confirm(id, false), "Обращение снова в списке актуальных");
    if (r !== FAIL) await reloadComplaint(id);
  } else if (a === "report") {
    openModal(`<h3>Пожаловаться на обращение</h3><p class="small muted" style="margin:0">Модератор проверит обращение и скроет его, если оно нарушает правила.</p>
      <div class="stack" style="gap:8px" role="radiogroup">${REPORT_REASONS.map((r, i) => `<label class="row"><input type="radio" name="rep" value="${i}" ${i === 0 ? "checked" : ""} style="width:20px;height:20px;margin:0"> <span>${r}</span></label>`).join("")}</div>
      <div class="row"><button class="btn outline grow" data-act="closemodal">Отмена</button><button class="btn primary grow" data-act="sendreport" data-id="${esc(id)}">Отправить</button></div>`);
  }
}

const NEEDS_LOGIN: Record<string, string> = {
  support: "Войдите, чтобы поддержать обращение.",
  confirm: "Войдите, чтобы подтвердить решение.",
  notfixed: "Войдите, чтобы отметить, что проблема не решена.",
  report: "Войдите, чтобы пожаловаться на обращение.",
};

async function onAfterPhoto(e: Event): Promise<void> {
  const f = (e.target as HTMLInputElement).files?.[0];
  const id = S.detailId;
  if (!f || !id) return;
  toast("Загружаем фото «после»…");
  try {
    const b = await compress(f);
    await act(() => S.backend.addAfterPhoto(id, b), "Фото «после» отправлено модератору. Жители смогут подтвердить решение.");
  } catch {
    toast("Не удалось прочитать файл.");
  }
  await reloadComplaint(id);
}

function rejectModal(id: string): void {
  openModal(`<h3>Отклонить или скрыть обращение</h3><p class="small muted" style="margin:0">Причина попадёт в историю статусов и в уведомление автору.</p>
    <div class="stack" style="gap:8px">${["Нарушены правила публикации", "На фото узнаваемые люди или номера машин", "Недостоверная информация", "Не относится к городской среде"].map((r, i) => `<label class="row"><input type="radio" name="rej" value="${esc(r)}" ${i === 0 ? "checked" : ""} style="width:20px;height:20px;margin:0"> <span>${r}</span></label>`).join("")}</div>
    <div class="row"><button class="btn outline grow" data-act="closemodal">Отмена</button><button class="btn primary grow" data-act="dorejrect" data-id="${esc(id)}">Отклонить</button></div>`);
}

function duplicateModal(id: string): void {
  const c = findComplaint(id);
  if (!c) return;
  const cands = S.complaints
    .filter((x) => x.id !== id && !["duplicate", "rejected"].includes(x.status) && distM(x, c) < 400)
    .sort((a, b) => Number(b.category === c.category) - Number(a.category === c.category) || distM(a, c) - distM(b, c))
    .slice(0, 8);
  openModal(`<h3>Объединить с похожим обращением</h3><p class="small muted" style="margin:0">«${esc(c.title)}» станет дубликатом, а его автор — поддержавшим основное обращение.</p>
    ${cands.length ? `<div class="stack" style="gap:8px">${cands.map((x, i) => `<label class="row" style="align-items:flex-start"><input type="radio" name="dup" value="${esc(x.id)}" ${i === 0 ? "checked" : ""} style="width:20px;height:20px;margin:2px 0 0;flex:none"> <span><b>${esc(x.title)}</b><br><span class="small muted">${esc(cat(x.category).name)} · ${Math.round(distM(x, c))} м · ${STATUSES[x.status].name}</span></span></label>`).join("")}</div>` : `<p class="small">Рядом (до 400 м) других обращений нет.</p>`}
    <div class="row"><button class="btn outline grow" data-act="closemodal">Отмена</button><button class="btn primary grow" data-act="dodup" data-id="${esc(id)}" ${cands.length ? "" : "disabled"}>Объединить</button></div>`);
}

async function moderate(id: string, status: Status, comment?: string): Promise<void> {
  await act(() => S.backend.moderateStatus(id, status, comment), "Статус изменён: " + STATUSES[status].name);
  await reloadComplaint(id);
}

// ---------- admin ----------

async function loadAdmin(): Promise<void> {
  if (!isModerator()) return;
  await loadFeed();
  const tab = admin.tab;
  try {
    if (tab === "reports" || admin.reports === null) admin.reports = await S.backend.reports();
    if (tab === "users") admin.users = await S.backend.users(admin.userSearch);
    if (tab === "analytics") admin.stats = await S.backend.stats();
  } catch (e) {
    toast(toAppError(e).message);
  }
  if (S.view === "admin") render();
}

let heatMap: Leaflet.Map | null = null;
function afterAdminRender(): void {
  $("#adm-search")?.addEventListener("input", (e) => {
    admin.search = (e.target as HTMLInputElement).value;
    clearTimeout(admSearchT);
    admSearchT = setTimeout(() => {
      render();
      const el = $<HTMLInputElement>("#adm-search");
      el?.focus();
      el?.setSelectionRange(admin.search.length, admin.search.length);
    }, 300);
  });
  $("#adm-status")?.addEventListener("change", (e) => {
    admin.statusFilter = (e.target as HTMLSelectElement).value as Status | "";
    render();
  });
  $("#adm-users")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") void runClick("adm-users-search");
  });
  document.querySelectorAll<HTMLSelectElement>("[data-setstatus]").forEach((s) =>
    s.addEventListener("change", () => {
      if (s.value) void moderate(s.dataset.setstatus as string, s.value as Status);
    }),
  );
  document.querySelectorAll<HTMLSelectElement>("[data-setrole]").forEach((s) =>
    s.addEventListener("change", async () => {
      await act(() => S.backend.setRole(s.dataset.setrole as string, s.value as User["role"]), "Роль изменена");
      await loadAdmin();
    }),
  );
  heatMap?.remove();
  heatMap = null;
  const heat = $("#adm-heat");
  if (heat) {
    heatMap = L.map(heat, { zoomControl: true, attributionControl: true }).setView([CAMPUS.lat, CAMPUS.lng], 13);
    makeBase(heatMap);
    // Density layer from translucent circles: overlapping complaints sum up to "hot" areas.
    for (const c of S.complaints.filter((x) => !["duplicate", "rejected", "moderation"].includes(x.status)))
      L.circle([c.lat, c.lng], { radius: 120 + Math.min(c.supports, 60) * 4, stroke: false, fillColor: "#e8611a", fillOpacity: 0.18 }).addTo(heatMap);
  }
}
let admSearchT: ReturnType<typeof setTimeout> | undefined;

// ---------- clicks ----------

async function runClick(action: string, el?: HTMLElement): Promise<void> {
  const ds = el?.dataset ?? {};
  const id = ds.id ?? "";
  switch (action) {
    case "back":
      if (S.view === "create" && S.draft && S.draft.step > 0 && S.draft.step < 5) {
        S.draft.step--;
        render();
      } else back();
      break;
    case "next": {
      const d = S.draft;
      if (!d || !stepReady()) return;
      if (d.step === 3) {
        d.title = ($("#f-title") as HTMLInputElement).value;
        d.description = ($("#f-desc") as HTMLTextAreaElement).value;
      }
      if (d.step === 4) {
        await submitDraft();
        return;
      }
      d.step++;
      if (d.step === 4) void findDuplicates();
      render();
      break;
    }
    case "cancelcreate":
      S.draft = null;
      back();
      break;
    case "demophoto": {
      const d = S.draft;
      if (!d || d.photos.length >= 3) return;
      const b = await demoPhoto();
      d.photos.push(b);
      d.photoUrls.push(URL.createObjectURL(b));
      render();
      break;
    }
    case "geolocate":
      geolocate();
      break;
    case "support":
    case "confirm":
    case "notfixed":
    case "report":
      if (!user()) {
        openLogin(NEEDS_LOGIN[action], { act: action, id });
        break;
      }
      await runAction(action, id);
      break;
    case "supportdup": {
      const c = findComplaint(id);
      if (c && !c.supportedByMe) {
        const n = await act(() => S.backend.setSupport(id, true));
        if (n === FAIL) break;
        upsertComplaint({ ...c, supports: n, supportedByMe: true });
      }
      S.draft = null;
      toast("Спасибо! Вы поддержали существующее обращение.");
      openDetail(id);
      break;
    }
    case "sendreport": {
      const v = Number($<HTMLInputElement>('input[name="rep"]:checked')?.value ?? 0);
      closeModal();
      await act(() => S.backend.report(id, REPORT_REASONS[v] as string), "Жалоба отправлена модератору. Спасибо!");
      break;
    }
    case "toappeal":
      S.detailId = id || S.detailId;
      go("appeal", { force: true });
      break;
    case "copyappeal": {
      const txt = $("#appeal-text")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(txt);
        toast("Текст скопирован");
      } catch {
        const r = document.createRange();
        r.selectNodeContents($("#appeal-text") as HTMLElement);
        const s = getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
        toast("Текст выделен — скопируйте его");
      }
      break;
    }
    case "marksent":
      if ((await act(() => S.backend.markSent(id), "Статус: передано в организацию")) !== FAIL) {
        await reloadComplaint(id);
        back();
      }
      break;
    case "share": {
      const c = findComplaint(id);
      if (!c) break;
      const url = complaintUrl(c.id);
      const text = `${c.title} — ${c.address}, Красноярск`;
      try {
        if (navigator.share) await navigator.share({ title: c.title, text, url });
        else {
          await navigator.clipboard.writeText(`${text}\n${url}`);
          toast("Ссылка скопирована");
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast(`${text} ${url}`);
      }
      break;
    }
    case "closesheet":
      S.selected = null;
      renderHud();
      drawMarkers();
      break;
    case "zoomin":
      mainMap?.map.zoomIn();
      break;
    case "zoomout":
      mainMap?.map.zoomOut();
      break;
    case "locate":
      if (!navigator.geolocation) {
        toast("Геолокация недоступна на этом устройстве");
        break;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => mainMap?.map.setView([p.coords.latitude, p.coords.longitude], 16),
        () => {
          toast("Не удалось определить местоположение — показываем район СФУ");
          mainMap?.map.setView([CAMPUS.lat, CAMPUS.lng], CAMPUS.zoom);
        },
        { timeout: 8000 },
      );
      break;
    case "resetfilters":
      S.filter = { ...emptyFilter(), status: "all" };
      S.search = "";
      render();
      drawMarkers();
      break;
    case "readall":
      S.notifications.forEach((n) => (n.read = true));
      refresh();
      renderNav();
      await act(() => S.backend.markRead());
      break;
    case "login":
      openLogin();
      break;
    case "logout":
      await S.backend.signOut();
      S.auth = { kind: "guest" };
      S.notifications = [];
      toast("Вы вышли из учётной записи");
      await loadFeed();
      render();
      break;
    case "deleteacc":
      openModal(`<h3>Удалить учётную запись?</h3><p class="muted" style="margin:0">Будут безвозвратно удалены ваш профиль, созданные вами обращения с фотографиями, поддержки, подтверждения и уведомления. Действие нельзя отменить.</p><div class="row"><button class="btn outline grow" data-act="closemodal">Отмена</button><button class="btn grow" style="background:var(--bad);color:var(--surface)" data-act="confirmdelete">Удалить</button></div>`);
      break;
    case "confirmdelete":
      closeModal();
      toast("Удаляем учётную запись…");
      if ((await act(() => S.backend.deleteAccount(), "Учётная запись и ваши данные удалены")) !== FAIL) {
        S.auth = { kind: "guest" };
        S.notifications = [];
        await loadFeed();
        go("map");
      }
      break;
    case "togglemod":
      ls.set("moderator", !ls.get("moderator", false));
      if (S.auth.kind === "user") S.auth = (await S.backend.init(events)) as AuthState;
      refresh();
      drawMarkers();
      break;
    case "togglenotify": {
      const u = user();
      if (!u) break;
      const nu = await act(() => S.backend.updateSettings(!u.notifyEnabled), !u.notifyEnabled ? "Уведомления включены" : "Уведомления выключены");
      if (nu !== FAIL) S.auth = { kind: "user", user: nu };
      refresh();
      break;
    }
    case "theme": {
      const order = ["system", "light", "dark"];
      const t = ls.get("theme", "system");
      ls.set("theme", order[(order.indexOf(t) + 1) % 3]);
      applyTheme();
      refresh();
      break;
    }
    case "resetdemo":
      if (S.backend instanceof LocalBackend) {
        await S.backend.resetDemo();
        await Promise.all([loadFeed(), loadNotifications()]);
        toast("Демо-данные восстановлены");
        refresh();
      }
      break;
    case "refreshwx":
      toast("Обновляем погоду…");
      void updateWeather();
      break;
    case "flushdrafts":
      void flushDrafts();
      break;
    case "closemodal":
      closeModal();
      break;
    case "privacy":
      openModal(`${privacyHtml()}<button class="btn primary block" data-act="closemodal">Понятно</button>`, { wide: true });
      break;
    case "vk":
    case "ya": {
      const p = action === "vk" ? "vk" : "yandex";
      if (!S.backend.providerAvailable(p)) {
        toast(S.backend.mode === "local" ? "Вход через внешние сервисы работает после подключения сервера. Используйте демо-вход." : `Вход через ${p === "vk" ? "VK ID" : "Яндекс ID"} ещё настраивается. Используйте демо-вход.`);
        break;
      }
      ls.set("pending", S.pending);
      await act(() => S.backend.signInWith(p, hashFor(S.view, S.detailId)));
      break;
    }
    case "demologin": {
      const st = await act(() => S.backend.signInDemo());
      if (st !== FAIL) await applyAuth(st);
      break;
    }
    case "dologin": {
      const nick = ($<HTMLInputElement>("#nick")?.value ?? "").trim();
      if (nick.length < 3) {
        toast("Никнейм — от 3 символов");
        break;
      }
      if (!$<HTMLInputElement>("#pd-consent")?.checked) {
        toast("Отметьте согласие на обработку персональных данных");
        break;
      }
      const st = await act(() => S.backend.completeProfile(nick, true));
      if (st !== FAIL) await applyAuth(st);
      break;
    }
    case "cancelprofile":
      closeModal();
      await S.backend.signOut();
      S.auth = { kind: "guest" };
      break;
    case "skiplogin":
      closeOverlay();
      S.pending = null;
      break;
    // moderation
    case "reject":
      rejectModal(id);
      break;
    case "dorejrect": {
      const reason = $<HTMLInputElement>('input[name="rej"]:checked')?.value;
      closeModal();
      await moderate(id, "rejected", reason);
      break;
    }
    case "dupof":
      duplicateModal(id);
      break;
    case "dodup": {
      const orig = $<HTMLInputElement>('input[name="dup"]:checked')?.value;
      closeModal();
      if (orig) {
        await act(() => S.backend.markDuplicate(id, orig), "Обращения объединены");
        await loadFeed();
        await reloadComplaint(id);
      }
      break;
    }
    case "approveafter":
    case "rejectafter":
      await act(() => S.backend.reviewAfterPhoto(ds.photoId as string, action === "approveafter"), action === "approveafter" ? "Фото одобрено — обращение решено" : "Фото отклонено");
      await loadFeed();
      if (S.detailId) await reloadComplaint(S.detailId);
      break;
    case "adminclose":
      back();
      break;
    case "adminrefresh":
      admin.reports = null;
      await loadAdmin();
      break;
    case "reportkeep":
    case "reporthide":
      await act(() => S.backend.resolveReport(id, "", action === "reporthide"), action === "reporthide" ? "Обращение скрыто" : "Жалоба закрыта");
      admin.reports = null;
      await loadAdmin();
      break;
    case "adm-users-search":
      admin.userSearch = $<HTMLInputElement>("#adm-users")?.value ?? "";
      admin.users = null;
      render();
      await loadAdmin();
      break;
    case "toggleblock":
      await act(() => S.backend.setBlocked(id, ds.blocked !== "true"), ds.blocked === "true" ? "Пользователь разблокирован" : "Пользователь заблокирован");
      await loadAdmin();
      break;
    case "savecat": {
      const rowEl = document.querySelector(`[data-catrow="${CSS.escape(id)}"]`);
      const f = (k: string) => rowEl?.querySelector<HTMLInputElement>(`[data-f="${k}"]`)?.value.trim() ?? "";
      const isNew = id === "__new";
      const c = { id: isNew ? f("id") : id, name: f("name"), icon: f("icon") || "more_horiz", color: f("color"), org: f("org"), isNew };
      if (!/^[a-z_]{2,20}$/.test(c.id) || c.name.length < 2) {
        toast("Код — латиница a–z (2–20), название — от 2 символов");
        break;
      }
      if ((await act(() => S.backend.saveCategory(c), "Справочник сохранён")) !== FAIL) {
        S.cats = await S.backend.categories();
        render();
      }
      break;
    }
    case "exportcsv": {
      const rows = await act(() => S.backend.exportRows());
      if (rows === FAIL) break;
      const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `kgp-complaints-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      break;
    }
  }
}

async function onClick(e: MouseEvent): Promise<void> {
  const el = (e.target as HTMLElement).closest<HTMLElement>(
    "[data-go],[data-act],[data-open],[data-open-admin],[data-status],[data-cat],[data-mine],[data-pickcat],[data-rmphoto],[data-mod],[data-notif],[data-photo],[data-onb],[data-admtab]",
  );
  if (!el || (el as HTMLButtonElement).disabled) return;
  const ds = el.dataset;
  if (ds.go) {
    if (ds.go === "privacy" && overlayOpen()) {
      void runClick("privacy");
      return;
    }
    S.selected = ds.go === "map" ? S.selected : null;
    go(ds.go as View);
    return;
  }
  if (ds.open) {
    closeModal();
    openDetail(ds.open);
    return;
  }
  if (ds.openAdmin) {
    S.detailId = ds.openAdmin;
    S.detail = null;
    S.prev.push("list");
    go("detail", { force: true });
    return;
  }
  if (ds.status) {
    S.filter.status = ds.status as typeof S.filter.status;
    refreshAll();
    return;
  }
  if (ds.mine) {
    S.filter.mine = !S.filter.mine;
    refreshAll();
    return;
  }
  if (ds.cat) {
    const s = S.filter.cats;
    if (s.has(ds.cat)) s.delete(ds.cat);
    else s.add(ds.cat);
    refreshAll();
    return;
  }
  if (ds.pickcat && S.draft) {
    S.draft.category = ds.pickcat;
    refresh();
    return;
  }
  if (ds.rmphoto && S.draft) {
    const i = Number(ds.rmphoto);
    const u = S.draft.photoUrls[i];
    if (u) URL.revokeObjectURL(u);
    S.draft.photos.splice(i, 1);
    S.draft.photoUrls.splice(i, 1);
    render();
    return;
  }
  if (ds.photo) {
    S.detailPhoto = Number(ds.photo);
    refresh();
    return;
  }
  if (ds.notif) {
    const n = S.notifications.find((x) => x.id === ds.notif);
    if (n) {
      n.read = true;
      renderNav();
      void S.backend.markRead([n.id]).catch(() => undefined);
      if (n.complaintId) openDetail(n.complaintId);
    }
    return;
  }
  if (ds.onb) {
    onbStep(Number(ds.onb));
    return;
  }
  if (ds.admtab) {
    admin.tab = ds.admtab as AdminTab;
    render();
    void loadAdmin();
    return;
  }
  if (ds.mod) {
    await moderate(ds.id as string, ds.mod as Status);
    return;
  }
  if (ds.act) await runClick(ds.act, el);
}

// ---------- weather, theme ----------

async function updateWeather(): Promise<void> {
  const w = await fetchWeather();
  if (w) S.weather = w;
  renderHud();
  if (S.view === "weather") refresh();
}

function applyTheme(): void {
  const t = ls.get("theme", "system");
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

// ---------- start ----------

const events = {
  onAuth(st: AuthState) {
    S.auth = st;
    render();
  },
  onNotification(n: { id: string; complaintId: string | null; text: string; at: number; read: boolean; cat: string }) {
    if (S.notifications.some((x) => x.id === n.id)) return;
    const c = S.complaints.find((x) => x.id === n.complaintId);
    S.notifications.unshift({ ...n, cat: n.cat || c?.category || "other" });
    renderNav();
    toast(n.text, 4500);
    if (S.view === "notif") refresh();
  },
  onComplaintChanged(id: string) {
    refreshFeedSoon();
    if (S.view === "detail" && S.detailId === id) void loadDetail(id);
  },
};

export async function start(backend: Backend): Promise<void> {
  S.backend = backend;
  applyTheme();
  S.weather = cachedWeather();
  let route = parseHash(location.hash);
  // A reload never resumes the wizard or the appeal screen: like the prototype, the app starts on the map.
  if (route.view === "create") route = { ...route, view: "map" };
  if (route.id) S.detailId = route.id;

  mainMap = createMainMap($("#map") as HTMLElement, {
    center: [CAMPUS.lat, CAMPUS.lng],
    zoom: CAMPUS.zoom,
    cat,
    onSelect: (id) => {
      if (S.selected === id) return;
      S.selected = id;
      drawMarkers();
      renderHud();
    },
    onMode: (m) => {
      S.mapMode = m;
      renderHud();
    },
  });
  // Debug / e2e hook (the prototype exposed the same object).
  (window as unknown as { KGP: unknown }).KGP = { S, go, openDetail, render, onbStep, openLogin, closeOverlay, map: () => mainMap?.map, placeMap: () => placeMap, renderHud, drawMarkers, AppError, appealText, markdown };
  render();
  void updateWeather();

  document.addEventListener("click", (e) => void onClick(e));
  addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(refresh, 150);
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modalOpen()) closeModal();
    else if (S.selected) void runClick("closesheet");
    else if (S.view !== "map" && !overlayOpen()) back();
  });
  addEventListener("popstate", () => applyRoute(parseHash(location.hash), true));
  addEventListener("online", () => {
    toast("Связь восстановлена");
    void loadFeed().then(() => refresh());
    void flushDrafts();
  });
  addEventListener("offline", () => toast("Нет сети — работаем с сохранёнными данными"));
  // Broken (expired / offline) photo URLs fall back to the category illustration.
  document.addEventListener(
    "error",
    (e) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLImageElement && t.dataset.fallback !== undefined) t.classList.add("broken");
    },
    true,
  );

  let st: AuthState = { kind: "guest" };
  try {
    st = await backend.init(events);
  } catch (e) {
    toast(toAppError(e).message);
  }
  S.auth = st;
  try {
    S.cats = await backend.categories();
  } catch {
    /* defaults */
  }
  S.pendingDrafts = (await listDrafts()).length;
  await Promise.all([loadFeed(), loadNotifications()]);

  if (route.authCallback) {
    history.replaceState(null, "", "#/");
    try {
      st = await backend.finishRedirect(route.params);
      S.onboarded = true;
      ls.set("onboarded", true);
      await applyAuth(st);
      const back = route.params.get("hash");
      if (back && back !== "#/") applyRoute(parseHash(back), false);
    } catch (e) {
      toast(toAppError(e).message, 5000);
    }
  } else if (st.kind === "needsProfile") {
    openModal(profileFormHtml());
  }

  history.replaceState({ kgp: false }, "", location.hash || "#/");
  if (route.view !== "map" && !route.authCallback) applyRoute(route, false);
  else render();
  if (!S.onboarded && !route.authCallback) onbStep(0);
  void flushDrafts();
  setInterval(() => void flushDrafts(), 60_000);
  // Android-like polling fallback when realtime is unavailable.
  setInterval(() => {
    if (document.visibilityState === "visible" && user()) void loadNotifications();
  }, 120_000);

}
let resizeT: ReturnType<typeof setTimeout> | undefined;
