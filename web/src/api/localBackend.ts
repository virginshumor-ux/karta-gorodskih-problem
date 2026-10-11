import { CONFIRM_NEED, DAY, DEFAULT_CATS, MAX_PER_HOUR, OPEN_STATUSES, STATUSES } from "../domain/constants";
import { AppError } from "../domain/errors";
import { distM, plural, uuid } from "../domain/format";
import type { AdminUser, AppNotification, Category, Complaint, Duplicate, HistoryItem, Report, Role, Stats, Status, User } from "../domain/types";
import { ls } from "../state/storage";
import type { AuthState, Backend, BackendEvents, NewComplaint } from "./backend";
import { db, type LocalComplaint } from "./db";
import { blobToDataUrl } from "./photos";

const ME = "local-user";
const ORG = Object.fromEntries(DEFAULT_CATS.map((c) => [c.id, c.org]));

/** Demo data of the prototype (seedComplaints in app.js); "mine" items belong to whoever signs in locally. */
function seedComplaints(now = Date.now()): LocalComplaint[] {
  type S = { n: number; cat: string; title: string; desc: string; lat: number; lng: number; addr: string; district: string; status: Status; days: number; h?: number; sup: number; conf?: number; mine?: boolean };
  const rows: S[] = [
    { n: 1, cat: "snow", title: "Наледь на ступенях у входа в корпус", desc: "Ступени у главного входа покрыты льдом, песка нет. Утром несколько человек поскользнулись.", lat: 56.0042, lng: 92.7735, addr: "Свободный проспект, 79 с1", district: "Октябрьский район", status: "work", days: 2, sup: 31 },
    { n: 2, cat: "transit", title: "Разбито стекло остановочного павильона", desc: "Осколки лежат на скамейке и под ногами, павильон не защищает от ветра.", lat: 56.0031, lng: 92.7668, addr: "Свободный проспект", district: "Октябрьский район", status: "published", days: 1, h: 5, sup: 24 },
    { n: 3, cat: "light", title: "Не горят фонари во дворе общежития", desc: "Третий вечер подряд не работают два фонаря вдоль дорожки к общежитию, после 18:00 темно.", lat: 55.9998, lng: 92.7752, addr: "Свободный проспект, 81В", district: "Октябрьский район", status: "sent", days: 4, sup: 18 },
    { n: 4, cat: "road", title: "Глубокая яма на въезде во двор", desc: "Яма около 40 см в диаметре, после дождя заполняется водой и её не видно.", lat: 55.9952, lng: 92.7965, addr: "улица Борисова, 5", district: "Октябрьский район", status: "resolved_wait", days: 9, sup: 12, conf: 1, mine: true },
    { n: 5, cat: "trash", title: "Переполнены мусорные контейнеры", desc: "Контейнеры не вывозили несколько дней, мусор разносит ветром.", lat: 55.9938, lng: 92.7905, addr: "Студгородок СФУ", district: "Октябрьский район", status: "resolved", days: 14, sup: 9 },
    { n: 6, cat: "green", title: "Сломана скамейка на аллее", desc: "У скамейки отломана спинка, торчат болты.", lat: 55.9921, lng: 92.7662, addr: "Академгородок", district: "Октябрьский район", status: "published", days: 3, sup: 5 },
    { n: 7, cat: "yard", title: "Разрушено ограждение детской площадки", desc: "Секция забора лежит на земле, рядом проезжая часть.", lat: 55.996, lng: 92.76, addr: "улица Академгородок, 23", district: "Октябрьский район", status: "moderation", days: 0, h: 2, sup: 0, mine: true },
    { n: 8, cat: "trash", title: "Несанкционированная свалка у гаражей", desc: "Строительный мусор, покрышки и старая мебель. Куча растёт каждую неделю.", lat: 56.0075, lng: 92.782, addr: "улица Бригада № 5", district: "Октябрьский район", status: "published", days: 6, sup: 47 },
    { n: 9, cat: "road", title: "Колея и ямы на проезжей части", desc: "Участок около 50 м, машины объезжают ямы по встречной полосе.", lat: 56.0102, lng: 92.813, addr: "улица Ладо Кецховели, 35", district: "Октябрьский район", status: "work", days: 11, sup: 63 },
    { n: 10, cat: "snow", title: "Не убран тротуар после снегопада", desc: "Тротуар засыпан, пешеходы идут по проезжей части.", lat: 56.006, lng: 92.805, addr: "Сопочная улица, 54А", district: "Октябрьский район", status: "published", days: 1, sup: 15 },
    { n: 11, cat: "light", title: "Не работает фонарь у пешеходного перехода", desc: "Переход не освещён, водители замечают пешеходов в последний момент.", lat: 56.001, lng: 92.8, addr: "улица Академика Киренского, 56", district: "Октябрьский район", status: "sent", days: 5, sup: 22 },
    { n: 13, cat: "ice", title: "Сосульки над тротуаром", desc: "Крупные сосульки над входом в магазин, зона не огорожена.", lat: 56.015, lng: 92.798, addr: "улица Менжинского", district: "Октябрьский район", status: "published", days: 2, sup: 11 },
    { n: 14, cat: "green", title: "Упавшее дерево перегородило дорожку", desc: "После ветра упала берёза, проход перекрыт.", lat: 56.012, lng: 92.77, addr: "улица Забобонова", district: "Октябрьский район", status: "resolved", days: 20, sup: 8 },
    { n: 15, cat: "yard", title: "Открытый люк во дворе", desc: "Крышка люка сдвинута, вечером его не видно. Опасно для детей.", lat: 55.9975, lng: 92.808, addr: "Мелькомбинатская улица, 3А", district: "Октябрьский район", status: "work", days: 3, sup: 29 },
    { n: 16, cat: "road", title: "Разрушен бордюр у перекрёстка", desc: "Куски бордюра на проезжей части.", lat: 56.0185, lng: 92.82, addr: "Новосибирская улица, 42", district: "Железнодорожный район", status: "published", days: 7, sup: 6 },
  ];
  const chains: Partial<Record<Status, Status[]>> = {
    published: ["published"],
    sent: ["published", "sent"],
    work: ["published", "sent", "work"],
    resolved_wait: ["published", "sent", "work", "resolved_wait"],
    resolved: ["published", "sent", "work", "resolved_wait", "resolved"],
    moderation: [],
  };
  return rows.map((o) => {
    const created = now - o.days * DAY - (o.h ?? 0) * 36e5;
    const notes: Partial<Record<Status, string>> = {
      published: "Проверено модератором и опубликовано",
      sent: "Обращение направлено: " + ORG[o.cat],
      work: "Организация сообщила о начале работ",
      resolved_wait: "Отмечено как решённое, ждём подтверждения жителей",
      resolved: "Решение подтвердили жители",
    };
    const chain = chains[o.status] ?? ["published"];
    const hist: HistoryItem[] = [{ status: "moderation", at: created, by: "Автор", comment: "Обращение создано" }];
    chain.forEach((s, i) =>
      hist.push({ status: s, at: created + (i + 1) * ((o.days * DAY) / (chain.length + 1)), by: s === "resolved" ? "Жители" : "Модератор", comment: notes[s] ?? "" }),
    );
    return {
      id: "demo-" + o.n,
      demo: true,
      title: o.title,
      category: o.cat,
      description: o.desc,
      lat: o.lat,
      lng: o.lng,
      address: o.addr,
      district: o.district,
      status: o.status,
      duplicateOf: null,
      createdAt: created,
      updatedAt: (hist[hist.length - 1] as HistoryItem).at,
      photos: [],
      author: o.mine ? "вы" : "житель_" + (100 + o.n),
      authorId: o.mine ? ME : null,
      mine: !!o.mine,
      supports: o.sup,
      supportedByMe: false,
      supporters: [],
      confirms: o.status === "resolved" ? CONFIRM_NEED : (o.conf ?? 0),
      confirmedByMe: false,
      confirmers: [],
      history: hist.reverse(),
    };
  });
}

function seedNotifications(): (AppNotification & { userId: string })[] {
  const n = (id: string, cid: string, cat: string, text: string, ago: number, read: boolean) => ({ id, complaintId: cid, text, at: Date.now() - ago, read, cat, userId: ME });
  return [
    n("n1", "demo-7", "yard", "Обращение «Разрушено ограждение детской площадки» отправлено на модерацию", 2 * 36e5, false),
    n("n2", "demo-4", "road", "Обращение «Глубокая яма на въезде во двор» отмечено как решённое. Подтвердите, если это так", 20 * 36e5, false),
    n("n3", "demo-9", "road", "Поддержанное вами обращение «Колея и ямы на проезжей части» в работе", 3 * DAY, true),
    n("n4", "demo-4", "road", "Обращение «Глубокая яма на въезде во двор» передано в МКУ «Управление дорог, инфраструктуры и благоустройства»", 6 * DAY, true),
  ];
}

/**
 * Standalone demo mode: the whole prototype logic on this device (IndexedDB, in-memory fallback).
 * Used when the site is built without a Supabase project; the UI marks the mode clearly.
 */
export class LocalBackend implements Backend {
  readonly mode = "local" as const;
  private mem = new Map<string, LocalComplaint>();
  private memN = new Map<string, AppNotification & { userId: string }>();
  private events: BackendEvents | null = null;
  private reportsList: Report[] = ls.get<Report[]>("local.reports", []);

  private user(): User | null {
    const u = ls.get<{ nick: string; since: number } | null>("local.user", null);
    if (!u) return null;
    const all = [...this.mem.values()];
    const mine = all.filter((c) => c.authorId === ME);
    return {
      id: ME,
      nick: u.nick,
      provider: "demo",
      role: ls.get("moderator", false) ? "moderator" : "user",
      notifyEnabled: ls.get("local.notify", true),
      isBlocked: false,
      stats: {
        complaints: mine.length,
        solved: mine.filter((c) => c.status === "resolved" || c.status === "resolved_wait").length,
        supported: all.filter((c) => c.supporters.includes(ME)).length,
      },
    };
  }

  private state(): AuthState {
    const u = this.user();
    if (u) return { kind: "user", user: u };
    return ls.get("local.signedIn", false) ? { kind: "needsProfile", provider: "demo" } : { kind: "guest" };
  }

  async init(events: BackendEvents): Promise<AuthState> {
    this.events = events;
    const d = await db();
    let cs = d ? await d.getAll("local_complaints") : [];
    if (!cs.length || !ls.get("local.seeded", false)) {
      cs = seedComplaints();
      for (const c of cs) await this.put(c);
      for (const n of seedNotifications()) await this.putN(n);
      ls.set("local.seeded", true);
    }
    for (const c of cs) this.mem.set(c.id, c);
    if (d) for (const n of await d.getAll("local_notifications")) this.memN.set(n.id, n);
    return this.state();
  }

  /** Restores the 15 demo records (setting in the profile, as in the prototype). */
  async resetDemo(): Promise<void> {
    const d = await db();
    if (d) {
      await d.clear("local_complaints");
      await d.clear("local_notifications");
    }
    this.mem.clear();
    this.memN.clear();
    ls.set("local.seeded", false);
    await this.init(this.events as BackendEvents);
  }

  private async put(c: LocalComplaint): Promise<void> {
    this.mem.set(c.id, c);
    const d = await db();
    if (d) await d.put("local_complaints", c);
  }
  private async putN(n: AppNotification & { userId: string }): Promise<void> {
    this.memN.set(n.id, n);
    const d = await db();
    if (d) await d.put("local_notifications", n);
  }

  private view(c: LocalComplaint): Complaint {
    return {
      ...c,
      mine: c.authorId === ME && !!this.user(),
      supportedByMe: c.supporters.includes(ME),
      confirmedByMe: c.confirmers.includes(ME),
      photos: c.photos.map((p) => ({ id: p.id, path: p.id, kind: p.kind, approved: p.approved, url: p.data })),
      history: c.history,
    };
  }

  private need(): User {
    const u = this.user();
    if (!u) throw new AppError("Войдите, чтобы продолжить.", "KGP_AUTH");
    return u;
  }
  private get(id: string): LocalComplaint {
    const c = this.mem.get(id);
    if (!c) throw new AppError("Обращение не найдено.", "KGP_NOT_FOUND");
    return c;
  }

  private async notify(c: LocalComplaint, text: string): Promise<void> {
    if (!(c.authorId === ME || c.supporters.includes(ME)) || !this.user()?.notifyEnabled) return;
    const n = { id: uuid(), complaintId: c.id, text, at: Date.now(), read: false, cat: c.category, userId: ME };
    await this.putN(n);
    this.events?.onNotification(n);
  }

  private async setStatus(c: LocalComplaint, status: Status, by: string, comment: string): Promise<void> {
    c.status = status;
    c.updatedAt = Date.now();
    c.history.unshift({ status, at: Date.now(), by, comment });
    await this.put(c);
    await this.notify(c, `Обращение «${c.title}»: ${STATUSES[status].name.toLowerCase()}`);
    this.events?.onComplaintChanged(c.id);
  }

  async categories(): Promise<Category[]> {
    return ls.get<Category[]>("local.categories", DEFAULT_CATS);
  }
  async feed(): Promise<Complaint[]> {
    return [...this.mem.values()].map((c) => this.view(c));
  }
  async complaint(id: string): Promise<Complaint | null> {
    const c = this.mem.get(id);
    return c ? this.view(c) : null;
  }
  async nearbyDuplicates(lat: number, lng: number, category: string): Promise<Duplicate[]> {
    return [...this.mem.values()]
      .filter((c) => c.category === category && [...OPEN_STATUSES, "moderation"].includes(c.status))
      .map((c) => ({ id: c.id, title: c.title, status: c.status, supports: c.supports, address: c.address, distance: distM(c, { lat, lng }) }))
      .filter((d) => d.distance <= 30)
      .sort((a, b) => a.distance - b.distance);
  }

  async stats(): Promise<Stats> {
    const all = [...this.mem.values()].filter((c) => !["duplicate", "rejected"].includes(c.status));
    const count = <K extends string>(key: (c: LocalComplaint) => K) => {
      const m = new Map<K, number>();
      for (const c of all) m.set(key(c), (m.get(key(c)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byDay = Array.from({ length: 21 }, (_, i) => {
      const d0 = today.getTime() - (20 - i) * DAY;
      return { day: new Date(d0).toISOString().slice(0, 10), n: all.filter((c) => c.createdAt >= d0 && c.createdAt < d0 + DAY).length };
    });
    return {
      total: all.length,
      open: all.filter((c) => OPEN_STATUSES.includes(c.status)).length,
      resolved: all.filter((c) => c.status === "resolved").length,
      supports: all.reduce((a, c) => a + c.supports, 0),
      byDay,
      byCategory: count((c) => c.category).map(([categoryId, n]) => ({ categoryId, n })),
      byStatus: count((c) => c.status).map(([status, n]) => ({ status, n })),
      byDistrict: count((c) => c.district || "Район не определён").map(([district, n]) => ({ district, n })),
      medianModerationHours: null,
      medianResolutionDays: null,
    };
  }

  // ---------- auth ----------

  async signInDemo(): Promise<AuthState> {
    ls.set("local.signedIn", true);
    return this.state();
  }
  providerAvailable(): boolean {
    return false;
  }
  async signInWith(provider: "yandex" | "vk"): Promise<void> {
    throw new AppError(`Вход через ${provider === "yandex" ? "Яндекс ID" : "VK ID"} работает после подключения сервера. Сейчас доступен демо-вход.`);
  }
  async finishRedirect(): Promise<AuthState> {
    return this.state();
  }
  async completeProfile(nickname: string, consent: boolean): Promise<AuthState> {
    const nick = nickname.trim();
    if (nick.length < 3 || nick.length > 24) throw new AppError("Никнейм — от 3 до 24 символов.", "KGP_NICKNAME");
    if (!consent) throw new AppError("Отметьте согласие на обработку персональных данных.", "KGP_CONSENT");
    ls.set("local.user", { nick, since: Date.now() });
    return this.state();
  }
  async signOut(): Promise<void> {
    ls.set("local.user", null);
    ls.set("local.signedIn", false);
  }
  async deleteAccount(): Promise<void> {
    const d = await db();
    for (const c of [...this.mem.values()]) {
      if (c.authorId === ME && !c.demo) {
        this.mem.delete(c.id);
        if (d) await d.delete("local_complaints", c.id);
      } else if (c.supporters.includes(ME) || c.confirmers.includes(ME)) {
        c.supporters = c.supporters.filter((x) => x !== ME);
        c.confirmers = c.confirmers.filter((x) => x !== ME);
        await this.put(c);
      }
    }
    for (const n of [...this.memN.values()]) {
      this.memN.delete(n.id);
      if (d) await d.delete("local_notifications", n.id);
    }
    await this.signOut();
  }
  async updateSettings(notifyEnabled: boolean): Promise<User> {
    ls.set("local.notify", notifyEnabled);
    return this.need();
  }

  // ---------- citizen actions ----------

  async createComplaint(n: NewComplaint): Promise<string> {
    const u = this.need();
    if (this.mem.has(n.id)) return n.id;
    const recent = [...this.mem.values()].filter((c) => c.authorId === ME && !c.demo && Date.now() - c.createdAt < 36e5).length;
    if (recent >= MAX_PER_HOUR) throw new AppError("Можно отправить не более 5 обращений в час. Попробуйте позже.", "KGP_RATE_LIMIT");
    const photos = await Promise.all(n.photos.map(async (b) => ({ id: uuid(), kind: "before" as const, approved: true, data: await blobToDataUrl(b) })));
    const c: LocalComplaint = {
      id: n.id, demo: false, title: n.title.trim(), category: n.category, description: n.description.trim(), lat: n.lat, lng: n.lng,
      address: n.address, district: n.district, status: "moderation", duplicateOf: null, createdAt: Date.now(), updatedAt: Date.now(),
      photos, author: u.nick, authorId: ME, mine: true, supports: 0, supportedByMe: false, supporters: [], confirms: 0, confirmedByMe: false, confirmers: [],
      history: [{ status: "moderation", at: Date.now(), by: "Вы", comment: "Обращение создано" }],
    };
    await this.put(c);
    await this.notify(c, `Обращение «${c.title}» отправлено на модерацию`);
    // In the standalone demo a timer plays the moderator; with the server a real moderator decides.
    setTimeout(() => {
      const x = this.mem.get(c.id);
      if (x && x.status === "moderation" && !ls.get("moderator", false))
        void this.setStatus(x, "published", "Модератор", "Проверено модератором и опубликовано (демо: автоматически)");
    }, 15000);
    return c.id;
  }

  async setSupport(id: string, on: boolean): Promise<number> {
    this.need();
    const c = this.get(id);
    if (on && c.authorId === ME) throw new AppError("Нельзя поддержать своё обращение.", "KGP_OWN");
    const has = c.supporters.includes(ME);
    if (on && !has) {
      c.supporters.push(ME);
      c.supports++;
    } else if (!on && has) {
      c.supporters = c.supporters.filter((x) => x !== ME);
      c.supports = Math.max(0, c.supports - 1);
    }
    await this.put(c);
    return c.supports;
  }

  async confirm(id: string, resolved: boolean): Promise<{ status: Status; confirms: number }> {
    const u = this.need();
    const c = this.get(id);
    if (resolved) {
      if (!OPEN_STATUSES.includes(c.status)) throw new AppError("Подтвердить можно только актуальное обращение.", "KGP_STATUS");
      if (c.status !== "resolved_wait") {
        c.status = "resolved_wait";
        c.history.unshift({ status: "resolved_wait", at: Date.now(), by: u.nick, comment: "Житель сообщил, что проблема решена" });
      }
      if (!c.confirmers.includes(ME)) {
        c.confirmers.push(ME);
        c.confirms++;
      }
      if (c.confirms >= CONFIRM_NEED) await this.setStatus(c, "resolved", "Жители", `Решение подтвердили ${c.confirms} ${plural(c.confirms, "житель", "жителя", "жителей")}`);
      else await this.put(c);
    } else {
      if (c.status !== "resolved_wait") throw new AppError("«Не решено» можно отметить только для обращения, ждущего подтверждения.", "KGP_STATUS");
      c.confirms = 0;
      c.confirmers = [];
      await this.setStatus(c, "published", u.nick, "Житель сообщил, что проблема не решена");
    }
    return { status: c.status, confirms: c.confirms };
  }

  async markSent(id: string): Promise<void> {
    const u = this.need();
    const c = this.get(id);
    if (c.authorId !== ME || c.status !== "published") throw new AppError("Отметить «Передано» может только автор опубликованного обращения.");
    await this.setStatus(c, "sent", u.nick, "Автор подал официальное обращение через «Решаем вместе»");
  }

  async addAfterPhoto(id: string, photo: Blob): Promise<void> {
    this.need();
    const c = this.get(id);
    if (c.authorId !== ME) throw new AppError("Фото «после» может добавить только автор.");
    c.photos.push({ id: uuid(), kind: "after", approved: false, data: await blobToDataUrl(photo) });
    if (["published", "sent", "work"].includes(c.status)) await this.setStatus(c, "resolved_wait", "Автор", "Автор приложил фото «после»");
    else await this.put(c);
  }

  async report(id: string, reason: string): Promise<void> {
    const u = this.need();
    const c = this.get(id);
    this.reportsList.unshift({ id: uuid(), complaintId: id, complaintTitle: c.title, complaintStatus: c.status, reason, reporter: u.nick, at: Date.now(), resolution: null });
    ls.set("local.reports", this.reportsList);
  }

  async notifications(): Promise<AppNotification[]> {
    if (!this.user()) return [];
    return [...this.memN.values()].sort((a, b) => b.at - a.at);
  }
  async markRead(ids?: string[]): Promise<void> {
    for (const n of this.memN.values()) if (!ids || ids.includes(n.id)) if (!n.read) await this.putN({ ...n, read: true });
  }

  // ---------- moderation (demo switch in the profile) ----------

  private mod(): void {
    if (!ls.get("moderator", false)) throw new AppError("Включите режим модератора в профиле.", "KGP_FORBIDDEN");
  }
  async moderateStatus(id: string, status: Status, comment?: string): Promise<void> {
    this.mod();
    const c = this.get(id);
    const notes: Partial<Record<Status, string>> = {
      published: "Проверено модератором и опубликовано",
      rejected: "Нарушены правила публикации",
      sent: "Обращение направлено: " + ORG[c.category],
      work: "Организация сообщила о начале работ",
      resolved_wait: "Отмечено как решённое, ждём подтверждения жителей",
      resolved: "Решение подтверждено модератором",
    };
    await this.setStatus(c, status, "Модератор", comment || notes[status] || "");
  }
  async markDuplicate(id: string, originalId: string): Promise<void> {
    this.mod();
    const c = this.get(id);
    const o = this.get(originalId);
    c.duplicateOf = originalId;
    await this.setStatus(c, "duplicate", "Модератор", `Объединено с обращением «${o.title}»`);
  }
  async reviewAfterPhoto(photoId: string, approve: boolean): Promise<void> {
    this.mod();
    for (const c of this.mem.values()) {
      const p = c.photos.find((x) => x.id === photoId);
      if (!p) continue;
      if (approve) {
        p.approved = true;
        await this.setStatus(c, "resolved", "Модератор", "Фото «после» одобрено модератором");
      } else {
        c.photos = c.photos.filter((x) => x.id !== photoId);
        await this.put(c);
      }
    }
  }
  async reports(): Promise<Report[]> {
    return this.reportsList;
  }
  async resolveReport(id: string, resolution: string, hide: boolean): Promise<void> {
    this.mod();
    const r = this.reportsList.find((x) => x.id === id);
    if (!r) return;
    r.resolution = resolution || (hide ? "Обращение скрыто" : "Нарушений не найдено");
    ls.set("local.reports", this.reportsList);
    if (hide) await this.moderateStatus(r.complaintId, "rejected", r.resolution);
  }
  async users(): Promise<AdminUser[]> {
    const u = this.user();
    return u ? [{ id: u.id, nick: u.nick, provider: u.provider, role: u.role, isBlocked: false, createdAt: Date.now(), complaints: u.stats.complaints, reportsAgainst: 0 }] : [];
  }
  async setBlocked(): Promise<void> {
    throw new AppError("Блокировка доступна при подключённом сервере.");
  }
  async setRole(): Promise<void> {
    throw new AppError("Роли назначаются при подключённом сервере.");
  }
  async saveCategory(c: Category & { isNew?: boolean }): Promise<void> {
    const cats = await this.categories();
    const i = cats.findIndex((x) => x.id === c.id);
    const row = { id: c.id, name: c.name, icon: c.icon, color: c.color, org: c.org };
    if (i >= 0) cats[i] = row;
    else cats.push(row);
    ls.set("local.categories", cats);
  }
  async exportRows(): Promise<Record<string, unknown>[]> {
    return [...this.mem.values()]
      .filter((c) => !["moderation", "rejected"].includes(c.status))
      .map((c) => ({ id: c.id, category_id: c.category, district: c.district, status: c.status, created_at: new Date(c.createdAt).toISOString(), supports_count: c.supports, confirms_count: c.confirms, lat: c.lat.toFixed(3), lng: c.lng.toFixed(3), is_demo: c.demo }));
  }
}

export const LOCAL_USER_ID = ME;
export type { Role };
