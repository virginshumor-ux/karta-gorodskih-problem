import { describe, expect, it } from "vitest";
import { DEFAULT_CATS } from "../../src/domain/constants";
import { appealText, emptyFilter, filterComplaints, toCsv } from "../../src/domain/logic";
import type { Category, Complaint, Filter } from "../../src/domain/types";

const road = DEFAULT_CATS.find((c) => c.id === "road") as Category;
const NOW = Date.parse("2026-11-10T12:00:00+07:00");

function c(p: Partial<Complaint>): Complaint {
  return {
    id: "x", demo: false, title: "Яма на въезде во двор", category: "road", description: "Яма около 40 см.", lat: 55.9952, lng: 92.7965,
    address: "улица Борисова, 5", district: "Октябрьский район", status: "published", duplicateOf: null,
    createdAt: NOW - 3600e3, updatedAt: NOW, photos: [], author: "житель_1", mine: false, supports: 12, supportedByMe: false,
    confirms: 0, confirmedByMe: false, history: [], ...p,
  };
}

describe("appealText", () => {
  it("matches the prototype text", () => {
    const created = Date.parse("2026-11-01T10:00:00+07:00");
    expect(appealText(c({ createdAt: created }), road)).toBe(
      "Прошу принять меры по проблеме «Яма на въезде во двор».\n\n" +
        "Категория: Дороги и ямы.\n" +
        "Адрес: г. Красноярск, улица Борисова, 5 (Октябрьский район).\n" +
        "Координаты: 55.99520, 92.79650.\n" +
        `Дата обнаружения: ${new Date(created).toLocaleDateString("ru-RU")}.\n\n` +
        "Яма около 40 см.\n\n" +
        "Проблему подтвердили 13 жителей в приложении «Карта городских проблем».",
    );
  });
  it("uses the right plural and a missing district", () => {
    expect(appealText(c({ supports: 0, district: "" }), road)).toContain("(район не определён)");
    expect(appealText(c({ supports: 0 }), road)).toContain("подтвердили 1 житель в");
    expect(appealText(c({ supports: 2 }), road)).toContain("подтвердили 3 жителя в");
  });
  it("adds the public page link when given (Ф-10)", () => {
    expect(appealText(c({}), road, "https://kgp.example/#/c/x")).toContain("Фото и подробности: https://kgp.example/#/c/x\n\n");
  });
});

describe("filterComplaints", () => {
  const list = [
    c({ id: "pub", status: "published", createdAt: NOW - 1000 }),
    c({ id: "work", status: "work", category: "snow", title: "Наледь", address: "Свободный проспект", createdAt: NOW - 2000 }),
    c({ id: "res", status: "resolved", createdAt: NOW - 40 * 864e5, district: "Центральный район" }),
    c({ id: "mod-other", status: "moderation" }),
    c({ id: "mod-mine", status: "moderation", mine: true, createdAt: NOW - 500 }),
    c({ id: "rej-other", status: "rejected" }),
    c({ id: "dup", status: "duplicate" }),
  ];
  const ctx = { moderator: false, catName: (id: string) => DEFAULT_CATS.find((x) => x.id === id)?.name ?? "", now: NOW };
  const ids = (f: Partial<Filter>, q = "", moderator = false) =>
    filterComplaints(list, { ...emptyFilter(), ...f }, q, { ...ctx, moderator }).map((x) => x.id);

  it("open: public open statuses and own moderation, newest first", () => expect(ids({})).toEqual(["mod-mine", "pub", "work"]));
  it("moderator also sees the moderation queue", () => expect(ids({}, "", true)).toContain("mod-other"));
  it("resolved", () => expect(ids({ status: "resolved" })).toEqual(["res"]));
  it("all never shows duplicates or foreign rejected", () => {
    const all = ids({ status: "all" });
    expect(all).not.toContain("dup");
    expect(all).not.toContain("rej-other");
    expect(all).not.toContain("mod-other");
  });
  it("mine", () => expect(ids({ mine: true, status: "all" })).toEqual(["mod-mine"]));
  it("categories", () => expect(ids({ cats: new Set(["snow"]) })).toEqual(["work"]));
  it("search by text, address and category name", () => {
    expect(ids({}, "свободный")).toEqual(["work"]);
    expect(ids({}, "СНЕГ И")).toEqual(["work"]);
  });
  it("district and period (Ф-02)", () => {
    expect(ids({ status: "all", district: "Центральный район" })).toEqual(["res"]);
    expect(ids({ status: "all", period: "30" })).not.toContain("res");
    expect(ids({ status: "all", period: "all" })).toContain("res");
  });
});

describe("toCsv", () => {
  it("uses ';', a UTF-8 BOM and quotes special values", () => {
    expect(toCsv([{ a: 1, b: 'x;"y"' }, { a: null, b: "строка" }])).toBe('﻿a;b\r\n1;"x;""y"""\r\n;строка');
  });
  it("empty input gives an empty file", () => expect(toCsv([])).toBe(""));
});
