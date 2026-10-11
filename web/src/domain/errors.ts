/** Error with a user-facing Russian message; `offline` marks network failures that allow a draft. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code = "",
    readonly offline = false,
  ) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  KGP_AUTH: "Войдите, чтобы продолжить.",
  KGP_RATE_LIMIT: "Можно отправить не более 5 обращений в час. Попробуйте позже.",
  KGP_OUT_OF_CITY: "Точка за пределами Красноярска — приложение принимает обращения только по городу.",
  KGP_NICK_TAKEN: "Этот никнейм уже занят — придумайте другой.",
  KGP_CONSENT: "Отметьте согласие на обработку персональных данных.",
  KGP_FORBIDDEN: "Недостаточно прав.",
};

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = String((e as { message?: string })?.message ?? e);
  return /Failed to fetch|NetworkError|Load failed|fetch failed|network|timeout|aborted/i.test(m);
}

/** Converts a Supabase / fetch error into AppError with a readable message. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (isNetworkError(e)) return new AppError("Нет соединения с сервером. Проверьте интернет.", "NETWORK", true);
  const raw = String((e as { message?: string })?.message ?? e ?? "");
  const m = /^(KGP_[A-Z_]+):\s*(.*)$/s.exec(raw);
  if (m) return new AppError(MESSAGES[m[1] as string] ?? m[2] ?? raw, m[1]);
  if (/JWT|session/i.test(raw)) return new AppError("Сессия истекла — войдите снова.", "KGP_AUTH");
  return new AppError("Не удалось выполнить действие. Повторите попытку.", "UNKNOWN");
}
