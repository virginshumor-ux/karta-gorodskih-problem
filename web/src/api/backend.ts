import type {
  AdminUser,
  AppNotification,
  Category,
  Complaint,
  Duplicate,
  Report,
  Role,
  Stats,
  Status,
  User,
} from "../domain/types";

export interface NewComplaint {
  id: string;
  category: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  address: string;
  district: string;
  photos: Blob[];
}

export type AuthState =
  | { kind: "guest" }
  /** Signed in with a provider but nickname / PD consent not given yet. */
  | { kind: "needsProfile"; provider: User["provider"] }
  | { kind: "user"; user: User };

export interface BackendEvents {
  onAuth(state: AuthState): void;
  onNotification(n: AppNotification): void;
  onComplaintChanged(id: string): void;
}

/**
 * Everything the screens need from the server. Implemented by SupabaseBackend (shared database)
 * and LocalBackend (standalone demo mode on this device, used when no server is configured).
 */
export interface Backend {
  readonly mode: "supabase" | "local";
  init(events: BackendEvents): Promise<AuthState>;

  categories(): Promise<Category[]>;
  /** All complaints visible to the caller (RLS decides on the server). */
  feed(): Promise<Complaint[]>;
  /** One complaint with history and photos. */
  complaint(id: string): Promise<Complaint | null>;
  nearbyDuplicates(lat: number, lng: number, category: string): Promise<Duplicate[]>;
  stats(): Promise<Stats>;

  // auth (Ф-04, Ф-15)
  signInDemo(): Promise<AuthState>;
  /** Starts the OAuth redirect; resolves only if the redirect could not start. */
  signInWith(provider: "yandex" | "vk", returnHash: string): Promise<void>;
  providerAvailable(provider: "yandex" | "vk"): boolean;
  /** Completes the redirect sign-in from the #/auth/callback parameters. */
  finishRedirect(params: URLSearchParams): Promise<AuthState>;
  completeProfile(nickname: string, consent: boolean): Promise<AuthState>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  updateSettings(notifyEnabled: boolean): Promise<User>;

  // citizen actions
  createComplaint(c: NewComplaint): Promise<string>;
  setSupport(id: string, on: boolean): Promise<number>;
  confirm(id: string, resolved: boolean): Promise<{ status: Status; confirms: number }>;
  markSent(id: string): Promise<void>;
  addAfterPhoto(id: string, photo: Blob): Promise<void>;
  report(id: string, reason: string): Promise<void>;
  notifications(): Promise<AppNotification[]>;
  markRead(ids?: string[]): Promise<void>;

  // moderation and administration (Ф-16 … Ф-22)
  moderateStatus(id: string, status: Status, comment?: string): Promise<void>;
  markDuplicate(id: string, originalId: string): Promise<void>;
  reviewAfterPhoto(photoId: string, approve: boolean): Promise<void>;
  reports(): Promise<Report[]>;
  resolveReport(id: string, resolution: string, hide: boolean): Promise<void>;
  users(search: string): Promise<AdminUser[]>;
  setBlocked(userId: string, blocked: boolean): Promise<void>;
  setRole(userId: string, role: Role): Promise<void>;
  saveCategory(c: Category & { isNew?: boolean }): Promise<void>;
  exportRows(): Promise<Record<string, unknown>[]>;
}
