declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

const env = import.meta.env;

export const CONFIG = {
  supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "",
  supabaseAnonKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "",
  /** Anonymous Supabase session with a nickname — lets the course instructor check the app without accounts. */
  demoLoginEnabled: (env.VITE_DEMO_LOGIN_ENABLED as string | undefined) !== "false",
  yandexClientId: (env.VITE_YANDEX_CLIENT_ID as string | undefined)?.trim() ?? "",
  vkClientId: (env.VITE_VK_CLIENT_ID as string | undefined)?.trim() ?? "",
  apkUrl: (env.VITE_APK_URL as string | undefined)?.trim() ?? "",
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
  buildDate: typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "",
};

export const hasServer = (): boolean => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

/** Public link to a complaint on this site (used in "Поделиться" and in the appeal text). */
export function complaintUrl(id: string): string {
  const base = location.href.split("#")[0] ?? "";
  return `${base}#/c/${id}`;
}
