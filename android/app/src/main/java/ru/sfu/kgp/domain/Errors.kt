package ru.sfu.kgp.domain

import java.io.IOException

/** Error with a Russian message for the user; [offline] marks network failures that allow an offline draft. */
class AppException(message: String, val code: String = "", val offline: Boolean = false, cause: Throwable? = null) :
    Exception(message, cause)

private val MESSAGES = mapOf(
    "KGP_AUTH" to "Войдите, чтобы продолжить.",
    "KGP_RATE_LIMIT" to "Можно отправить не более 5 обращений в час. Попробуйте позже.",
    "KGP_OUT_OF_CITY" to "Точка за пределами Красноярска — приложение принимает обращения только по городу.",
    "KGP_NICK_TAKEN" to "Этот никнейм уже занят — придумайте другой.",
    "KGP_CONSENT" to "Отметьте согласие на обработку персональных данных.",
    "KGP_FORBIDDEN" to "Недостаточно прав.",
)

private val CODE = Regex("""(KGP_[A-Z_]+):\s*([^"\n]*)""")

fun Throwable.isNetwork(): Boolean {
    var e: Throwable? = this
    while (e != null) {
        if (e is IOException) return true
        val n = e::class.java.name
        if ("HttpRequestTimeout" in n || "ConnectTimeout" in n || "SocketTimeout" in n || "UnknownHost" in n || "HttpRequestException" in n) return true
        e = e.cause
    }
    return false
}

fun Throwable.toAppException(): AppException {
    if (this is AppException) return this
    if (isNetwork()) return AppException("Нет соединения с сервером. Проверьте интернет.", "NETWORK", offline = true, cause = this)
    val raw = generateSequence(this as Throwable?) { it.cause }.joinToString(" ") { it.message.orEmpty() }
    CODE.find(raw)?.let { m ->
        val code = m.groupValues[1]
        return AppException(MESSAGES[code] ?: m.groupValues[2].trim(), code, cause = this)
    }
    if ("JWT" in raw || "session" in raw.lowercase()) return AppException("Сессия истекла — войдите снова.", "KGP_AUTH", cause = this)
    return AppException("Не удалось выполнить действие. Повторите попытку.", "UNKNOWN", cause = this)
}
