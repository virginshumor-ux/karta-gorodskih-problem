import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { isBlockedPixels, TILE_SOURCES } from "../../src/map/tileSources";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** Nearest-neighbour downscale to 128×128, like drawImage in the browser check. */
function scaled(png: PNG): Uint8ClampedArray {
  const out = new Uint8ClampedArray(128 * 128 * 4);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const sx = Math.floor((x * png.width) / 128);
      const sy = Math.floor((y * png.height) / 128);
      const si = (sy * png.width + sx) * 4;
      out.set(png.data.subarray(si, si + 4), (y * 128 + x) * 4);
    }
  return out;
}

describe("isBlockedTile", () => {
  it("recognizes the real OSM 'Access blocked' stub", () => {
    const png = PNG.sync.read(readFileSync(fixture("blocked_tile.png")));
    expect(isBlockedPixels(scaled(png))).toBe(true);
  });

  it("does not flag an ordinary map tile (light colours, thin roads, a few labels)", () => {
    const data = new Uint8ClampedArray(128 * 128 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const p = i / 4;
      const road = p % 128 === 64 || Math.floor(p / 128) === 30;
      data.set(road ? [255, 255, 255, 255] : [242, 239, 233, 255], i);
      if (p % 977 === 0) data.set([40, 40, 40, 255], i);
      if (p % 503 === 0) data.set([247, 250, 191, 255], i);
    }
    expect(isBlockedPixels(data)).toBe(false);
  });

  it("tile chain is osm.org → osm.de → osm.fr, without CARTO, always with attribution", () => {
    expect(TILE_SOURCES.map((s) => s.id)).toEqual(["osm", "osmde", "osmfr"]);
    expect(TILE_SOURCES.every((s) => !/carto/i.test(s.url))).toBe(true);
    expect(TILE_SOURCES.every((s) => s.attr.includes("© участники OpenStreetMap"))).toBe(true);
  });
});
