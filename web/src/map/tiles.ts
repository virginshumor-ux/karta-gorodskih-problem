import type * as Leaflet from "leaflet";
import { L } from "./leaflet";

import { isBlockedPixels, SNAPSHOTS, TILE_SOURCES, type TileSource } from "./tileSources";
import { VECTOR_ATTR, VECTOR_TILEJSON, vectorStyle, webglAvailable } from "./vectorStyle";

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

/** Pseudo-source for the HUD and tests: the sharp vector map. */
export const VECTOR_SOURCE: TileSource = { id: "vector", url: VECTOR_TILEJSON, probe: VECTOR_TILEJSON, attr: VECTOR_ATTR, maxZoom: 20 };

export const isDarkTheme = (): boolean => {
  const t = document.documentElement.dataset.theme;
  if (document.documentElement.dataset.skin === "neon") return true;
  return t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
};

let vectorP: Promise<boolean> | null = null;
/** The vector source answers (checked once per page): WebGL + the TileJSON of OpenFreeMap. */
function vectorReachable(): Promise<boolean> {
  if (!vectorP)
    vectorP = (async () => {
      if (!webglAvailable()) return false;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      try {
        const r = await fetch(VECTOR_TILEJSON, { signal: ctl.signal });
        return r.ok && Array.isArray(((await r.json()) as { tiles?: unknown }).tiles);
      } catch {
        return false;
      } finally {
        clearTimeout(t);
      }
    })();
  return vectorP;
}

type GlMap = import("maplibre-gl").Map;
const vectorMaps = new Set<GlMap>();

/** Re-applies the light or dark map style after a theme switch. */
export function refreshVectorTheme(): void {
  const st = vectorStyle(isDarkTheme());
  vectorMaps.forEach((g) => {
    try {
      g.setStyle(st);
    } catch {
      /* the map is being removed */
    }
  });
}

// Leaflet's zoom animation: 0.25 s, cubic-bezier(0, 0, 0.25, 1).
const leafletEase = (t: number) => 1 - (1 - t) ** 4;

/**
 * Vector base map under the Leaflet panes: a MapLibre map in its own layer of the container that follows every
 * Leaflet move, zoom animation and pinch (MapLibre zoom = Leaflet zoom − 1: 512-px vs 256-px tiles). Pins, clusters
 * and the heatmap stay Leaflet layers. Resolves false when the source keeps failing (then raster tiles are used).
 */
async function addVector(m: Leaflet.Map): Promise<boolean> {
  if (!(await vectorReachable()) || !m.getContainer().isConnected) return false;
  try {
    const [gl, worker] = await Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]);
    // The worker URL is computed at runtime inside MapLibre, so the bundler cannot see it: point to the emitted file.
    gl.setWorkerUrl(worker.default);
    if (!m.getContainer().isConnected) return false;
    const holder = document.createElement("div");
    holder.className = "kgp-vector";
    // Inline: maplibre-gl.css later sets .maplibregl-map { position: relative }.
    holder.style.cssText = "position:absolute;inset:0;z-index:0;pointer-events:none";
    m.getContainer().prepend(holder);
    const c0 = m.getCenter();
    const g = new gl.Map({
      container: holder,
      style: vectorStyle(isDarkTheme()),
      center: [c0.lng, c0.lat],
      zoom: m.getZoom() - 1,
      interactive: false,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: 120,
    });
    const sync = () => {
      const c = m.getCenter();
      g.jumpTo({ center: [c.lng, c.lat], zoom: m.getZoom() - 1 });
    };
    const anim = (e: Leaflet.ZoomAnimEvent) => g.easeTo({ center: [e.center.lng, e.center.lat], zoom: e.zoom - 1, duration: 250, easing: leafletEase });
    const resize = () => {
      g.resize();
      sync();
    };
    const destroy = () => {
      m.off("move zoom viewreset moveend", sync).off("zoomanim", anim).off("resize", resize).off("unload", destroy);
      vectorMaps.delete(g);
      g.remove();
      holder.remove();
    };
    const ok = await new Promise<boolean>((res) => {
      let errors = 0;
      // A slow network still gets the vector map: only repeated source errors switch to raster tiles.
      const t = setTimeout(() => res(true), 12000);
      g.once("load", () => {
        clearTimeout(t);
        res(true);
      });
      g.on("error", () => {
        if (++errors >= 4 && !g.loaded()) {
          clearTimeout(t);
          res(false);
        }
      });
    });
    if (!ok || !m.getContainer().isConnected) {
      destroy();
      return false;
    }
    m.on("move zoom viewreset moveend", sync).on("zoomanim", anim).on("resize", resize).on("unload", destroy);
    sync();
    vectorMaps.add(g);
    // The low-resolution snapshot is not needed under an opaque vector map.
    const snap = m.getPane("snapPane");
    if (snap) snap.style.display = "none";
    m.attributionControl?.addAttribution(VECTOR_ATTR);
    return true;
  } catch {
    return false;
  }
}

/**
 * The built-in snapshot lies UNDER the live map (own pane below the tile pane). Before v1.2 it sat in the overlay
 * pane above the tiles, so inside the city the low-resolution JPEG covered the live map at every zoom.
 */
export function addSnapshots(m: Leaflet.Map): void {
  const base = import.meta.env.BASE_URL;
  if (!m.getPane("snapPane")) m.createPane("snapPane").style.zIndex = "150";
  L.imageOverlay(base + SNAPSHOTS.city.url, SNAPSHOTS.city.bounds, { attribution: "© участники OpenStreetMap", className: "snap-layer", pane: "snapPane" }).addTo(m);
  L.imageOverlay(base + SNAPSHOTS.campus.url, SNAPSHOTS.campus.bounds, { className: "snap-layer", pane: "snapPane" }).addTo(m);
}

/**
 * Snapshot underlay, then the sharp vector map; if WebGL or the vector source is unavailable, the first working
 * raster source of the chain (osm.org → osm.de → osm.fr); reports the mode for the HUD.
 */
export function makeBase(m: Leaflet.Map, onMode?: (mode: MapMode, src?: TileSource) => void): void {
  addSnapshots(m);
  m.setMaxBounds(L.latLngBounds(SNAPSHOTS.city.bounds).pad(0.02));
  m.setMinZoom(11);
  m.setMaxZoom(18);
  onMode?.("pending");
  void addVector(m).then((vector) => {
    if (!vector) return addRaster(m, onMode);
    m.setMaxBounds(undefined as unknown as Leaflet.LatLngBoundsExpression);
    m.setMinZoom(3);
    m.setMaxZoom(VECTOR_SOURCE.maxZoom);
    onMode?.("live", VECTOR_SOURCE);
  });
}

function addRaster(m: Leaflet.Map, onMode?: (mode: MapMode, src?: TileSource) => void): void {
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
