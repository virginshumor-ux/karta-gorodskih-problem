import { distM, type LatLng } from "../domain/format";
import { fetchJSON } from "./net";

export interface GeoResult {
  address: string;
  district: string;
  source: "nominatim" | "photon" | "local" | "none" | "cache";
}

interface NominatimReply {
  name?: string;
  address?: Record<string, string>;
}
interface PhotonReply {
  features?: { properties?: Record<string, string> }[];
}

// Nominatim usage policy: at most one request per second, with caching.
const cache = new Map<string, GeoResult>();
let lastNominatim = 0;
const key = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

async function nominatimSlot(): Promise<void> {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
}

/** Reverse geocoding: Nominatim → Photon → "рядом с: …" by the nearest known complaint. */
export async function geocodePoint(lat: number, lng: number, known: (LatLng & { address: string; district: string })[]): Promise<GeoResult> {
  const k = key(lat, lng);
  const hit = cache.get(k);
  if (hit) return { ...hit, source: "cache" };
  try {
    await nominatimSlot();
    const j = await fetchJSON<NominatimReply>(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=ru&lat=${lat}&lon=${lng}`,
    );
    const a = j.address ?? {};
    const road = a.road || a.pedestrian || a.footway || a.path || a.neighbourhood || a.suburb || "";
    const addr = road ? road + (a.house_number ? ", " + a.house_number : "") : j.name || "";
    if (addr) return remember(k, { address: addr, district: a.city_district || a.suburb || "", source: "nominatim" });
  } catch {
    /* next source */
  }
  try {
    const j = await fetchJSON<PhotonReply>(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=default`);
    const p = j.features?.[0]?.properties ?? {};
    const addr = p.street ? p.street + (p.housenumber ? ", " + p.housenumber : "") : p.name || "";
    if (addr) return remember(k, { address: addr, district: p.district || "", source: "photon" });
  } catch {
    /* next source */
  }
  const pt = { lat, lng };
  const near = known.slice().sort((a, b) => distM(a, pt) - distM(b, pt))[0];
  if (near && distM(near, pt) < 300) return { address: "рядом с: " + near.address, district: near.district, source: "local" };
  return { address: "Точка на карте (адрес не определён)", district: "", source: "none" };
}

function remember(k: string, r: GeoResult): GeoResult {
  cache.set(k, r);
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return r;
}
