import { esc, ico } from "../domain/format";
import { $ } from "./dom";

export const lightboxOpen = (): boolean => !!$("#lightbox-root")?.innerHTML;

export function closeLightbox(): void {
  const root = $("#lightbox-root");
  if (root) root.innerHTML = "";
}

/** Full-screen photo viewer: arrows, keyboard (←/→/Esc) and swipe. */
export function openLightbox(photos: { url: string; alt: string }[], start: number): void {
  const root = $("#lightbox-root");
  if (!root || !photos.length) return;
  let i = Math.max(0, Math.min(start, photos.length - 1));
  const draw = () => {
    const p = photos[i] as { url: string; alt: string };
    root.innerHTML = `<div class="lightbox" role="dialog" aria-modal="true" aria-label="Просмотр фото" tabindex="-1">
      <img src="${esc(p.url)}" alt="${esc(p.alt)}">
      <button class="icon-btn close" data-lb="close" aria-label="Закрыть">${ico("close")}</button>
      ${photos.length > 1 ? `<button class="icon-btn prev" data-lb="prev" aria-label="Предыдущее фото">${ico("chevron_left")}</button><button class="icon-btn next" data-lb="next" aria-label="Следующее фото">${ico("chevron_right")}</button><span class="count num">${i + 1} / ${photos.length}</span>` : ""}
    </div>`;
    root.querySelector<HTMLElement>(".lightbox")?.focus();
  };
  const step = (d: number) => {
    i = (i + d + photos.length) % photos.length;
    draw();
  };
  draw();
  let x0: number | null = null;
  let swiped = false;
  const box = () => root.querySelector<HTMLElement>(".lightbox");
  root.onclick = (e) => {
    if (swiped) {
      swiped = false;
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-lb]");
    const a = b?.dataset.lb;
    if (a === "prev") step(-1);
    else if (a === "next") step(1);
    else if (a === "close" || e.target === box()) closeLightbox();
  };
  root.onkeydown = (e) => {
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "Escape") {
      e.stopPropagation();
      closeLightbox();
    }
  };
  root.onpointerdown = (e) => (x0 = e.clientX);
  root.onpointerup = (e) => {
    if (x0 != null && Math.abs(e.clientX - x0) > 60 && photos.length > 1) {
      swiped = true;
      step(e.clientX < x0 ? 1 : -1);
    }
    x0 = null;
  };
}
