import { describe, expect, it } from "vitest";
import { toAppError } from "../../src/domain/errors";
import { distM, esc, fmtDate, inKrsk, plural, uuid } from "../../src/domain/format";
import { hashFor, parseHash } from "../../src/state/router";

describe("format", () => {
  it("plural", () => {
    expect([1, 2, 5, 11, 21, 22, 25, 112].map((n) => plural(n, "обращение", "обращения", "обращений"))).toEqual([
      "обращение", "обращения", "обращений", "обращений", "обращение", "обращения", "обращений", "обращений",
    ]);
  });
  it("distance in metres", () => {
    expect(Math.round(distM({ lat: 56.0042, lng: 92.7735 }, { lat: 56.0042 + 0.00018, lng: 92.7735 }))).toBe(20);
  });
  it("Krasnoyarsk bounding box", () => {
    expect(inKrsk({ lat: 56.0, lng: 92.8 })).toBe(true);
    expect(inKrsk({ lat: 55.5, lng: 92.8 })).toBe(false);
    expect(inKrsk({ lat: null, lng: null })).toBe(false);
  });
  it("escapes html", () => expect(esc(`<img src=x onerror="a">'`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;&#39;"));
  it("relative dates", () => {
    const now = Date.now();
    expect(fmtDate(now - 10e3, now)).toBe("только что");
    expect(fmtDate(now - 5 * 60e3, now)).toBe("5 мин назад");
  });
  it("uuid v4", () => expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
});

describe("errors", () => {
  it("maps server codes to Russian messages", () => {
    expect(toAppError(new Error("KGP_RATE_LIMIT: Можно отправить не более 5 обращений в час")).message).toMatch(/не более 5 обращений в час/);
    expect(toAppError({ message: "KGP_STATUS: Подтвердить можно только актуальное обращение" }).message).toBe("Подтвердить можно только актуальное обращение");
  });
  it("network errors allow an offline draft", () => expect(toAppError(new TypeError("Failed to fetch")).offline).toBe(true));
});

describe("router", () => {
  it("parses deep links", () => {
    expect(parseHash("#/c/abc")).toMatchObject({ view: "detail", id: "abc" });
    expect(parseHash("#/c/abc/appeal")).toMatchObject({ view: "appeal", id: "abc" });
    expect(parseHash("#/admin").view).toBe("admin");
    expect(parseHash("#/unknown").view).toBe("map");
    const r = parseHash("#/auth/callback?token_hash=t1&hash=%23%2Fcreate");
    expect(r.authCallback).toBe(true);
    expect(r.params.get("token_hash")).toBe("t1");
  });
  it("builds hashes", () => {
    expect(hashFor("detail", "a b")).toBe("#/c/a%20b");
    expect(hashFor("map")).toBe("#/");
    expect(hashFor("stats")).toBe("#/stats");
  });
});
