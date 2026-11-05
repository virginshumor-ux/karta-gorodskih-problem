import { esc, ico } from "../domain/format";
import { $ } from "./dom";

export interface PaletteItem {
  group: string;
  icon: string;
  title: string;
  sub?: string;
  run(): void;
}

export interface PaletteSource {
  /** Instant results: actions and complaints from the loaded feed. */
  items(q: string): PaletteItem[];
  /** Slow results (addresses from the geocoder), shown when they arrive. */
  search(q: string): Promise<PaletteItem[]>;
}

let lastFocus: HTMLElement | null = null;

export const paletteOpen = (): boolean => !!$("#palette-root")?.innerHTML;

export function closePalette(): void {
  const root = $("#palette-root");
  if (root) root.innerHTML = "";
  lastFocus?.focus?.();
}

/** Command palette (Ctrl+K): one search box for actions, complaints and addresses of Krasnoyarsk. */
export function openPalette(src: PaletteSource): void {
  const root = $("#palette-root");
  if (!root) return;
  lastFocus = document.activeElement as HTMLElement | null;
  root.innerHTML = `<div class="palette-scrim"><div class="palette" role="dialog" aria-modal="true" aria-label="Быстрый поиск">
    <div class="palette-input">${ico("search")}<input id="palette-q" type="search" autocomplete="off" placeholder="Адрес, обращение или действие" aria-label="Что найти" aria-controls="palette-list"><kbd>Esc</kbd></div>
    <div class="palette-list" id="palette-list" role="listbox"></div>
  </div></div>`;
  const input = $<HTMLInputElement>("#palette-q") as HTMLInputElement;
  const listEl = $("#palette-list") as HTMLElement;
  let items: PaletteItem[] = [];
  let remote: PaletteItem[] = [];
  let active = 0;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let searching = false;

  const draw = () => {
    const all = [...items, ...remote];
    active = Math.max(0, Math.min(active, all.length - 1));
    let html = "";
    let group = "";
    all.forEach((it, i) => {
      if (it.group !== group) {
        group = it.group;
        html += `<div class="palette-group">${esc(group)}</div>`;
      }
      html += `<button class="palette-item ${i === active ? "active" : ""}" role="option" aria-selected="${i === active}" data-pi="${i}">${ico(it.icon)}<span class="grow" style="min-width:0"><span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.title)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span></button>`;
    });
    if (searching) html += `<div class="palette-group">Адреса</div><p class="small muted" style="margin:6px 12px 10px" role="status">Ищем адрес в Красноярске…</p>`;
    if (!all.length && !searching) html = `<div class="empty" style="padding:28px 16px">${ico("search_off")}<p>Ничего не найдено. Попробуйте улицу и номер дома.</p></div>`;
    listEl.innerHTML = html;
    listEl.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  };

  const update = () => {
    const q = input.value.trim();
    items = src.items(q);
    remote = [];
    active = 0;
    clearTimeout(timer);
    searching = q.length >= 3;
    draw();
    if (!searching) return;
    const my = ++seq;
    timer = setTimeout(async () => {
      const r = await src.search(q).catch(() => []);
      if (my !== seq || !paletteOpen()) return;
      remote = r;
      searching = false;
      draw();
    }, 450);
  };

  const run = (i: number) => {
    const it = [...items, ...remote][i];
    if (!it) return;
    closePalette();
    it.run();
  };

  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    const n = items.length + remote.length;
    if (e.key === "ArrowDown") {
      active = (active + 1) % Math.max(1, n);
      draw();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = (active - 1 + n) % Math.max(1, n);
      draw();
      e.preventDefault();
    } else if (e.key === "Enter") {
      run(active);
      e.preventDefault();
    } else if (e.key === "Escape") {
      closePalette();
      e.stopPropagation();
    }
  });
  root.querySelector(".palette-scrim")?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains("palette-scrim")) closePalette();
    const b = t.closest<HTMLElement>("[data-pi]");
    if (b) run(Number(b.dataset.pi));
  });
  update();
  setTimeout(() => input.focus(), 20);
}
