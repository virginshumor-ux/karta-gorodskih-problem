import type { View } from "./store";

// GitHub Pages has no SPA fallback, so routes live in the hash: #/list, #/c/<id>, #/c/<id>/appeal, #/admin …
export interface Route {
  view: View;
  id?: string;
  params: URLSearchParams;
  /** OAuth return (#/auth/callback?token_hash=…). */
  authCallback?: boolean;
}

const VIEWS: View[] = ["map", "list", "create", "notif", "profile", "stats", "weather", "about", "privacy", "admin"];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "auth" && parts[1] === "callback") return { view: "map", params, authCallback: true };
  if (parts[0] === "c" && parts[1]) return { view: parts[2] === "appeal" ? "appeal" : "detail", id: decodeURIComponent(parts[1]), params };
  const v = parts[0] as View | undefined;
  return { view: v && VIEWS.includes(v) ? v : "map", params };
}

export function hashFor(view: View, id?: string | null): string {
  if (view === "detail" && id) return `#/c/${encodeURIComponent(id)}`;
  if (view === "appeal" && id) return `#/c/${encodeURIComponent(id)}/appeal`;
  if (view === "map") return "#/";
  return `#/${view}`;
}
