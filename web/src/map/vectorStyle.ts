import type { StyleSpecification } from "maplibre-gl";

// Own vector map style "Енисей-поп": paper land, ink road casings, sun-yellow highways, Yenisei blue water.
// Data: OpenFreeMap (OpenMapTiles schema, no key). Vector tiles stay sharp at any zoom and on any screen density,
// unlike 256-px raster tiles. Labels are Russian names where OSM has them.

export const VECTOR_TILEJSON = "https://tiles.openfreemap.org/planet";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const VECTOR_ATTR =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · данные © участники <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

interface Palette {
  land: string;
  residential: string;
  park: string;
  wood: string;
  water: string;
  waterLine: string;
  building: string;
  buildingLine: string;
  casing: string;
  road: string;
  roadMinor: string;
  major: string;
  rail: string;
  label: string;
  labelSoft: string;
  halo: string;
  boundary: string;
}

const LIGHT: Palette = {
  land: "#f1ebdd",
  residential: "#ebe3d2",
  park: "#d3eba0",
  wood: "#c4e08e",
  water: "#9dbbff",
  waterLine: "#6f93f5",
  building: "#e0d6c2",
  buildingLine: "#c9bda5",
  casing: "#2a2824",
  road: "#ffffff",
  roadMinor: "#fbf8f1",
  major: "#ffd23f",
  rail: "#5c574d",
  label: "#141414",
  labelSoft: "#4a4740",
  halo: "#f8f4ea",
  boundary: "#8b6cff",
};

const DARK: Palette = {
  land: "#17161c",
  residential: "#1c1b22",
  park: "#1f2b18",
  wood: "#22311a",
  water: "#1b2a63",
  waterLine: "#3554c9",
  building: "#26252e",
  buildingLine: "#33323d",
  casing: "#000000",
  road: "#3b3a46",
  roadMinor: "#2c2b34",
  major: "#7d64ff",
  rail: "#6b6878",
  label: "#efe9dc",
  labelSoft: "#b8b2a6",
  halo: "#141318",
  boundary: "#c7f25c",
};

const NAME = ["coalesce", ["get", "name:ru"], ["get", "name"]] as const;
const z = (pairs: [number, number][]) => ["interpolate", ["exponential", 1.5], ["zoom"], ...pairs.flat()] as unknown as number;

export function vectorStyle(dark: boolean): StyleSpecification {
  const p = dark ? DARK : LIGHT;
  const major = ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false];
  const mid = ["match", ["get", "class"], ["secondary", "tertiary"], true, false];
  const minor = ["match", ["get", "class"], ["minor", "service", "track"], true, false];
  return {
    version: 8,
    name: dark ? "kgp-night" : "kgp-day",
    glyphs: GLYPHS,
    sources: { omt: { type: "vector", url: VECTOR_TILEJSON, attribution: VECTOR_ATTR } },
    layers: [
      { id: "land", type: "background", paint: { "background-color": p.land } },
      { id: "residential", type: "fill", source: "omt", "source-layer": "landuse", filter: ["match", ["get", "class"], ["residential", "suburb", "neighbourhood"], true, false], paint: { "fill-color": p.residential } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": p.park } },
      { id: "wood", type: "fill", source: "omt", "source-layer": "landcover", filter: ["match", ["get", "class"], ["wood", "grass", "farmland"], true, false], paint: { "fill-color": ["match", ["get", "class"], "wood", p.wood, p.park], "fill-opacity": 0.85 } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": p.water } },
      { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": p.waterLine, "line-width": z([[10, 0.6], [16, 3]]) } },
      { id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 14, paint: { "fill-color": p.building, "fill-outline-color": p.buildingLine, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 1] } },
      // Hard ink outline of buildings at street level: the "drawn by hand" look of the whole UI.
      { id: "building-ink", type: "line", source: "omt", "source-layer": "building", minzoom: 16, paint: { "line-color": p.buildingLine, "line-width": 1 } },
      { id: "road-minor", type: "line", source: "omt", "source-layer": "transportation", minzoom: 13, filter: minor as never, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.roadMinor, "line-width": z([[13, 0.6], [17, 7], [20, 18]]) } },
      { id: "road-casing", type: "line", source: "omt", "source-layer": "transportation", filter: ["any", major, mid] as never, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.casing, "line-width": z([[8, 0.8], [12, 3], [16, 14], [20, 38]]) } },
      { id: "road", type: "line", source: "omt", "source-layer": "transportation", filter: mid as never, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.road, "line-width": z([[8, 0.4], [12, 1.8], [16, 10], [20, 32]]) } },
      { id: "road-major", type: "line", source: "omt", "source-layer": "transportation", filter: major as never, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.major, "line-width": z([[8, 0.5], [12, 2], [16, 11], [20, 34]]) } },
      { id: "rail", type: "line", source: "omt", "source-layer": "transportation", filter: ["==", ["get", "class"], "rail"], paint: { "line-color": p.rail, "line-width": z([[11, 0.6], [17, 2.5]]), "line-dasharray": [3, 2] } },
      { id: "boundary", type: "line", source: "omt", "source-layer": "boundary", filter: ["<=", ["get", "admin_level"], 8], paint: { "line-color": p.boundary, "line-width": 1.4, "line-dasharray": [4, 3], "line-opacity": 0.6 } },
      { id: "water-name", type: "symbol", source: "omt", "source-layer": "water_name", layout: { "text-field": NAME as never, "text-font": ["Noto Sans Italic"], "text-size": 13, "symbol-placement": "line", "text-letter-spacing": 0.2 }, paint: { "text-color": p.waterLine, "text-halo-color": p.halo, "text-halo-width": 1.4 } },
      { id: "road-name", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 14, layout: { "text-field": NAME as never, "text-font": ["Noto Sans Regular"], "text-size": z([[14, 10], [18, 14]]), "symbol-placement": "line", "text-max-angle": 30 }, paint: { "text-color": p.labelSoft, "text-halo-color": p.halo, "text-halo-width": 1.6 } },
      { id: "poi", type: "symbol", source: "omt", "source-layer": "poi", minzoom: 16, filter: ["<=", ["get", "rank"], 18], layout: { "text-field": NAME as never, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 8 }, paint: { "text-color": p.labelSoft, "text-halo-color": p.halo, "text-halo-width": 1.4 } },
      { id: "place-minor", type: "symbol", source: "omt", "source-layer": "place", minzoom: 12, filter: ["match", ["get", "class"], ["suburb", "neighbourhood", "quarter", "village", "hamlet"], true, false], layout: { "text-field": NAME as never, "text-font": ["Noto Sans Bold"], "text-size": z([[12, 11], [16, 15]]), "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 9 }, paint: { "text-color": p.labelSoft, "text-halo-color": p.halo, "text-halo-width": 2 } },
      { id: "place-city", type: "symbol", source: "omt", "source-layer": "place", filter: ["match", ["get", "class"], ["city", "town"], true, false], layout: { "text-field": NAME as never, "text-font": ["Noto Sans Bold"], "text-size": z([[8, 13], [13, 22]]), "text-transform": "uppercase", "text-letter-spacing": 0.18 }, paint: { "text-color": p.label, "text-halo-color": p.halo, "text-halo-width": 2.4 } },
    ],
  } as StyleSpecification;
}

/** WebGL is required for the vector map; old devices get the raster chain. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}
