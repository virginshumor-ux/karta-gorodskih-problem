// Yandex ID sign-in (OAuth 2.0 authorization code). See ../_shared/oauth.ts for the whole flow.
import {
  adminClient,
  allowedReturn,
  backUrl,
  env,
  errorBack,
  functionUrl,
  openState,
  type Platform,
  randomVerifier,
  redirect,
  sealState,
  sessionTokenFor,
  siteUrls,
  stateSecret,
  type StatePayload,
} from "../_shared/oauth.ts";

const NAME = "auth-yandex";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const clientId = env("YANDEX_CLIENT_ID");
  const secret = env("YANDEX_CLIENT_SECRET");
  if (!clientId || !secret) return errorBack(null, "Yandex ID is not configured (YANDEX_CLIENT_ID / YANDEX_CLIENT_SECRET)");

  if (url.searchParams.get("start")) {
    const platform: Platform = url.searchParams.get("platform") === "android" ? "android" : "web";
    const returnTo = allowedReturn(platform, url.searchParams.get("return_to") ?? "", siteUrls());
    if (!returnTo) return errorBack(null, "return_to is not allowed");
    const state = await sealState(
      { platform, returnTo, hash: url.searchParams.get("hash") ?? "", verifier: randomVerifier(), ts: Date.now() },
      stateSecret(),
    );
    const auth = new URL("https://oauth.yandex.ru/authorize");
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", functionUrl(req, NAME));
    auth.searchParams.set("state", state);
    auth.searchParams.set("force_confirm", "no");
    return redirect(auth.toString());
  }

  let st: StatePayload | null = null;
  try {
    st = await openState(url.searchParams.get("state") ?? "", stateSecret());
  } catch {
    return errorBack(null, "Ссылка входа устарела. Начните вход заново.");
  }
  if (url.searchParams.get("error")) return errorBack(st, "Вход через Яндекс ID отменён.");
  const code = url.searchParams.get("code");
  if (!code) return errorBack(st, "Яндекс ID не вернул код авторизации.");

  try {
    const tok = await fetch("https://oauth.yandex.ru/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${clientId}:${secret}`) },
      body: new URLSearchParams({ grant_type: "authorization_code", code }),
    });
    if (!tok.ok) throw new Error(`token ${tok.status}`);
    const { access_token } = (await tok.json()) as { access_token?: string };
    if (!access_token) throw new Error("no access_token");

    // login.yandex.ru/info verifies the token; only the numeric id is kept.
    const info = await fetch("https://login.yandex.ru/info?format=json", { headers: { Authorization: `OAuth ${access_token}` } });
    if (!info.ok) throw new Error(`info ${info.status}`);
    const { id } = (await info.json()) as { id?: string };
    if (!id || !/^\d+$/.test(String(id))) throw new Error("no id");

    const tokenHash = await sessionTokenFor(adminClient(), "yandex", String(id));
    return redirect(backUrl(st, { token_hash: tokenHash, provider: "yandex" }));
  } catch (e) {
    console.error("auth-yandex", e);
    return errorBack(st, "Не удалось войти через Яндекс ID. Попробуйте ещё раз.");
  }
});
