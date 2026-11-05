import { describe, expect, it } from "vitest";
import { achievements, fmtDistance, nearest, sortComplaints, suggestCategory } from "../../src/domain/smart";
import type { Complaint, User } from "../../src/domain/types";

const NOW = Date.parse("2026-11-10T12:00:00+07:00");

function c(p: Partial<Complaint>): Complaint {
  return {
    id: "x", demo: false, title: "Яма", category: "road", description: "", lat: 56.0, lng: 92.8,
    address: "улица Борисова, 5", district: "Октябрьский район", status: "published", duplicateOf: null,
    createdAt: NOW, updatedAt: NOW, photos: [], author: "житель_1", mine: false, supports: 0, supportedByMe: false,
    confirms: 0, confirmedByMe: false, history: [], comments: 0, ...p,
  };
}

const user = (stats: Partial<User["stats"]> = {}): User => ({
  id: "u", nick: "житель", role: "user", provider: "demo", notifyEnabled: true, isBlocked: false, home: null,
  stats: { complaints: 0, solved: 0, supported: 0, confirmed: 0, comments: 0, ...stats },
});

describe("suggestCategory", () => {
  it("recognises typical problems", () => {
    expect(suggestCategory("Большая яма на дороге у остановки")).toBe("road");
    expect(suggestCategory("Не горит фонарь во дворе")).toBe("light");
    expect(suggestCategory("Сосульки на крыше над входом")).toBe("ice");
    expect(suggestCategory("Тротуар не чищен, сугробы и гололёд")).toBe("snow");
    expect(suggestCategory("Переполнены мусорные контейнеры")).toBe("trash");
  });
  it("ignores case and ё", () => expect(suggestCategory("ГОЛОЛЁД НА ПЕРЕХОДЕ")).toBe("snow"));
  it("returns null when nothing clearly matches", () => {
    expect(suggestCategory("Проблема")).toBeNull();
    expect(suggestCategory("")).toBeNull();
  });
});

describe("sortComplaints", () => {
  const a = c({ id: "a", createdAt: NOW - 3000, supports: 5, lat: 56.01, lng: 92.8 });
  const b = c({ id: "b", createdAt: NOW - 1000, supports: 1, lat: 56.1, lng: 92.9 });
  const d = c({ id: "d", createdAt: NOW - 2000, supports: 5, lat: 56.0, lng: 92.8 });
  const ids = (l: Complaint[]) => l.map((x) => x.id);
  it("new: newest first", () => expect(ids(sortComplaints([a, b, d], "new", null))).toEqual(["b", "d", "a"]));
  it("popular: most supports, ties by date", () => expect(ids(sortComplaints([a, b, d], "popular", null))).toEqual(["d", "a", "b"]));
  it("near: closest to the origin", () => expect(ids(sortComplaints([a, b, d], "near", { lat: 56.0, lng: 92.8 }))).toEqual(["d", "a", "b"]));
  it("near without a position falls back to newest", () => expect(ids(sortComplaints([a, b, d], "near", null))).toEqual(["b", "d", "a"]));
  it("does not mutate the input", () => {
    const l = [a, b, d];
    sortComplaints(l, "popular", null);
    expect(ids(l)).toEqual(["a", "b", "d"]);
  });
  it("nearest finds the closest complaint", () => expect(nearest([a, b, d], { lat: 56.0001, lng: 92.8 })?.c.id).toBe("d"));
});

describe("fmtDistance", () => {
  it("metres are rounded to 10 m, at least 10 m", () => {
    expect(fmtDistance(3)).toBe("10 м");
    expect(fmtDistance(347)).toBe("350 м");
  });
  it("kilometres with a decimal comma", () => {
    expect(fmtDistance(1530)).toBe("1,5 км");
    expect(fmtDistance(23_400)).toBe("23 км");
  });
});

describe("achievements", () => {
  it("nothing is done for a new user", () => {
    expect(achievements(user(), []).filter((x) => x.done)).toEqual([]);
  });
  it("counts own complaints, supports and districts", () => {
    const mine = [
      c({ id: "1", mine: true, category: "snow" }),
      c({ id: "2", mine: true, category: "ice", district: "Центральный район" }),
      c({ id: "3", mine: true, category: "snow", status: "resolved" }),
    ];
    const list = achievements(user({ complaints: 3, supported: 10, comments: 2 }), mine);
    const by = Object.fromEntries(list.map((x) => [x.id, x]));
    expect(by.first?.done).toBe(true);
    expect(by.active?.progress).toBe(3);
    expect(by.active?.done).toBe(false);
    expect(by.neighbour?.done).toBe(true);
    expect(by.winter?.done).toBe(true);
    expect(by.result?.done).toBe(true);
    expect(by.explorer?.done).toBe(true);
    expect(by.voice?.progress).toBe(2);
  });
  it("progress never exceeds the goal", () => {
    for (const a of achievements(user({ supported: 99, comments: 99 }), [])) expect(a.progress).toBeLessThanOrEqual(a.goal);
  });
});
