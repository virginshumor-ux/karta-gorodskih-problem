package ru.sfu.kgp.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import ru.sfu.kgp.domain.AppException
import ru.sfu.kgp.domain.AppNotification
import ru.sfu.kgp.domain.AuthState
import ru.sfu.kgp.domain.Category
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.DEFAULT_CATS
import ru.sfu.kgp.domain.Duplicate
import ru.sfu.kgp.domain.HistoryItem
import ru.sfu.kgp.domain.Krsk
import ru.sfu.kgp.domain.NewComplaint
import ru.sfu.kgp.domain.Photo
import ru.sfu.kgp.domain.Provider
import ru.sfu.kgp.domain.Role
import ru.sfu.kgp.domain.Stats
import ru.sfu.kgp.domain.Status
import ru.sfu.kgp.domain.User
import ru.sfu.kgp.domain.UserStats
import ru.sfu.kgp.domain.distM
import ru.sfu.kgp.domain.plural
import java.io.File
import java.time.Instant
import java.util.UUID

private const val ME = "local-user"
private const val DAY = 86_400_000L

@Serializable
private data class DemoState(
    val complaints: List<Complaint>,
    val supporters: Map<String, List<String>> = emptyMap(),
    val confirmers: Map<String, List<String>> = emptyMap(),
    val authors: Map<String, String> = emptyMap(),
    val notifications: List<AppNotification> = emptyList(),
    val nick: String? = null,
    val signedIn: Boolean = false,
    val moderator: Boolean = false,
    val notify: Boolean = true,
)

/**
 * Standalone demo mode (the APK built without server settings, and the unit tests): the logic of the prototype
 * on the device. Data is kept in a JSON file; with [file] = null it lives only in memory.
 */
class DemoBackend(private val file: File?, private val clock: () -> Long = System::currentTimeMillis) : Backend {
    override val isDemo = true
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val lock = Mutex()
    private lateinit var st: DemoState
    private val stream = MutableSharedFlow<AppNotification>(extraBufferCapacity = 16)

    private fun load(): DemoState = file?.takeIf { it.exists() }?.let { runCatching { json.decodeFromString(DemoState.serializer(), it.readText()) }.getOrNull() }
        ?: DemoState(complaints = seed(clock()), authors = mapOf("demo-4" to ME, "demo-7" to ME), notifications = seedNotifications(clock()))

    private fun save() {
        file?.let { f -> f.parentFile?.mkdirs(); f.writeText(json.encodeToString(DemoState.serializer(), st)) }
    }

    private fun user(): User? {
        val nick = st.nick ?: return null
        val mine = st.complaints.filter { st.authors[it.id] == ME }
        return User(
            ME, nick, Provider.DEMO, if (st.moderator) Role.MODERATOR else Role.USER, st.notify, false,
            UserStats(mine.size, mine.count { it.status == Status.RESOLVED || it.status == Status.RESOLVED_WAIT }, st.supporters.count { ME in it.value }),
        )
    }

    private fun state(): AuthState = user()?.let { AuthState.SignedIn(it) } ?: if (st.signedIn) AuthState.NeedsProfile(Provider.DEMO) else AuthState.Guest

    private fun view(c: Complaint) = c.copy(
        mine = user() != null && st.authors[c.id] == ME,
        supportedByMe = ME in st.supporters[c.id].orEmpty(),
        confirmedByMe = ME in st.confirmers[c.id].orEmpty(),
    )

    private fun need(): User = user() ?: throw AppException("Войдите, чтобы продолжить.", "KGP_AUTH")
    private fun get(id: String) = st.complaints.firstOrNull { it.id == id } ?: throw AppException("Обращение не найдено.", "KGP_NOT_FOUND")
    private fun put(c: Complaint) {
        st = st.copy(complaints = st.complaints.map { if (it.id == c.id) c else it }.let { if (it.any { x -> x.id == c.id }) it else it + c })
    }

    private fun notifyAbout(c: Complaint, text: String) {
        val involved = st.authors[c.id] == ME || ME in st.supporters[c.id].orEmpty()
        if (!involved || user()?.notifyEnabled != true) return
        val n = AppNotification(UUID.randomUUID().toString(), c.id, text, clock(), false, c.category)
        st = st.copy(notifications = listOf(n) + st.notifications)
        stream.tryEmit(n)
    }

    private fun withStatus(c: Complaint, s: Status, by: String, comment: String): Complaint {
        val x = c.copy(status = s, updatedAt = clock(), history = listOf(HistoryItem(s, clock(), by, comment)) + c.history)
        put(x)
        notifyAbout(x, "Обращение «${x.title}»: ${s.title.lowercase()}")
        return x
    }

    override suspend fun init(): AuthState = lock.withLock {
        if (!::st.isInitialized) {
            st = load()
            save()
        }
        state()
    }

    fun setModerator(on: Boolean) {
        st = st.copy(moderator = on)
        save()
    }

    val moderatorMode: Boolean get() = st.moderator

    suspend fun resetDemo() = lock.withLock {
        st = st.copy(complaints = seed(clock()), supporters = emptyMap(), confirmers = emptyMap(), authors = mapOf("demo-4" to ME, "demo-7" to ME), notifications = seedNotifications(clock()))
        save()
    }

    override suspend fun categories(): List<Category> = DEFAULT_CATS
    override suspend fun feed(): List<Complaint> = lock.withLock { st.complaints.map(::view) }
    override suspend fun complaint(id: String): Complaint? = lock.withLock { st.complaints.firstOrNull { it.id == id }?.let(::view) }

    override suspend fun nearbyDuplicates(lat: Double, lng: Double, category: String): List<Duplicate> = lock.withLock {
        st.complaints.filter { it.category == category && (it.status.isOpen || it.status == Status.MODERATION) }
            .map { Duplicate(it.id, it.title, it.status, it.supports, it.address, distM(it.lat, it.lng, lat, lng)) }
            .filter { it.distance <= Krsk.DUP_RADIUS_M }.sortedBy { it.distance }
    }

    override suspend fun stats(): Stats = lock.withLock {
        val all = st.complaints.filter { it.status != Status.DUPLICATE && it.status != Status.REJECTED }
        val today = Instant.ofEpochMilli(clock()).atZone(Krsk.ZONE).toLocalDate()
        val byDay = (20 downTo 0).map { back ->
            val d = today.minusDays(back.toLong())
            d.toString() to all.count { Instant.ofEpochMilli(it.createdAt).atZone(Krsk.ZONE).toLocalDate() == d }
        }
        Stats(
            all.size, all.count { it.status.isOpen }, all.count { it.status == Status.RESOLVED }, all.sumOf { it.supports }, byDay,
            all.groupingBy { it.category }.eachCount().toList().sortedByDescending { it.second },
            all.groupingBy { it.status }.eachCount().toList(),
            all.groupingBy { it.district.ifEmpty { "Район не определён" } }.eachCount().toList().sortedByDescending { it.second },
            null, null,
        )
    }

    // ---------- auth ----------

    override suspend fun signInDemo(): AuthState = lock.withLock { st = st.copy(signedIn = true); save(); state() }
    override fun providerAvailable(provider: String) = false
    override fun oauthStartUrl(provider: String): String? = null
    override suspend fun finishRedirect(tokenHash: String?, error: String?): AuthState = lock.withLock { state() }

    override suspend fun completeProfile(nickname: String, consent: Boolean): AuthState = lock.withLock {
        val nick = nickname.trim()
        if (nick.length !in 3..24) throw AppException("Никнейм — от 3 до 24 символов.", "KGP_NICKNAME")
        if (!consent) throw AppException("Отметьте согласие на обработку персональных данных.", "KGP_CONSENT")
        st = st.copy(nick = nick, signedIn = true)
        save()
        state()
    }

    override suspend fun signOut() = lock.withLock { st = st.copy(nick = null, signedIn = false); save() }

    override suspend fun deleteAccount() = lock.withLock {
        val mineIds = st.authors.filterValues { it == ME }.keys.filter { id -> st.complaints.any { it.id == id && !it.demo } }.toSet()
        st = st.copy(
            complaints = st.complaints.filter { it.id !in mineIds },
            supporters = st.supporters.mapValues { e -> e.value - ME },
            confirmers = st.confirmers.mapValues { e -> e.value - ME },
            notifications = emptyList(), nick = null, signedIn = false,
        )
        save()
    }

    override suspend fun updateSettings(notifyEnabled: Boolean): User = lock.withLock {
        st = st.copy(notify = notifyEnabled); save(); need()
    }

    // ---------- actions ----------

    override suspend fun createComplaint(c: NewComplaint): String = lock.withLock {
        val u = need()
        if (st.complaints.any { it.id == c.id }) return@withLock c.id
        val recent = st.complaints.count { st.authors[it.id] == ME && !it.demo && clock() - it.createdAt < 3_600_000 }
        if (recent >= Krsk.MAX_PER_HOUR) throw AppException("Можно отправить не более 5 обращений в час. Попробуйте позже.", "KGP_RATE_LIMIT")
        if (!Krsk.inCity(c.lat, c.lng)) throw AppException("Точка за пределами Красноярска — приложение принимает обращения только по городу.", "KGP_OUT_OF_CITY")
        val now = clock()
        val x = Complaint(
            id = c.id, demo = false, title = c.title.trim(), category = c.category, description = c.description.trim(), lat = c.lat, lng = c.lng,
            address = c.address, district = c.district, status = Status.MODERATION, createdAt = now, updatedAt = now,
            photos = c.photoFiles.mapIndexed { i, f -> Photo("p$i-${c.id}", f, "before", true, File(f).toURI().toString()) },
            author = u.nick, history = listOf(HistoryItem(Status.MODERATION, now, "Вы", "Обращение создано")),
        )
        st = st.copy(complaints = st.complaints + x, authors = st.authors + (x.id to ME))
        notifyAbout(x, "Обращение «${x.title}» отправлено на модерацию")
        save()
        x.id
    }

    override suspend fun setSupport(id: String, on: Boolean): Int = lock.withLock {
        need()
        val c = get(id)
        if (on && st.authors[id] == ME) throw AppException("Нельзя поддержать своё обращение.", "KGP_OWN")
        val list = st.supporters[id].orEmpty()
        val has = ME in list
        val n = when {
            on && !has -> c.supports + 1
            !on && has -> maxOf(0, c.supports - 1)
            else -> c.supports
        }
        st = st.copy(supporters = st.supporters + (id to if (on) (list - ME) + ME else list - ME))
        put(c.copy(supports = n))
        save()
        n
    }

    override suspend fun confirm(id: String, resolved: Boolean): Pair<Status, Int> = lock.withLock {
        val u = need()
        var c = get(id)
        if (resolved) {
            if (!c.status.isOpen) throw AppException("Подтвердить можно только актуальное обращение.", "KGP_STATUS")
            if (c.status != Status.RESOLVED_WAIT)
                c = c.copy(status = Status.RESOLVED_WAIT, history = listOf(HistoryItem(Status.RESOLVED_WAIT, clock(), u.nick, "Житель сообщил, что проблема решена")) + c.history)
            val list = st.confirmers[id].orEmpty()
            if (ME !in list) {
                c = c.copy(confirms = c.confirms + 1)
                st = st.copy(confirmers = st.confirmers + (id to list + ME))
            }
            put(c)
            if (c.confirms >= Krsk.CONFIRM_NEED)
                c = withStatus(c, Status.RESOLVED, "Жители", "Решение подтвердили ${c.confirms} ${plural(c.confirms, "житель", "жителя", "жителей")}")
        } else {
            if (c.status != Status.RESOLVED_WAIT) throw AppException("«Не решено» можно отметить только для обращения, ждущего подтверждения.", "KGP_STATUS")
            st = st.copy(confirmers = st.confirmers - id)
            c = withStatus(c.copy(confirms = 0), Status.PUBLISHED, u.nick, "Житель сообщил, что проблема не решена")
        }
        save()
        c.status to c.confirms
    }

    override suspend fun markSent(id: String) = lock.withLock {
        val u = need()
        val c = get(id)
        if (st.authors[id] != ME || c.status != Status.PUBLISHED) throw AppException("Отметить «Передано» может только автор опубликованного обращения.")
        withStatus(c, Status.SENT, u.nick, "Автор подал официальное обращение через «Решаем вместе»")
        save()
    }

    override suspend fun addAfterPhoto(id: String, file: String) = lock.withLock {
        need()
        val c = get(id)
        if (st.authors[id] != ME) throw AppException("Фото «после» может добавить только автор.")
        val x = c.copy(photos = c.photos + Photo("after-${clock()}", file, "after", false, File(file).toURI().toString()))
        put(x)
        if (x.status in setOf(Status.PUBLISHED, Status.SENT, Status.WORK)) withStatus(x, Status.RESOLVED_WAIT, "Автор", "Автор приложил фото «после»")
        save()
    }

    override suspend fun report(id: String, reason: String) = lock.withLock { need(); get(id); Unit }

    override suspend fun notifications(): List<AppNotification> = lock.withLock { if (user() == null) emptyList() else st.notifications.sortedByDescending { it.at } }

    override suspend fun markRead(ids: List<String>?) = lock.withLock {
        st = st.copy(notifications = st.notifications.map { if (ids == null || it.id in ids) it.copy(read = true) else it })
        save()
    }

    override fun notificationStream(): Flow<AppNotification> = stream

    // ---------- moderation (demo switch in the profile) ----------

    private fun mod() {
        if (!st.moderator) throw AppException("Включите режим модератора в профиле.", "KGP_FORBIDDEN")
    }

    override suspend fun moderateStatus(id: String, status: Status, comment: String?) = lock.withLock {
        mod()
        val c = get(id)
        val note = comment ?: when (status) {
            Status.PUBLISHED -> "Проверено модератором и опубликовано"
            Status.REJECTED -> "Нарушены правила публикации"
            Status.SENT -> "Обращение направлено: " + (DEFAULT_CATS.firstOrNull { it.id == c.category }?.org ?: "")
            Status.WORK -> "Организация сообщила о начале работ"
            Status.RESOLVED_WAIT -> "Отмечено как решённое, ждём подтверждения жителей"
            Status.RESOLVED -> "Решение подтверждено модератором"
            else -> ""
        }
        withStatus(c, status, "Модератор", note)
        save()
    }

    override suspend fun markDuplicate(id: String, originalId: String) = lock.withLock {
        mod()
        val o = get(originalId)
        withStatus(get(id).copy(duplicateOf = originalId), Status.DUPLICATE, "Модератор", "Объединено с обращением «${o.title}»")
        save()
    }

    override suspend fun reviewAfterPhoto(photoId: String, approve: Boolean) = lock.withLock {
        mod()
        val c = st.complaints.firstOrNull { x -> x.photos.any { it.id == photoId } } ?: return@withLock
        if (approve) withStatus(c.copy(photos = c.photos.map { if (it.id == photoId) it.copy(approved = true) else it }), Status.RESOLVED, "Модератор", "Фото «после» одобрено модератором")
        else put(c.copy(photos = c.photos.filterNot { it.id == photoId }))
        save()
    }

    companion object {
        /** The 15 demo complaints of the prototype (seedComplaints in app.js) with the same status chains. */
        fun seed(now: Long): List<Complaint> {
            data class S(val n: Int, val cat: String, val title: String, val desc: String, val lat: Double, val lng: Double, val addr: String, val district: String, val status: Status, val days: Int, val h: Int = 0, val sup: Int, val conf: Int = 0, val mine: Boolean = false)
            val rows = listOf(
                S(1, "snow", "Наледь на ступенях у входа в корпус", "Ступени у главного входа покрыты льдом, песка нет. Утром несколько человек поскользнулись.", 56.0042, 92.7735, "Свободный проспект, 79 с1", "Октябрьский район", Status.WORK, 2, sup = 31),
                S(2, "transit", "Разбито стекло остановочного павильона", "Осколки лежат на скамейке и под ногами, павильон не защищает от ветра.", 56.0031, 92.7668, "Свободный проспект", "Октябрьский район", Status.PUBLISHED, 1, 5, 24),
                S(3, "light", "Не горят фонари во дворе общежития", "Третий вечер подряд не работают два фонаря вдоль дорожки к общежитию, после 18:00 темно.", 55.9998, 92.7752, "Свободный проспект, 81В", "Октябрьский район", Status.SENT, 4, sup = 18),
                S(4, "road", "Глубокая яма на въезде во двор", "Яма около 40 см в диаметре, после дождя заполняется водой и её не видно.", 55.9952, 92.7965, "улица Борисова, 5", "Октябрьский район", Status.RESOLVED_WAIT, 9, sup = 12, conf = 1, mine = true),
                S(5, "trash", "Переполнены мусорные контейнеры", "Контейнеры не вывозили несколько дней, мусор разносит ветром.", 55.9938, 92.7905, "Студгородок СФУ", "Октябрьский район", Status.RESOLVED, 14, sup = 9),
                S(6, "green", "Сломана скамейка на аллее", "У скамейки отломана спинка, торчат болты.", 55.9921, 92.7662, "Академгородок", "Октябрьский район", Status.PUBLISHED, 3, sup = 5),
                S(7, "yard", "Разрушено ограждение детской площадки", "Секция забора лежит на земле, рядом проезжая часть.", 55.9960, 92.7600, "улица Академгородок, 23", "Октябрьский район", Status.MODERATION, 0, 2, 0, mine = true),
                S(8, "trash", "Несанкционированная свалка у гаражей", "Строительный мусор, покрышки и старая мебель. Куча растёт каждую неделю.", 56.0075, 92.7820, "улица Бригада № 5", "Октябрьский район", Status.PUBLISHED, 6, sup = 47),
                S(9, "road", "Колея и ямы на проезжей части", "Участок около 50 м, машины объезжают ямы по встречной полосе.", 56.0102, 92.8130, "улица Ладо Кецховели, 35", "Октябрьский район", Status.WORK, 11, sup = 63),
                S(10, "snow", "Не убран тротуар после снегопада", "Тротуар засыпан, пешеходы идут по проезжей части.", 56.0060, 92.8050, "Сопочная улица, 54А", "Октябрьский район", Status.PUBLISHED, 1, sup = 15),
                S(11, "light", "Не работает фонарь у пешеходного перехода", "Переход не освещён, водители замечают пешеходов в последний момент.", 56.0010, 92.8000, "улица Академика Киренского, 56", "Октябрьский район", Status.SENT, 5, sup = 22),
                S(13, "ice", "Сосульки над тротуаром", "Крупные сосульки над входом в магазин, зона не огорожена.", 56.0150, 92.7980, "улица Менжинского", "Октябрьский район", Status.PUBLISHED, 2, sup = 11),
                S(14, "green", "Упавшее дерево перегородило дорожку", "После ветра упала берёза, проход перекрыт.", 56.0120, 92.7700, "улица Забобонова", "Октябрьский район", Status.RESOLVED, 20, sup = 8),
                S(15, "yard", "Открытый люк во дворе", "Крышка люка сдвинута, вечером его не видно. Опасно для детей.", 55.9975, 92.8080, "Мелькомбинатская улица, 3А", "Октябрьский район", Status.WORK, 3, sup = 29),
                S(16, "road", "Разрушен бордюр у перекрёстка", "Куски бордюра на проезжей части.", 56.0185, 92.8200, "Новосибирская улица, 42", "Железнодорожный район", Status.PUBLISHED, 7, sup = 6),
            )
            val chains = mapOf(
                Status.PUBLISHED to listOf(Status.PUBLISHED),
                Status.SENT to listOf(Status.PUBLISHED, Status.SENT),
                Status.WORK to listOf(Status.PUBLISHED, Status.SENT, Status.WORK),
                Status.RESOLVED_WAIT to listOf(Status.PUBLISHED, Status.SENT, Status.WORK, Status.RESOLVED_WAIT),
                Status.RESOLVED to listOf(Status.PUBLISHED, Status.SENT, Status.WORK, Status.RESOLVED_WAIT, Status.RESOLVED),
                Status.MODERATION to emptyList(),
            )
            return rows.map { o ->
                val created = now - o.days * DAY - o.h * 3_600_000L
                val org = DEFAULT_CATS.first { it.id == o.cat }.org
                val notes = mapOf(
                    Status.PUBLISHED to "Проверено модератором и опубликовано",
                    Status.SENT to "Обращение направлено: $org",
                    Status.WORK to "Организация сообщила о начале работ",
                    Status.RESOLVED_WAIT to "Отмечено как решённое, ждём подтверждения жителей",
                    Status.RESOLVED to "Решение подтвердили жители",
                )
                val chain = chains[o.status].orEmpty()
                val hist = mutableListOf(HistoryItem(Status.MODERATION, created, "Автор", "Обращение создано"))
                chain.forEachIndexed { i, s ->
                    hist += HistoryItem(s, created + (i + 1) * (o.days * DAY / (chain.size + 1)), if (s == Status.RESOLVED) "Жители" else "Модератор", notes[s].orEmpty())
                }
                Complaint(
                    id = "demo-${o.n}", demo = true, title = o.title, category = o.cat, description = o.desc, lat = o.lat, lng = o.lng,
                    address = o.addr, district = o.district, status = o.status, createdAt = created, updatedAt = hist.last().at,
                    author = if (o.mine) "вы" else "житель_${100 + o.n}", supports = o.sup,
                    confirms = if (o.status == Status.RESOLVED) Krsk.CONFIRM_NEED else o.conf, history = hist.reversed(),
                )
            }
        }

        private fun seedNotifications(now: Long) = listOf(
            AppNotification("n1", "demo-7", "Обращение «Разрушено ограждение детской площадки» отправлено на модерацию", now - 2 * 3_600_000L, false, "yard"),
            AppNotification("n2", "demo-4", "Обращение «Глубокая яма на въезде во двор» отмечено как решённое. Подтвердите, если это так", now - 20 * 3_600_000L, false, "road"),
            AppNotification("n3", "demo-9", "Поддержанное вами обращение «Колея и ямы на проезжей части» в работе", now - 3 * DAY, true, "road"),
            AppNotification("n4", "demo-4", "Обращение «Глубокая яма на въезде во двор» передано в МКУ «Управление дорог, инфраструктуры и благоустройства»", now - 6 * DAY, true, "road"),
        )
    }
}
