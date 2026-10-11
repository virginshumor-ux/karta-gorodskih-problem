// Pure parts of the tile logic (no Leaflet, no DOM) — shared with unit tests.
// Under the live map there is always a built-in Krasnoyarsk snapshot (city overview + detailed SFU area),
// so the screen is never empty. Live tiles come from the first source that answers with a real tile:
// tile.openstreetmap.org rejects browsers without a proper Referer and serves an "Access blocked" image,
// sometimes with HTTP 200, so the probe also looks at the pixels.
export interface TileSource {
  id: string;
  url: string;
  probe: string;
  attr: string;
  maxZoom: number;
}

export const TILE_SOURCES: TileSource[] = [
  { id: "osm", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", probe: "https://tile.openstreetmap.org/15/24828/10203.png", attr: "© участники OpenStreetMap", maxZoom: 19 },
  { id: "osmde", url: "https://tile.openstreetmap.de/{z}/{x}/{y}.png", probe: "https://tile.openstreetmap.de/15/24828/10203.png", attr: "© участники OpenStreetMap · сервер openstreetmap.de", maxZoom: 18 },
  { id: "osmfr", url: "https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", probe: "https://a.tile.openstreetmap.fr/osmfr/15/24828/10203.png", attr: "© участники OpenStreetMap · сервер OSM France", maxZoom: 19 },
];

export const SNAPSHOTS = {
  city: { url: "snapshots/city.jpg", bounds: [[55.94919982336745, 92.6806640625], [56.12106042504408, 93.1201171875]] as [[number, number], [number, number]] },
  campus: { url: "snapshots/campus.jpg", bounds: [[55.979945357882315, 92.735595703125], [56.02294807962744, 92.83447265625]] as [[number, number], [number, number]] },
};

/**
 * The OSM "Access blocked" stub has a yellow-black stripe; real OSM tiles have almost no saturated yellow
 * or pure black. `data` is RGBA pixels (e.g. a 128×128 downscale).
 */
export function isBlockedPixels(data: ArrayLike<number>): boolean {
  let black = 0;
  let yellow = 0;
  for (let i = 0; i + 2 < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    if (r < 45 && g < 45 && b < 45) black++;
    else if (r > 150 && g > 150 && b < 80 && Math.abs(r - g) < 50) yellow++;
  }
  return black > 250 && yellow > 150;
}
