import type { AuthState, Backend } from "../api/backend";
import type { WeatherState } from "../api/weather";
import { DEFAULT_CATS } from "../domain/constants";
import { emptyFilter, filterComplaints } from "../domain/logic";
import type { AppNotification, Category, Complaint, Draft, User } from "../domain/types";
import type { MapMode } from "../map/tiles";
import { ls } from "./storage";

export type View =
  | "map"
  | "list"
  | "detail"
  | "create"
  | "notif"
  | "profile"
  | "stats"
  | "weather"
  | "about"
  | "appeal"
  | "privacy"
  | "admin";

/** Action to continue after sign-in (the prototype's S.pending). Survives the OAuth redirect. */
export type Pending = { go: View } | { act: string; id: string } | null;

export const S = {
  backend: null as unknown as Backend,
  auth: { kind: "guest" } as AuthState,
  onboarded: ls.get("onboarded", false),
  view: "map" as View,
  prev: [] as View[],
  complaints: [] as Complaint[],
  notifications: [] as AppNotification[],
  cats: DEFAULT_CATS as Category[],
  filter: emptyFilter(),
  search: "",
  selected: null as string | null,
  detailId: null as string | null,
  detail: null as Complaint | null,
  detailPhoto: 0,
  draft: null as Draft | null,
  weather: null as WeatherState | null,
  mapMode: "pending" as MapMode,
  pending: null as Pending,
  /** Feed is shown from the device cache because the server is unreachable. */
  offlineSince: null as number | null,
  pendingDrafts: 0,
  loading: true,
};

export const user = (): User | null => (S.auth.kind === "user" ? S.auth.user : null);
export const isModerator = (): boolean => {
  const u = user();
  return !!u && (u.role === "moderator" || u.role === "admin");
};
export const isAdmin = (): boolean => user()?.role === "admin" || (S.backend?.mode === "local" && isModerator());

export function cat(id: string): Category {
  return S.cats.find((c) => c.id === id) ?? DEFAULT_CATS.find((c) => c.id === id) ?? (DEFAULT_CATS[8] as Category);
}

export function filtered(): Complaint[] {
  return filterComplaints(S.complaints, S.filter, S.search, { moderator: isModerator(), catName: (id) => cat(id).name });
}

export function findComplaint(id: string | null): Complaint | null {
  if (!id) return null;
  if (S.detail?.id === id) return S.detail;
  return S.complaints.find((c) => c.id === id) ?? null;
}

/** Replaces one complaint in the feed after an action (keeps the list order). */
export function upsertComplaint(c: Complaint): void {
  const i = S.complaints.findIndex((x) => x.id === c.id);
  if (i >= 0) S.complaints[i] = { ...c, history: c.history.length ? c.history : (S.complaints[i] as Complaint).history };
  else S.complaints.push(c);
  if (S.detail?.id === c.id) S.detail = { ...c, history: c.history.length ? c.history : S.detail.history };
}

export const isDesktop = (): boolean => matchMedia("(min-width: 900px)").matches;
