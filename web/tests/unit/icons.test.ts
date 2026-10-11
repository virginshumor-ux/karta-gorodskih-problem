import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATS } from "../../src/domain/constants";
import { ICONS } from "../../src/ui/icons";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));

describe("icon font subset", () => {
  it("every icon used in the code is in the downloaded subset", () => {
    const used = new Set<string>(DEFAULT_CATS.map((c) => c.icon));
    for (const f of files(SRC).filter((x) => x.endsWith(".ts"))) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/ico\(\s*"([a-z_0-9]+)"/g)) used.add(m[1] as string);
      for (const m of s.matchAll(/ico\([^)]*\? "([a-z_0-9]+)" : "([a-z_0-9]+)"/g)) [m[1], m[2]].forEach((x) => used.add(x as string));
      // navigation tables: ["map", "map", "Карта"]
      for (const m of s.matchAll(/\["[a-z]+", "([a-z_]+)", "[А-Яа-яЁё «»]*"\]/g)) used.add(m[1] as string);
      // WMO weather codes: ["Ясно", "clear_day", "clear_night"]
      for (const m of s.matchAll(/\["[А-Яа-яЁё ,—]+", "([a-z_]+)", "([a-z_]+)"\]/g)) [m[1], m[2]].forEach((x) => used.add(x as string));
    }
    const missing = [...used].filter((i) => !ICONS.includes(i));
    expect(missing).toEqual([]);
  });
});
