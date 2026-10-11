// VK ID sign-in (OAuth 2.1 + PKCE, id.vk.com). See ../_shared/oauth.ts for the whole flow.
import {
  adminClient,
  allowedReturn,
  backUrl,
  challengeS256,
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

const NAME = "auth-vk";
const VK = env("VK_ID_HOST", "https://id.vk.com");

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const clientId = env("VK_CLIENT_ID");
  if (!clientId) return errorBack(null, "VK ID is not configured (VK_CLIENT_ID)");

  if (url.searchParams.get("start")) {
    const platform: Platform = url.searchParams.get("platform") === "android" ? "android" : "web";
    const returnTo = allowedReturn(platform, url.searchParams.get("return_to") ?? "", siteUrls());
    if (!returnTo) return errorBack(null, "return_to is not allowed");
    const verifier = randomVerifier();
    const state = await sealState({ platform, returnTo, hash: url.searchParams.get("hash") ?? "", verifier, ts: Date.now() }, stateSecret());
    const auth = new URL(`${VK}/authorize`);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", functionUrl(req, NAME));
    auth.searchParams.set("state", state);
    auth.searchParams.set("code_challenge", await challengeS256(verifier));
    auth.searchParams.set("code_challenge_method", "S256");
    auth.searchParams.set("scope", "vkid.personal_info");
    return redirect(auth.toString());
  }

  let st: StatePayload | null = null;
  try {
    st = await openState(url.searchParams.get("state") ?? "", stateSecret());
  } catch {
    return errorBack(null, "Ссылка входа устарела. Начните вход заново.");
  }
  const code = url.searchParams.get("code");
  const deviceId = url.searchParams.get("device_id");
  if (!code || !deviceId) return errorBack(st, "Вход через VK ID отменён.");

  try {
    const tok = await fetch(`${VK}/oauth2/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: st.verifier,
        client_id: clientId,
        device_id: deviceId,
        redirect_uri: functionUrl(req, NAME),
        state: url.searchParams.get("state") ?? "",
      }),
    });
    const t = (await tok.json()) as { access_token?: string; user_id?: number | string; error?: string };
    if (!tok.ok || !t.access_token) throw new Error(`token ${tok.status} ${t.error ?? ""}`);

    // Verify the token with VK and take the user id from VK's answer, not from the token response alone.
    const info = await fetch(`${VK}/oauth2/user_info`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, access_token: t.access_token }),
    });
    const u = (await info.json()) as { user?: { user_id?: string | number } };
    const id = String(u.user?.user_id ?? "");
    if (!info.ok || !/^\d+$/.test(id)) throw new Error(`user_info ${info.status}`);

    const tokenHash = await sessionTokenFor(adminClient(), "vk", id);
    return redirect(backUrl(st, { token_hash: tokenHash, provider: "vk" }));
  } catch (e) {
    console.error("auth-vk", e);
    return errorBack(st, "Не удалось войти через VK ID. Попробуйте ещё раз.");
  }
});
