import { esc } from "../domain/format";

export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T | null => r.querySelector<T>(s);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 3200): void {
  const t = $("#toast-root");
  if (!t) return;
  t.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.innerHTML = ""), ms);
}

let lastFocus: HTMLElement | null = null;
export function openModal(html: string, opts: { wide?: boolean } = {}): void {
  const root = $("#modal-root");
  if (!root) return;
  lastFocus = document.activeElement as HTMLElement | null;
  root.innerHTML = `<div class="modal-scrim"><div class="modal ${opts.wide ? "wide" : ""}" role="dialog" aria-modal="true" tabindex="-1">${html}</div></div>`;
  root.querySelector(".modal-scrim")?.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).classList.contains("modal-scrim")) closeModal();
  });
  const first = root.querySelector<HTMLElement>("input,textarea,select,button.primary") ?? root.querySelector<HTMLElement>(".modal");
  setTimeout(() => first?.focus(), 30);
}
export function closeModal(): void {
  const root = $("#modal-root");
  if (root) root.innerHTML = "";
  lastFocus?.focus?.();
}
export const modalOpen = (): boolean => !!$("#modal-root")?.innerHTML;

export function closeOverlay(): void {
  const root = $("#overlay-root");
  if (root) root.innerHTML = "";
}
export const overlayOpen = (): boolean => !!$("#overlay-root")?.innerHTML;

/** Small, safe Markdown subset for the privacy policy: headings, lists, paragraphs, **bold**, links. */
export function markdown(md: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out: string[] = [];
  let list = false;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  for (const line of md.replace(/\r/g, "").split("\n")) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line) ?? /^\s*\d+\.\s+(.*)$/.exec(line);
    if (h) {
      flush();
      if (list) (out.push("</ul>"), (list = false));
      const lvl = Math.min(4, (h[1] as string).length + 1);
      out.push(`<h${lvl}>${inline(h[2] as string)}</h${lvl}>`);
    } else if (li) {
      flush();
      if (!list) (out.push("<ul>"), (list = true));
      out.push(`<li>${inline(li[1] as string)}</li>`);
    } else if (!line.trim()) {
      flush();
      if (list) (out.push("</ul>"), (list = false));
    } else para.push(line.trim());
  }
  flush();
  if (list) out.push("</ul>");
  return out.join("\n");
}
