package ru.sfu.kgp.domain

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

object Krsk {
    const val NAME = "Красноярск"
    const val LAT = 56.0153
    const val LNG = 92.8932
    const val CAMPUS_LAT = 56.0005
    const val CAMPUS_LNG = 92.7820
    const val CAMPUS_ZOOM = 15.0
    const val S = 55.90
    const val N = 56.14
    const val W = 92.60
    const val E = 93.20
    const val CONFIRM_NEED = 3
    const val DUP_RADIUS_M = 30.0
    const val MAX_PER_HOUR = 5
    val ZONE: ZoneId = ZoneId.of("Asia/Krasnoyarsk")

    fun inCity(lat: Double?, lng: Double?): Boolean =
        lat != null && lng != null && lat > S && lat < N && lng > W && lng < E
}

val DEFAULT_CATS = listOf(
    Category("road", "Дороги и ямы", "add_road", "#5b5f97", "МКУ «Управление дорог, инфраструктуры и благоустройства»"),
    Category("light", "Освещение", "lightbulb", "#c08a00", "Эксплуатирующая организация сетей наружного освещения"),
    Category("trash", "Мусор и свалки", "delete", "#6b7b2a", "Региональный оператор по обращению с ТКО"),
    Category("snow", "Снег и наледь", "ac_unit", "#2f7fb5", "Администрация района / управляющая компания"),
    Category("ice", "Сосульки и опасные кровли", "warning", "#b3471d", "Управляющая компания / собственник здания"),
    Category("yard", "Двор и придомовая территория", "holiday_village", "#8a4f8f", "Управляющая компания / ТСЖ"),
    Category("green", "Благоустройство и озеленение", "park", "#2e7d4f", "Администрация района"),
    Category("transit", "Транспорт и остановки", "directions_bus", "#0b6c78", "Департамент транспорта администрации города"),
    Category("other", "Прочее", "more_horiz", "#6a6f73", "Администрация района"),
)

val DISTRICTS = listOf(
    "Железнодорожный район", "Кировский район", "Ленинский район", "Октябрьский район",
    "Свердловский район", "Советский район", "Центральный район",
)

val REPORT_REASONS = listOf(
    "Недостоверная информация",
    "На фото узнаваемые люди или номера машин",
    "Оскорбления или реклама",
    "Проблема уже решена",
    "Дубликат другого обращения",
)

fun plural(n: Int, one: String, few: String, many: String): String {
    val m10 = n % 10
    val m100 = n % 100
    return if (m10 == 1 && m100 != 11) one else if (m10 in 2..4 && (m100 < 10 || m100 >= 20)) few else many
}

fun distM(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Double {
    val r = 6371e3
    val t = Math.PI / 180
    val dLat = (bLat - aLat) * t
    val dLng = (bLng - aLng) * t
    val x = sin(dLat / 2).pow(2) + cos(aLat * t) * cos(bLat * t) * sin(dLng / 2).pow(2)
    return 2 * r * asin(sqrt(x))
}

private val RU = Locale.forLanguageTag("ru-RU")

/** Same relative format as the prototype: «только что», «5 мин назад», «сегодня, 14:05», «3 ноября, 09:12». */
fun fmtDate(ts: Long, now: Long = System.currentTimeMillis(), zone: ZoneId = Krsk.ZONE): String {
    val diff = (now - ts) / 1000
    val d = Instant.ofEpochMilli(ts).atZone(zone)
    val n = Instant.ofEpochMilli(now).atZone(zone)
    val time = d.format(DateTimeFormatter.ofPattern("HH:mm", RU))
    return when {
        diff < 60 -> "только что"
        diff < 3600 -> "${diff / 60} мин назад"
        diff < 86400 && d.dayOfMonth == n.dayOfMonth -> "сегодня, $time"
        else -> d.format(DateTimeFormatter.ofPattern("d MMMM", RU)) + ", " + time
    }
}

fun fmtDay(ts: Long, zone: ZoneId = Krsk.ZONE): String =
    Instant.ofEpochMilli(ts).atZone(zone).format(DateTimeFormatter.ofPattern("dd.MM.yyyy", RU))

/** Text of the official appeal for pos.gosuslugi.ru — identical to appealText() of the prototype and the site. */
fun appealText(c: Complaint, cat: Category, pageUrl: String = ""): String {
    val n = c.supports + 1
    return buildString {
        append("Прошу принять меры по проблеме «${c.title}».\n\n")
        append("Категория: ${cat.name}.\n")
        append("Адрес: г. Красноярск, ${c.address} (${c.district.ifEmpty { "район не определён" }}).\n")
        append("Координаты: ${"%.5f".format(Locale.US, c.lat)}, ${"%.5f".format(Locale.US, c.lng)}.\n")
        append("Дата обнаружения: ${fmtDay(c.createdAt)}.\n\n")
        append(c.description).append("\n\n")
        if (pageUrl.isNotEmpty()) append("Фото и подробности: $pageUrl\n\n")
        append("Проблему подтвердили $n ${plural(n, "житель", "жителя", "жителей")} в приложении «Карта городских проблем».")
    }
}

/** Visible complaints for the map and the list, newest first (same rules as the site). */
fun filterComplaints(
    all: List<Complaint>,
    f: Filter,
    search: String,
    moderator: Boolean,
    catName: (String) -> String,
    now: Long = System.currentTimeMillis(),
): List<Complaint> {
    val q = search.trim().lowercase()
    val since = f.period.days?.let { now - it * 86_400_000L } ?: 0L
    return all.filter { c ->
        when {
            c.status == Status.DUPLICATE -> false
            c.status == Status.MODERATION && !c.mine && !moderator -> false
            c.status == Status.REJECTED && !c.mine -> false
            f.cats.isNotEmpty() && c.category !in f.cats -> false
            f.mine && !c.mine -> false
            f.district.isNotEmpty() && c.district != f.district -> false
            c.createdAt < since -> false
            f.status == StatusFilter.OPEN && !(c.status.isOpen || (c.status == Status.MODERATION && (c.mine || moderator))) -> false
            f.status == StatusFilter.RESOLVED && c.status != Status.RESOLVED -> false
            q.isNotEmpty() && q !in "${c.title} ${c.address} ${c.description} ${catName(c.category)}".lowercase() -> false
            else -> true
        }
    }.sortedByDescending { it.createdAt }
}
