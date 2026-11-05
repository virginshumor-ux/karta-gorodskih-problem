export type Status =
  | "moderation"
  | "published"
  | "sent"
  | "work"
  | "resolved_wait"
  | "resolved"
  | "rejected"
  | "duplicate";

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  org: string;
}

export interface Photo {
  id: string;
  path: string;
  kind: "before" | "after";
  approved: boolean;
  /** Displayable URL (signed URL, object URL or data URL). Empty when unavailable offline. */
  url: string;
}

export interface HistoryItem {
  status: Status;
  at: number;
  by: string;
  comment: string;
}

export interface Complaint {
  id: string;
  demo: boolean;
  title: string;
  category: string;
  description: string;
  lat: number;
  lng: number;
  address: string;
  district: string;
  status: Status;
  duplicateOf: string | null;
  createdAt: number;
  updatedAt: number;
  photos: Photo[];
  author: string;
  mine: boolean;
  supports: number;
  supportedByMe: boolean;
  confirms: number;
  confirmedByMe: boolean;
  /** Loaded with the detail screen; empty in the feed. */
  history: HistoryItem[];
  comments: number;
}

export interface Comment {
  id: string;
  complaintId: string;
  text: string;
  author: string;
  mine: boolean;
  hidden: boolean;
  at: number;
}

export interface HomeArea {
  lat: number;
  lng: number;
  radius: number;
}

export interface AppNotification {
  id: string;
  complaintId: string | null;
  text: string;
  at: number;
  read: boolean;
  cat: string;
}

export type Provider = "yandex" | "vk" | "demo";
export type Role = "user" | "moderator" | "admin";

export interface User {
  id: string;
  nick: string;
  provider: Provider;
  role: Role;
  notifyEnabled: boolean;
  isBlocked: boolean;
  stats: { complaints: number; solved: number; supported: number; confirmed: number; comments: number };
  home: HomeArea | null;
}

export interface Filter {
  cats: Set<string>;
  status: "open" | "resolved" | "all";
  mine: boolean;
  district: string;
  period: "all" | "7" | "30";
  sort: "new" | "near" | "popular";
}

export interface Draft {
  id: string;
  step: number;
  /** Compressed JPEG blobs, max 3. */
  photos: Blob[];
  photoUrls: string[];
  lat: number | null;
  lng: number | null;
  address: string;
  district: string;
  category: string | null;
  title: string;
  description: string;
  createdId?: string;
  savedOffline?: boolean;
  /** The place was taken from the photo's GPS tag (EXIF). */
  fromExif?: boolean;
}

export interface Duplicate {
  id: string;
  title: string;
  status: Status;
  supports: number;
  address: string;
  distance: number;
}

export interface Stats {
  total: number;
  open: number;
  resolved: number;
  supports: number;
  byDay: { day: string; n: number }[];
  byCategory: { categoryId: string; n: number }[];
  byStatus: { status: Status; n: number }[];
  byDistrict: { district: string; n: number; resolved: number }[];
  medianModerationHours: number | null;
  medianResolutionDays: number | null;
}

export interface Report {
  id: string;
  complaintId: string;
  complaintTitle: string;
  complaintStatus: Status;
  reason: string;
  reporter: string;
  at: number;
  resolution: string | null;
}

export interface AdminUser {
  id: string;
  nick: string;
  provider: Provider;
  role: Role;
  isBlocked: boolean;
  createdAt: number;
  complaints: number;
  reportsAgainst: number;
}
