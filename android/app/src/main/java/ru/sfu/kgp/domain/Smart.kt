package ru.sfu.kgp.domain

import java.util.Locale

/**
 * Category suggestion from the title/description (word stems) — the hint on the description step.
 * Same dictionary and threshold as the site (web/src/domain/smart.ts).
 */
private val STEMS: List<Pair<String, List<String>>> = listOf(
    "ice" to listOf("сосул", "кровл", "крыш", "наледь на крыш", "снег с крыш", "свес"),
    "snow" to listOf("снег", "сугроб", "наледь", "гололёд", "гололед", "скольз", "лёд", "лед ", "не чищ", "неубран", "не убран", "уборк снег"),
    "light" to listOf("фонар", "освещ", "свет", "лампа", "темно", "не горит", "не горят"),
    "trash" to listOf("мусор", "свалк", "контейнер", "отход", "бак", "грязь", "покрышк", "хлам"),
    "road" to listOf("яма", "ямы", "асфальт", "дорог", "колея", "выбоин", "бордюр", "тротуар разруш", "провал"),
    "transit" to listOf("остановк", "автобус", "трамва", "троллейбус", "маршрут", "павильон"),
    "yard" to listOf("двор", "детск", "площадк", "люк", "подъезд", "ограждени", "забор", "парковк во двор"),
    "green" to listOf("дерев", "скамей", "лавочк", "газон", "клумб", "парк", "сквер", "кустарн", "аллея"),
)

fun suggestCategory(text: String): String? {
    val t = " " + text.lowercase(Locale.forLanguageTag("ru")).replace('ё', 'е') + " "
    var best: String? = null
    var bestScore = 0
    for ((cat, stems) in STEMS) {
        val score = stems.sumOf { s -> if (t.contains(s.replace('ё', 'е'))) s.length else 0 }
        if (score > bestScore) {
            best = cat
            bestScore = score
        }
    }
    return if (bestScore >= 3) best else null
}

/** List order: newest, nearest to the user, or most supported. */
fun sortComplaints(list: List<Complaint>, sort: Sort, origin: Pair<Double, Double>?): List<Complaint> = when {
    sort == Sort.NEAR && origin != null -> list.sortedBy { distM(it.lat, it.lng, origin.first, origin.second) }
    sort == Sort.POPULAR -> list.sortedWith(compareByDescending<Complaint> { it.supports }.thenByDescending { it.createdAt })
    else -> list.sortedByDescending { it.createdAt }
}

fun fmtDistance(m: Double): String =
    if (m < 1000) "${maxOf(10, Math.round(m / 10).toInt() * 10)} м"
    else String.format(Locale.US, if (m < 10_000) "%.1f" else "%.0f", m / 1000).replace('.', ',') + " км"

data class Achievement(val id: String, val icon: String, val title: String, val desc: String, val progress: Int, val goal: Int) {
    val done: Boolean get() = progress >= goal
}

/** Resident achievements (gamification from the TZ "directions of development"), computed on the device. */
fun achievements(u: User, all: List<Complaint>): List<Achievement> {
    val mine = all.filter { it.mine }
    val own = maxOf(u.stats.complaints, mine.size)
    val winter = mine.count { it.category == "snow" || it.category == "ice" }
    val resolvedTouched = all.count { it.status == Status.RESOLVED && (it.mine || it.supportedByMe) }
    val districts = mine.map { it.district }.filter { it.isNotEmpty() }.toSet().size
    fun a(id: String, icon: String, title: String, desc: String, progress: Int, goal: Int) = Achievement(id, icon, title, desc, minOf(progress, goal), goal)
    return listOf(
        a("first", "flag", "Первый шаг", "Отправить первое обращение", own, 1),
        a("active", "verified", "Активный житель", "5 обращений о проблемах города", own, 5),
        a("neighbour", "groups", "Добрый сосед", "Поддержать 10 обращений других жителей", u.stats.supported, 10),
        a("checker", "task_alt", "Контролёр", "Подтвердить решение 3 проблем", u.stats.confirmed, 3),
        a("result", "check_circle", "Есть результат", "Дождаться решения проблемы, которую вы создали или поддержали", resolvedTouched, 1),
        a("winter", "ac_unit", "Зимний патруль", "Сообщить о 3 случаях снега, наледи или сосулек", winter, 3),
        a("voice", "forum", "Голос района", "Оставить 5 комментариев в обсуждениях", u.stats.comments, 5),
        a("explorer", "location_city", "Знаток города", "Обращения в 2 разных районах", districts, 2),
    )
}
