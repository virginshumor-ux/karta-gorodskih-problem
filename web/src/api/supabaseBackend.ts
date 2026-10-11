import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";
import { DEFAULT_CATS } from "../domain/constants";
import { AppError, toAppError } from "../domain/errors";
import type {
  AdminUser,
  AppNotification,
  Category,
  Complaint,
  Duplicate,
  HistoryItem,
  Photo,
  Report,
  Role,
  Stats,
  Status,
  User,
} from "../domain/types";
import type { AuthState, Backend, BackendEvents, NewComplaint } from "./backend";
import { kvGet, kvSet } from "./db";

interface FeedRow {
  id: string;
  category_id: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  address: string;
  district: string;
  status: Status;
  duplicate_of: string | null;
  supports_count: number;
  confirms_count: number;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  author_nickname: string;
  is_mine: boolean;
  supported_by_me: boolean;
  confirmed_by_me: boolean;
  photos: { id: string; path: string; kind: "before" | "after"; approved: boolean }[];
}

interface ProfileJson {
  id: string;
  nickname: string;
  provider: User["provider"];
  role: Role;
  is_blocked: boolean;
  notify_enabled: boolean;
  complaints: number;
  solved: number;
  supported: number;
}

const FEED_COLUMNS =
  "id,category_id,title,description,lat,lng,address,district,status,duplicate_of,supports_count,confirms_count,is_demo,created_at,updated_at,author_nickname,is_mine,supported_by_me,confirmed_by_me,photos";
const SIGNED_TTL = 3600;

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw toAppError(r.error);
  return r.data;
}

export class SupabaseBackend implements Backend {
  readonly mode = "supabase" as const;
  private sb: SupabaseClient;
  private events: BackendEvents | null = null;
  private channel: RealtimeChannel | null = null;
  private signed = new Map<string, { url: string; exp: number }>();
  private userId: string | null = null;

  constructor() {
    this.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "kgp.auth" },
    });
  }

  async init(events: BackendEvents): Promise<AuthState> {
    this.events = events;
    this.sb.auth.onAuthStateChange((ev, session) => {
      if (ev === "SIGNED_OUT") {
        this.userId = null;
        this.subscribe(null);
        events.onAuth({ kind: "guest" });
      } else if (ev === "TOKEN_REFRESHED" && session) {
        this.sb.realtime.setAuth(session.access_token);
      }
    });
    this.subscribeComplaints();
    const { data } = await this.sb.auth.getSession();
    try {
      return await this.stateFor(data.session);
    } catch (e) {
      // Offline start with a stored session: keep the user signed in from the cached profile.
      const cached = await kvGet<User>("profile");
      if (data.session && cached && toAppError(e).offline) {
        this.userId = cached.value.id;
        return { kind: "user", user: cached.value };
      }
      throw e;
    }
  }

  private async stateFor(session: Session | null): Promise<AuthState> {
    if (!session) {
      this.userId = null;
      return { kind: "guest" };
    }
    this.userId = session.user.id;
    const p = check(await this.sb.rpc("my_profile")) as ProfileJson | null;
    const provider: User["provider"] = session.user.is_anonymous
      ? "demo"
      : ((session.user.app_metadata?.kgp_provider as User["provider"] | undefined) ?? "demo");
    if (!p) return { kind: "needsProfile", provider };
    const user = this.toUser(p);
    await kvSet("profile", user);
    this.subscribe(user.id);
    return { kind: "user", user };
  }

  private toUser(p: ProfileJson): User {
    return {
      id: p.id,
      nick: p.nickname,
      provider: p.provider,
      role: p.role,
      notifyEnabled: p.notify_enabled,
      isBlocked: p.is_blocked,
      stats: { complaints: p.complaints, solved: p.solved, supported: p.supported },
    };
  }

  // ---------- realtime ----------

  private subscribeComplaints(): void {
    this.sb
      .channel("complaints")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, (p) => {
        const id = (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id;
        if (id) this.events?.onComplaintChanged(id);
      })
      .subscribe();
  }

  private subscribe(userId: string | null): void {
    if (this.channel) {
      void this.sb.removeChannel(this.channel);
      this.channel = null;
    }
    if (!userId) return;
    this.channel = this.sb
      .channel("notifications:" + userId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (p) => {
          const n = p.new as { id: string; complaint_id: string | null; text: string; created_at: string; read_at: string | null };
          this.events?.onNotification({
            id: n.id,
            complaintId: n.complaint_id,
            text: n.text,
            at: Date.parse(n.created_at),
            read: !!n.read_at,
            cat: "",
          });
        },
      )
      .subscribe();
  }

  // ---------- reading ----------

  async categories(): Promise<Category[]> {
    try {
      const rows = check(
        await this.sb.from("categories").select("id,name,icon,color,org_hint,sort,is_active").order("sort"),
      ) as { id: string; name: string; icon: string; color: string; org_hint: string; is_active: boolean }[];
      const cats = rows.filter((r) => r.is_active).map((r) => ({ id: r.id, name: r.name, icon: r.icon, color: r.color, org: r.org_hint }));
      await kvSet("categories", cats);
      return cats;
    } catch (e) {
      const cached = (await kvGet<Category[]>("categories"))?.value;
      if (cached?.length) return cached;
      if (toAppError(e).offline) return DEFAULT_CATS;
      throw e;
    }
  }

  async feed(): Promise<Complaint[]> {
    const rows = check(
      await this.sb.from("complaint_feed").select(FEED_COLUMNS).order("created_at", { ascending: false }).limit(1000),
    ) as FeedRow[];
    await this.signPhotos(rows.flatMap((r) => r.photos.slice(0, 1).map((p) => p.path)));
    return rows.map((r) => this.toComplaint(r));
  }

  async complaint(id: string): Promise<Complaint | null> {
    const row = check(await this.sb.from("complaint_feed").select(FEED_COLUMNS).eq("id", id).maybeSingle()) as FeedRow | null;
    if (!row) return null;
    const hist = check(
      await this.sb
        .from("status_history")
        .select("id,new_status,actor_label,comment,created_at")
        .eq("complaint_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    ) as { new_status: Status; actor_label: string; comment: string; created_at: string }[];
    await this.signPhotos(row.photos.map((p) => p.path));
    const c = this.toComplaint(row);
    c.history = hist.map<HistoryItem>((h) => ({ status: h.new_status, at: Date.parse(h.created_at), by: h.actor_label, comment: h.comment }));
    return c;
  }

  private async signPhotos(paths: string[]): Promise<void> {
    const now = Date.now();
    const need = [...new Set(paths)].filter((p) => (this.signed.get(p)?.exp ?? 0) < now + 60_000);
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      const { data } = await this.sb.storage.from("photos").createSignedUrls(chunk, SIGNED_TTL);
      for (const s of data ?? []) if (s.signedUrl && s.path) this.signed.set(s.path, { url: s.signedUrl, exp: now + SIGNED_TTL * 1000 });
    }
  }

  private toComplaint(r: FeedRow): Complaint {
    const photos: Photo[] = r.photos.map((p) => ({ ...p, url: this.signed.get(p.path)?.url ?? "" }));
    return {
      id: r.id,
      demo: r.is_demo,
      title: r.title,
      category: r.category_id,
      description: r.description,
      lat: r.lat,
      lng: r.lng,
      address: r.address,
      district: r.district,
      status: r.status,
      duplicateOf: r.duplicate_of,
      createdAt: Date.parse(r.created_at),
      updatedAt: Date.parse(r.updated_at),
      photos,
      author: r.author_nickname,
      mine: r.is_mine,
      supports: r.supports_count,
      supportedByMe: r.supported_by_me,
      confirms: r.confirms_count,
      confirmedByMe: r.confirmed_by_me,
      history: [],
    };
  }

  async nearbyDuplicates(lat: number, lng: number, category: string): Promise<Duplicate[]> {
    const rows = check(
      await this.sb.rpc("nearby_duplicates", { p_lat: lat, p_lng: lng, p_category: category, p_radius_m: 30 }),
    ) as { id: string; title: string; status: Status; supports_count: number; address: string; distance_m: number }[];
    return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, supports: r.supports_count, address: r.address, distance: r.distance_m }));
  }

  async stats(): Promise<Stats> {
    const s = check(await this.sb.rpc("stats_summary", { p_days: 21 })) as {
      total: number;
      open: number;
      resolved: number;
      supports: number;
      by_day: { day: string; n: number }[];
      by_category: { category_id: string; n: number }[];
      by_status: { status: Status; n: number }[];
      by_district: { district: string; n: number }[];
      median_moderation_hours: number | null;
      median_resolution_days: number | null;
    };
    return {
      total: s.total,
      open: s.open,
      resolved: s.resolved,
      supports: s.supports,
      byDay: s.by_day,
      byCategory: s.by_category.map((x) => ({ categoryId: x.category_id, n: x.n })),
      byStatus: s.by_status,
      byDistrict: s.by_district,
      medianModerationHours: s.median_moderation_hours,
      medianResolutionDays: s.median_resolution_days,
    };
  }

  // ---------- auth ----------

  async signInDemo(): Promise<AuthState> {
    if (!CONFIG.demoLoginEnabled) throw new AppError("Демо-вход отключён.");
    const r = await this.sb.auth.signInAnonymously();
    if (r.error) throw toAppError(r.error);
    return this.stateFor(r.data.session);
  }

  providerAvailable(provider: "yandex" | "vk"): boolean {
    return provider === "yandex" ? !!CONFIG.yandexClientId : !!CONFIG.vkClientId;
  }

  async signInWith(provider: "yandex" | "vk", returnHash: string): Promise<void> {
    if (!this.providerAvailable(provider)) throw new AppError(`Вход через ${provider === "yandex" ? "Яндекс ID" : "VK ID"} ещё настраивается. Используйте демо-вход.`);
    // The Edge Function is the OAuth redirect target; it returns to this page with a one-time token_hash.
    const site = location.href.split("#")[0] ?? "";
    const fn = `${CONFIG.supabaseUrl}/functions/v1/auth-${provider}`;
    location.assign(`${fn}?start=1&platform=web&return_to=${encodeURIComponent(site)}&hash=${encodeURIComponent(returnHash)}`);
  }

  async finishRedirect(params: URLSearchParams): Promise<AuthState> {
    const err = params.get("error");
    if (err) throw new AppError(params.get("error_description") || "Вход не выполнен. Попробуйте ещё раз.");
    const tokenHash = params.get("token_hash");
    if (!tokenHash) throw new AppError("Ссылка входа устарела. Войдите ещё раз.");
    const r = await this.sb.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (r.error) throw toAppError(r.error);
    return this.stateFor(r.data.session);
  }

  async completeProfile(nickname: string, consent: boolean): Promise<AuthState> {
    check(await this.sb.rpc("complete_profile", { p_nickname: nickname, p_consent: consent }));
    const { data } = await this.sb.auth.getSession();
    return this.stateFor(data.session);
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
    await kvSet("profile", null);
  }

  async deleteAccount(): Promise<void> {
    const r = await this.sb.functions.invoke("delete-account", { method: "POST" });
    if (r.error) throw toAppError(r.error);
    await this.sb.auth.signOut({ scope: "local" });
    await kvSet("profile", null);
  }

  async updateSettings(notifyEnabled: boolean): Promise<User> {
    return this.toUser(check(await this.sb.rpc("update_my_settings", { p_notify_enabled: notifyEnabled })) as ProfileJson);
  }

  // ---------- citizen actions ----------

  async createComplaint(c: NewComplaint): Promise<string> {
    if (!this.userId) throw new AppError("Войдите, чтобы отправить обращение.", "KGP_AUTH");
    const paths: string[] = [];
    for (const [i, blob] of c.photos.entries()) {
      const path = `${this.userId}/${c.id}/${i + 1}.jpg`;
      const up = await this.sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (up.error) throw toAppError(up.error);
      paths.push(path);
    }
    return check(
      await this.sb.rpc("create_complaint", {
        p_id: c.id,
        p_category: c.category,
        p_title: c.title,
        p_description: c.description,
        p_lat: c.lat,
        p_lng: c.lng,
        p_address: c.address,
        p_district: c.district,
        p_photos: paths,
      }),
    ) as string;
  }

  async setSupport(id: string, on: boolean): Promise<number> {
    return check(await this.sb.rpc("set_support", { p_id: id, p_on: on })) as number;
  }

  async confirm(id: string, resolved: boolean): Promise<{ status: Status; confirms: number }> {
    const r = check(await this.sb.rpc("confirm_resolution", { p_id: id, p_resolved: resolved })) as { status: Status; confirms_count: number };
    return { status: r.status, confirms: r.confirms_count };
  }

  async markSent(id: string): Promise<void> {
    check(await this.sb.rpc("author_mark_sent", { p_id: id }));
  }

  async addAfterPhoto(id: string, photo: Blob): Promise<void> {
    if (!this.userId) throw new AppError("Войдите, чтобы продолжить.", "KGP_AUTH");
    const path = `${this.userId}/${id}/after-${Date.now()}.jpg`;
    const up = await this.sb.storage.from("photos").upload(path, photo, { contentType: "image/jpeg", upsert: true });
    if (up.error) throw toAppError(up.error);
    check(await this.sb.rpc("add_after_photo", { p_id: id, p_path: path }));
  }

  async report(id: string, reason: string): Promise<void> {
    check(await this.sb.rpc("report_complaint", { p_id: id, p_reason: reason }));
  }

  async notifications(): Promise<AppNotification[]> {
    if (!this.userId) return [];
    const rows = check(
      await this.sb
        .from("notifications")
        .select("id,complaint_id,text,read_at,created_at,complaints(category_id)")
        .order("created_at", { ascending: false })
        .limit(100),
    ) as unknown as { id: string; complaint_id: string | null; text: string; read_at: string | null; created_at: string; complaints: { category_id: string } | null }[];
    return rows.map((n) => ({
      id: n.id,
      complaintId: n.complaint_id,
      text: n.text,
      at: Date.parse(n.created_at),
      read: !!n.read_at,
      cat: n.complaints?.category_id ?? "other",
    }));
  }

  async markRead(ids?: string[]): Promise<void> {
    check(await this.sb.rpc("mark_notifications_read", { p_ids: ids ?? null }));
  }

  // ---------- moderation and administration ----------

  async moderateStatus(id: string, status: Status, comment?: string): Promise<void> {
    check(await this.sb.rpc("moderate_set_status", { p_id: id, p_status: status, p_comment: comment ?? null }));
  }

  async markDuplicate(id: string, originalId: string): Promise<void> {
    check(await this.sb.rpc("moderate_mark_duplicate", { p_id: id, p_original: originalId }));
  }

  async reviewAfterPhoto(photoId: string, approve: boolean): Promise<void> {
    check(await this.sb.rpc("moderate_review_after_photo", { p_photo: photoId, p_approve: approve }));
  }

  async reports(): Promise<Report[]> {
    const rows = check(
      await this.sb
        .from("report_feed")
        .select("id,complaint_id,complaint_title,complaint_status,reason,reporter_nickname,created_at,resolution")
        .order("created_at", { ascending: false })
        .limit(200),
    ) as { id: string; complaint_id: string; complaint_title: string; complaint_status: Status; reason: string; reporter_nickname: string | null; created_at: string; resolution: string | null }[];
    return rows.map((r) => ({
      id: r.id,
      complaintId: r.complaint_id,
      complaintTitle: r.complaint_title,
      complaintStatus: r.complaint_status,
      reason: r.reason,
      reporter: r.reporter_nickname ?? "удалённый пользователь",
      at: Date.parse(r.created_at),
      resolution: r.resolution,
    }));
  }

  async resolveReport(id: string, resolution: string, hide: boolean): Promise<void> {
    check(await this.sb.rpc("moderate_resolve_report", { p_report: id, p_resolution: resolution, p_hide: hide }));
  }

  async users(search: string): Promise<AdminUser[]> {
    const rows = check(await this.sb.rpc("admin_list_users", { p_search: search || null })) as {
      id: string;
      nickname: string;
      provider: User["provider"];
      role: Role;
      is_blocked: boolean;
      created_at: string;
      complaints: number;
      reports_against: number;
    }[];
    return rows.map((u) => ({
      id: u.id,
      nick: u.nickname,
      provider: u.provider,
      role: u.role,
      isBlocked: u.is_blocked,
      createdAt: Date.parse(u.created_at),
      complaints: u.complaints,
      reportsAgainst: u.reports_against,
    }));
  }

  async setBlocked(userId: string, blocked: boolean): Promise<void> {
    check(await this.sb.rpc("admin_set_blocked", { p_user: userId, p_blocked: blocked }));
  }

  async setRole(userId: string, role: Role): Promise<void> {
    check(await this.sb.rpc("admin_set_role", { p_user: userId, p_role: role }));
  }

  async saveCategory(c: Category & { isNew?: boolean }): Promise<void> {
    const row = { id: c.id, name: c.name, icon: c.icon, color: c.color, org_hint: c.org };
    if (c.isNew) check(await this.sb.from("categories").insert({ ...row, sort: 50 }));
    else check(await this.sb.from("categories").update(row).eq("id", c.id));
  }

  async exportRows(): Promise<Record<string, unknown>[]> {
    return check(await this.sb.from("analytics_export").select("*").order("created_at").limit(10000)) as Record<string, unknown>[];
  }
}
