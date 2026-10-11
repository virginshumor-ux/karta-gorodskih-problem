import { KRSK_BOX } from "./constants";

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const ico = (name: string, cls = ""): string => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;

export function uuid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  // RFC 4122 v4 fallback for old WebViews and plain-http origins.
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function fmtDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const diff = (now - ts) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return Math.floor(diff / 60) + " мин назад";
  if (diff < 86400 && d.getDate() === n.getDate())
    return "сегодня, " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return (
    d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) +
    ", " +
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  );
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export function distM(a: LatLng, b: LatLng): number {
  const R = 6371e3;
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t;
  const dLng = (b.lng - a.lng) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function inKrsk(p: { lat: number | null; lng: number | null }): boolean {
  return p.lat != null && p.lng != null && p.lat > KRSK_BOX.s && p.lat < KRSK_BOX.n && p.lng > KRSK_BOX.w && p.lng < KRSK_BOX.e;
}
