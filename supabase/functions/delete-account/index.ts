// Ф-15: delete the caller's account and personal data.
// Photos are removed through the Storage API (direct DELETE on storage.objects is not allowed by Supabase),
// then auth.admin.deleteUser cascades to profiles, complaints, supports, confirmations and notifications.
import { adminClient } from "../_shared/oauth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const sb = adminClient();
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) return json(401, { error: "Требуется вход" });
  const uid = data.user.id;

  try {
    // Every object of the user lives under photos/<uid>/<complaint id>/…
    const paths: string[] = [];
    const top = await sb.storage.from("photos").list(uid, { limit: 1000 });
    if (top.error) throw top.error;
    for (const folder of top.data ?? []) {
      if (folder.id) {
        paths.push(`${uid}/${folder.name}`);
        continue;
      }
      const inner = await sb.storage.from("photos").list(`${uid}/${folder.name}`, { limit: 1000 });
      if (inner.error) throw inner.error;
      for (const f of inner.data ?? []) paths.push(`${uid}/${folder.name}/${f.name}`);
    }
    for (let i = 0; i < paths.length; i += 100) {
      const r = await sb.storage.from("photos").remove(paths.slice(i, i + 100));
      if (r.error) throw r.error;
    }

    const del = await sb.auth.admin.deleteUser(uid);
    if (del.error) throw del.error;
    return json(200, { deleted: true, photos: paths.length });
  } catch (e) {
    console.error("delete-account", e);
    return json(500, { error: "Не удалось удалить учётную запись. Повторите попытку." });
  }
});
