import type * as Leaflet from "leaflet";
import { L } from "./leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { ico } from "../domain/format";
import type { Category, Complaint } from "../domain/types";
import { makeBase, type MapMode } from "./tiles";

export function pinIcon(c: Complaint, cat: Category, sel: boolean): Leaflet.DivIcon {
  const col = c.status === "resolved" ? "#2e7d4f" : cat.color;
  return L.divIcon({
    className: "",
    iconSize: [36, 44],
    iconAnchor: [4, 40],
    html: `<div class="pin ${sel ? "sel" : ""}" style="--c:${col}"><div class="head"></div>${ico(c.status === "resolved" ? "check" : cat.icon, "fill")}${c.supports >= 10 ? `<span class="cnt">${c.supports}</span>` : ""}</div>`,
  });
}

export interface MainMap {
  map: Leaflet.Map;
  draw(list: Complaint[], selected: string | null): void;
}

/** Ф-01: map with category pins; pins cluster when zoomed out and split at street level. */
export function createMainMap(
  el: HTMLElement,
  opts: {
    center: [number, number];
    zoom: number;
    cat: (id: string) => Category;
    onSelect: (id: string | null) => void;
    onMode: (m: MapMode) => void;
  },
): MainMap {
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(opts.center, opts.zoom);
  makeBase(map, (m) => opts.onMode(m));
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    disableClusteringAtZoom: 16,
    maxClusterRadius: 48,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: (cl) => {
      const n = cl.getChildCount();
      const size = n < 10 ? 40 : n < 50 ? 46 : 54;
      return L.divIcon({
        className: "",
        iconSize: [size, size],
        html: `<div class="cluster" style="width:${size}px;height:${size}px" aria-label="${n} обращений"><span class="num">${n}</span></div>`,
      });
    },
  });
  map.addLayer(cluster);
  map.on("click", () => opts.onSelect(null));

  let fitted = false;
  return {
    map,
    draw(list, selected) {
      cluster.clearLayers();
      const markers = list.map((c) => {
        const m = L.marker([c.lat, c.lng], {
          icon: pinIcon(c, opts.cat(c.category), selected === c.id),
          keyboard: true,
          title: c.title,
          alt: c.title,
          zIndexOffset: selected === c.id ? 1000 : 0,
        });
        m.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          opts.onSelect(c.id);
        });
        return m;
      });
      cluster.addLayers(markers);
      if (!fitted && list.length) {
        fitted = true;
        const desktop = matchMedia("(min-width: 900px)").matches;
        map.fitBounds(
          list.map((c) => [c.lat, c.lng] as [number, number]),
          { padding: desktop ? [60, 60] : [30, 30], maxZoom: 16 },
        );
      }
    },
  };
}
