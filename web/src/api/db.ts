import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AppNotification, Complaint } from "../domain/types";
import type { NewComplaint } from "./backend";

export interface StoredDraft extends NewComplaint {
  createdAt: number;
  attempts: number;
  lastError?: string;
}

/** Complaint as stored by the standalone demo backend: photos are data URLs. */
export type LocalComplaint = Omit<Complaint, "photos"> & {
  photos: { id: string; kind: "before" | "after"; approved: boolean; data: string }[];
  authorId: string | null;
  supporters: string[];
  confirmers: string[];
};

interface KgpDB extends DBSchema {
  drafts: { key: string; value: StoredDraft };
  kv: { key: string; value: { key: string; value: unknown; at: number } };
  local_complaints: { key: string; value: LocalComplaint };
  local_notifications: { key: string; value: AppNotification & { userId: string } };
}

let dbp: Promise<IDBPDatabase<KgpDB> | null> | null = null;

/** IndexedDB on this device; resolves to null where it is unavailable (some private modes). */
export function db(): Promise<IDBPDatabase<KgpDB> | null> {
  if (!dbp) {
    dbp = Promise.race([
      openDB<KgpDB>("kgp-web", 1, {
        upgrade(d) {
          d.createObjectStore("drafts", { keyPath: "id" });
          d.createObjectStore("kv", { keyPath: "key" });
          d.createObjectStore("local_complaints", { keyPath: "id" });
          d.createObjectStore("local_notifications", { keyPath: "id" });
        },
      }),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]).catch(() => null);
  }
  return dbp;
}

export async function kvGet<T>(key: string): Promise<{ value: T; at: number } | null> {
  const d = await db();
  const row = d ? await d.get("kv", key) : undefined;
  return row ? { value: row.value as T, at: row.at } : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  if (d) await d.put("kv", { key, value, at: Date.now() });
}

// ---------- offline drafts (Ф-07) ----------

export async function saveDraft(d: StoredDraft): Promise<void> {
  const x = await db();
  if (!x) throw new Error("Хранилище браузера недоступно — черновик не сохранён");
  await x.put("drafts", d);
}

export async function listDrafts(): Promise<StoredDraft[]> {
  const x = await db();
  return x ? x.getAll("drafts") : [];
}

export async function deleteDraft(id: string): Promise<void> {
  const x = await db();
  if (x) await x.delete("drafts", id);
}
