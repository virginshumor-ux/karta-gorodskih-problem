// leaflet.markercluster is a UMD plugin that extends the global `L`, so Leaflet must be global first.
import * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";

const g = globalThis as unknown as { L?: typeof Leaflet };
g.L = { ...Leaflet } as typeof Leaflet;

export const L = g.L as typeof Leaflet;
