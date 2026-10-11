import type * as Leaflet from "leaflet";
import { L } from "./leaflet";

import { isBlockedPixels, SNAPSHOTS, TILE_SOURCES, type TileSource } from "./tileSources";

export { isBlockedPixels, SNAPSHOTS, TILE_SOURCES, type TileSource };

export function isBlockedTile(img: HTMLImageElement): boolean {
  try {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 128;
    const g = cv.getContext("2d", { willReadFrequently: true });
    if (!g) return false;
    g.drawImage(img, 0, 0, 128, 128);
    return isBlockedPixels(g.getImageData(0, 0, 128, 128).data);
  } catch {
    return false;
  }
}

export function probeSource(s: TileSource, timeoutMs = 5000): Promise<boolean> {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let done = false;
    const fin = (ok: boolean) => {
      if (!done) {
        done = true;
        res(ok);
      }
    };
    img.onload = () => fin(img.naturalWidth >= 256 && !isBlockedTile(img));
    img.onerror = () => fin(false);
    setTimeout(() => fin(false), timeoutMs);
    img.src = s.probe + "?probe=" + Date.now().toString(36);
  });
}

let tileSourceP: Promise<TileSource | null> | null = null;
export function pickTileSource(): Promise<TileSource | null> {
  if (!tileSourceP)
    tileSourceP = (async () => {
      for (const s of TILE_SOURCES) if (await probeSource(s)) return s;
      return null;
    })();
  return tileSourceP;
}

export type MapMode = "pending" | "live" | "snapshot";

export function addSnapshots(m: Leaflet.Map): void {
  const base = import.meta.env.BASE_URL;
  L.imageOverlay(base + SNAPSHOTS.city.url, SNAPSHOTS.city.bounds, { attribution: "© участники OpenStreetMap", className: "snap-layer" }).addTo(m);
  L.imageOverlay(base + SNAPSHOTS.campus.url, SNAPSHOTS.campus.bounds, { className: "snap-layer" }).addTo(m);
}

/** Snapshot underlay + the first working live source; reports the mode for the HUD. */
export function makeBase(m: Leaflet.Map, onMode?: (mode: MapMode, src?: TileSource) => void): void {
  addSnapshots(m);
  m.setMaxBounds(L.latLngBounds(SNAPSHOTS.city.bounds).pad(0.02));
  m.setMinZoom(11);
  m.setMaxZoom(18);
  onMode?.("pending");
  void pickTileSource().then((src) => {
    if (!m.getContainer().isConnected) return;
    if (!src) {
      onMode?.("snapshot");
      return;
    }
    let loaded = 0;
    let failed = 0;
    let blocked = 0;
    let checked = 0;
    const tiles = L.tileLayer(src.url, { maxZoom: src.maxZoom, attribution: src.attr, crossOrigin: "anonymous" });
    tiles.on("tileload", (e) => {
      loaded++;
      if (checked < 6) {
        checked++;
        if (isBlockedTile((e as Leaflet.TileEvent).tile)) blocked++;
        if (blocked >= 2) {
          m.removeLayer(tiles);
          onMode?.("snapshot");
        }
      }
    });
    tiles.on("tileerror", () => {
      failed++;
      if (failed >= 6 && loaded === 0) {
        m.removeLayer(tiles);
        onMode?.("snapshot");
      }
    });
    m.setMaxBounds(undefined as unknown as Leaflet.LatLngBoundsExpression);
    m.setMinZoom(3);
    m.setMaxZoom(src.maxZoom);
    tiles.addTo(m);
    onMode?.("live", src);
  });
}
