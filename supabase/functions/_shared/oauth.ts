// Shared OAuth plumbing for Yandex ID and VK ID sign-in (406-ФЗ: only Russian identity providers).
//
// Flow (one redirect URI per provider = the Edge Function itself):
//   client → GET /functions/v1/auth-<p>?start=1&platform=web|android&return_to=<site>&hash=<route>
//   function → 302 provider authorize (state = AES-GCM encrypted {platform, return_to, hash, verifier, ts})
//   provider → GET /functions/v1/auth-<p>?code=…&state=…  → code exchange → external user id
//   function → find or create the Supabase user (service role) → generateLink(magiclink) → token_hash
//   function → 302 back: web  <site>#/auth/callback?token_hash=…&hash=<route>
//                         android kgp://auth/callback?token_hash=…
//   client → supabase.auth.verifyOtp({ token_hash, type: "email" }) → normal Supabase session.
// Only the external numeric id is stored (app_metadata); names, phones and e-mails are not requested.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";

export type Platform = "web" | "android";
export const ANDROID_RETURN = "kgp://auth/callback";
const STATE_TTL_MS = 10 * 60 * 1000;

export interface StatePayload {
  platform: Platform;
  returnTo: string;
  hash: string;
  verifier: string;
  ts: number;
}

const b64u = {
  enc(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(s: string): Uint8Array<ArrayBuffer> {
    const p = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(p + "=".repeat((4 - (p.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

async function stateKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("kgp-oauth-state:" + secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypted and authenticated state: the PKCE verifier and the return address never travel in clear text. */
export async function sealState(p: StatePayload, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await stateKey(secret), new TextEncoder().encode(JSON.stringify(p))),
  );
  return b64u.enc(iv) + "." + b64u.enc(ct);
}

export async function openState(s: string, secret: string, now = Date.now()): Promise<StatePayload> {
  const [iv, ct] = s.split(".");
  if (!iv || !ct) throw new Error("bad state");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u.dec(iv) }, await stateKey(secret), b64u.dec(ct));
  const p = JSON.parse(new TextDecoder().decode(plain)) as StatePayload;
  if (now - p.ts > STATE_TTL_MS || p.ts > now + 60_000) throw new Error("state expired");
  return p;
}

export function randomVerifier(): string {
  return b64u.enc(crypto.getRandomValues(new Uint8Array(48)));
}

export async function challengeS256(verifier: string): Promise<string> {
  return b64u.enc(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/**
 * Open-redirect protection: the web client may only return to SITE_URL (and to localhost for development);
 * the Android client always returns to its deep link.
 */
export function allowedReturn(platform: Platform, returnTo: string, siteUrls: string[]): string | null {
  if (platform === "android") return ANDROID_RETURN;
  let u: URL;
  try {
    u = new URL(returnTo);
  } catch {
    return null;
  }
  const clean = u.origin + u.pathname;
  const local = (u.hostname === "localhost" || u.hostname === "127.0.0.1") && (u.protocol === "http:" || u.protocol === "https:");
  const listed = siteUrls.some((s) => {
    try {
      const x = new URL(s);
      return x.origin === u.origin && u.pathname.startsWith(x.pathname);
    } catch {
      return false;
    }
  });
  return local || listed ? clean : null;
}

export function backUrl(p: Pick<StatePayload, "platform" | "returnTo" | "hash">, params: Record<string, string>): string {
  const q = new URLSearchParams(params);
  if (p.platform === "android") return `${ANDROID_RETURN}?${q}`;
  if (p.hash && p.hash.startsWith("#/")) q.set("hash", p.hash);
  return `${p.returnTo}#/auth/callback?${q}`;
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

export function env(name: string, fallback = ""): string {
  return Deno.env.get(name) ?? fallback;
}

export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Finds or creates the Supabase user for the external account and returns a one-time token_hash. */
export async function sessionTokenFor(sb: SupabaseClient, provider: "yandex" | "vk", externalId: string): Promise<string> {
  const prefix = provider === "yandex" ? "ya" : "vk";
  // Technical address, never shown and never used for mail: Supabase needs an e-mail to issue a magic link.
  const email = `${prefix}-${externalId}@${env("KGP_AUTH_EMAIL_DOMAIN", "users.kgp.example.com")}`;
  const appMeta = { kgp_provider: provider, kgp_external_id: externalId };
  const created = await sb.auth.admin.createUser({ email, email_confirm: true, app_metadata: appMeta });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) throw created.error;
  const link = await sb.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const user = link.data.user;
  if (user && user.app_metadata?.kgp_external_id !== externalId) {
    await sb.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, ...appMeta } });
  }
  return link.data.properties.hashed_token;
}

export function functionUrl(req: Request, name: string): string {
  // Behind the Supabase gateway the public URL is SUPABASE_URL/functions/v1/<name>.
  const base = env("SUPABASE_URL");
  if (base) return `${base.replace(/\/$/, "")}/functions/v1/${name}`;
  const u = new URL(req.url);
  return `${u.origin}/functions/v1/${name}`;
}

export function siteUrls(): string[] {
  return env("SITE_URL").split(",").map((s) => s.trim()).filter(Boolean);
}

export function stateSecret(): string {
  return env("KGP_STATE_SECRET") || env("SUPABASE_SERVICE_ROLE_KEY");
}

export function errorBack(p: Pick<StatePayload, "platform" | "returnTo" | "hash"> | null, message: string): Response {
  if (!p) return new Response(message, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return redirect(backUrl(p, { error: "auth_failed", error_description: message }));
}
