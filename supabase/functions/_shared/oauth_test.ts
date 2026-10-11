import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.13";
import { allowedReturn, ANDROID_RETURN, backUrl, challengeS256, openState, randomVerifier, sealState } from "./oauth.ts";

const SECRET = "test-secret";
const base = { platform: "web" as const, returnTo: "https://user.github.io/kgp/", hash: "#/create", verifier: "v", ts: Date.now() };

Deno.test("state is encrypted and round-trips", async () => {
  const s = await sealState(base, SECRET);
  assert(!s.includes("github"), "return address must not be readable in the state");
  assertEquals(await openState(s, SECRET), base);
});

Deno.test("state with a different secret or tampered is rejected", async () => {
  const s = await sealState(base, SECRET);
  await assertRejects(() => openState(s, "other"));
  await assertRejects(() => openState(s.slice(0, -2) + "AA", SECRET));
});

Deno.test("state expires after 10 minutes", async () => {
  const s = await sealState({ ...base, ts: Date.now() - 11 * 60_000 }, SECRET);
  await assertRejects(() => openState(s, SECRET), Error, "expired");
});

Deno.test("return address: only SITE_URL, localhost, or the Android deep link", () => {
  const sites = ["https://user.github.io/kgp/"];
  assertEquals(allowedReturn("web", "https://user.github.io/kgp/index.html?x=1", sites), "https://user.github.io/kgp/index.html");
  assertEquals(allowedReturn("web", "http://127.0.0.1:5173/", sites), "http://127.0.0.1:5173/");
  assertEquals(allowedReturn("web", "https://evil.example/kgp/", sites), null);
  assertEquals(allowedReturn("web", "https://user.github.io/other/", sites), null);
  assertEquals(allowedReturn("web", "javascript:alert(1)", sites), null);
  assertEquals(allowedReturn("android", "https://evil.example/", sites), ANDROID_RETURN);
});

Deno.test("back URL for web keeps the route, for Android uses the deep link", () => {
  assertEquals(backUrl(base, { token_hash: "t" }), "https://user.github.io/kgp/#/auth/callback?token_hash=t&hash=%23%2Fcreate");
  assertEquals(backUrl({ ...base, platform: "android" }, { token_hash: "t" }), "kgp://auth/callback?token_hash=t");
});

Deno.test("PKCE S256 challenge (RFC 7636 test vector)", async () => {
  assertEquals(await challengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert(randomVerifier().length >= 43);
});
