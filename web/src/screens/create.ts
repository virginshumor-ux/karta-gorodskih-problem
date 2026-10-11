import { esc, ico, inKrsk } from "../domain/format";
import type { Duplicate } from "../domain/types";
import { cat, S, user } from "../state/store";
import { topbar } from "./common";

export const STEP_TITLES = ["Фото проблемы", "Где это?", "Что случилось?", "Описание", "Проверка"];

/** Duplicates found on step 5 (filled asynchronously by the app). */
export const wizard = { dups: null as Duplicate[] | null, busy: false };

export function stepReady(): boolean {
  const d = S.draft;
  if (!d) return false;
  switch (d.step) {
    case 0:
      return d.photos.length > 0;
    case 1:
      return d.lat != null && inKrsk(d) && !!d.address;
    case 2:
      return !!d.category;
    case 3:
      return d.title.trim().length >= 5;
    default:
      return !wizard.busy;
  }
}

export function viewCreate(): string {
  const d = S.draft;
  if (!d) return "";
  if (d.step === 5) {
    return `<div class="screen no-nav">${topbar("Готово", { backBtn: false })}<div class="success"><div class="big">${ico(d.savedOffline ? "cloud_upload" : "check_circle", "fill")}</div>
      ${
        d.savedOffline
          ? `<h2 class="step-title" style="margin:0">Черновик сохранён на устройстве</h2><p class="muted" style="margin:0">Сейчас нет связи с сервером. Обращение отправится автоматически, как только появится интернет, — приложение можно закрыть.</p>
             <div class="stack" style="width:100%;max-width:360px;margin-top:8px"><button class="btn primary block" data-go="map">На карту</button></div>`
          : `<h2 class="step-title" style="margin:0">Обращение отправлено на модерацию</h2><p class="muted" style="margin:0">Обычно проверка занимает до 24 часов. Мы пришлём уведомление, когда обращение появится на карте.</p>
             <div class="stack" style="width:100%;max-width:360px;margin-top:8px"><button class="btn primary block" data-open="${esc(d.createdId)}">Открыть обращение</button><button class="btn tonal block" data-act="toappeal" data-id="${esc(d.createdId)}">${ico("description")}Подготовить официальное обращение</button><button class="btn text" data-go="map">На карту</button></div>`
      }</div></div>`;
  }
  const steps = `<div class="steps" role="progressbar" aria-valuemin="1" aria-valuemax="5" aria-valuenow="${d.step + 1}" aria-label="Шаг ${d.step + 1} из 5">${STEP_TITLES.map((_, i) => `<i class="${i <= d.step ? "on" : ""}"></i>`).join("")}</div>`;
  const head = topbar(`Новое обращение <span class="small muted num" style="font-weight:400">· шаг ${d.step + 1} из 5</span>`, {
    right: `<button class="icon-btn" data-act="cancelcreate" aria-label="Отменить">${ico("close")}</button>`,
    backBtn: d.step > 0,
  });
  let body = "";
  let nextLabel = "Далее";
  if (d.step === 0) {
    body = `<h2 class="step-title">Сфотографируйте проблему</h2><p class="step-sub">До трёх фото. Не снимайте лица людей и номера машин — такие фото не пройдут модерацию.</p>
      <div class="photo-grid">
        ${d.photoUrls.map((p, i) => `<div class="photo-slot"><img src="${esc(p)}" alt="Фото ${i + 1}"><button class="rm" data-rmphoto="${i}" aria-label="Удалить фото ${i + 1}">${ico("close")}</button></div>`).join("")}
        ${d.photos.length < 3 ? `<label class="photo-slot add" for="photo-camera">${ico("photo_camera")}<span>Снять фото</span></label><label class="photo-slot add" for="photo-input">${ico("photo_library")}<span>Из галереи</span></label>` : ""}
      </div>
      <input id="photo-camera" type="file" accept="image/*" capture="environment" hidden>
      <input id="photo-input" type="file" accept="image/*" multiple hidden>
      <div class="pad" style="margin-top:12px"><button class="btn text" data-act="demophoto" ${d.photos.length >= 3 ? "disabled" : ""}>${ico("image")}Нет фото под рукой — добавить демо-иллюстрацию</button></div>`;
  } else if (d.step === 1) {
    body = `<h2 class="step-title">Отметьте место</h2><p class="step-sub">Передвиньте карту так, чтобы метка указывала на проблему.</p>
      <div class="place-map"><div id="placemap" style="position:absolute;inset:0"></div><div class="place-pin">${ico("location_on", "fill")}</div></div>
      <div class="addr-box">${ico("place")}<div class="grow"><b id="addr-line">${esc(d.address || "Определяем адрес…")}</b><div class="small muted" id="addr-sub">${d.lat != null && d.lng != null ? `${esc(d.district || "")}${d.district ? " · " : ""}${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : ""}</div></div></div>
      <div class="pad" style="margin-top:8px"><button class="btn text" data-act="geolocate">${ico("my_location")}Определить моё местоположение</button></div>
      <p class="pad hint" id="geo-hint" aria-live="polite"></p>`;
  } else if (d.step === 2) {
    body = `<h2 class="step-title">Выберите категорию</h2><p class="step-sub">От категории зависит, какой организации будет адресовано обращение.</p>
      <div class="cat-grid">${S.cats.map((c) => `<button class="cat-btn" data-pickcat="${c.id}" aria-pressed="${d.category === c.id}"><span class="cat-ico" style="background:${c.color}">${ico(c.icon, "fill")}</span>${esc(c.name)}</button>`).join("")}</div>`;
  } else if (d.step === 3) {
    body = `<h2 class="step-title">Опишите проблему</h2><p class="step-sub">Коротко: что, где именно и почему опасно. Можно пропустить подробности.</p>
      <div class="stack pad">
        <div class="field"><label for="f-title">Заголовок</label><input class="input" id="f-title" maxlength="80" value="${esc(d.title)}" placeholder="Например: Яма на въезде во двор" aria-describedby="title-hint"><span class="hint" id="title-hint">От 5 до 80 символов</span></div>
        <div class="field"><label for="f-desc">Подробности (необязательно)</label><textarea class="input" id="f-desc" maxlength="500" placeholder="Яма около 40 см, после дождя не видна">${esc(d.description)}</textarea><span class="hint num" id="desc-count">${d.description.length} / 500</span></div>
      </div>`;
  } else if (d.step === 4) {
    const dups = wizard.dups ?? [];
    const k = cat(d.category ?? "other");
    const dup = dups[0];
    body = `<h2 class="step-title">Проверьте и отправьте</h2>
      ${wizard.dups === null ? `<p class="pad small muted" role="status">${ico("travel_explore")} Ищем похожие обращения рядом…</p>` : ""}
      ${dup ? `<div class="dup card" style="padding:14px;border-color:var(--warn);background:var(--warn-soft)"><div class="row" style="align-items:flex-start">${ico("info", "fill")}<div class="grow stack" style="gap:8px"><b>Рядом уже есть похожее обращение</b><span class="small">В радиусе 30 м: «${esc(dup.title)}». Поддержите его — так проблему решат быстрее.</span><div class="row wrap"><button class="btn primary" data-act="supportdup" data-id="${esc(dup.id)}">${ico("thumb_up")}Поддержать</button><button class="btn outline" data-open="${esc(dup.id)}">Открыть</button></div></div></div></div>` : ""}
      <div class="c-list" style="margin-top:12px"><div class="c-item" style="cursor:default"><div class="thumb"><img src="${esc(d.photoUrls[0] ?? "")}" alt=""></div><div class="c-body"><span class="c-title">${esc(d.title)}</span><span class="c-meta">${ico(k.icon)} ${esc(k.name)}</span><span class="c-meta">${ico("place")} ${esc(d.address)}</span></div></div></div>
      <p class="pad small muted" style="margin-top:12px">После отправки обращение проверит модератор. Публично отображается только ваш никнейм «${esc(user()?.nick ?? "")}».</p>`;
    nextLabel = dup ? "Всё равно отправить" : "Отправить";
  }
  return `<div class="screen no-nav">${head}${steps}${body}<div class="wizard-foot">${d.step > 0 ? `<button class="btn outline" data-act="back">Назад</button>` : ""}<button class="btn ${d.step === 4 ? "accent" : "primary"}" data-act="next" ${stepReady() ? "" : "disabled"}>${wizard.busy ? "Отправляем…" : nextLabel}</button></div></div>`;
}
