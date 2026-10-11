package ru.sfu.kgp.data

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.OtpType
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.rpc
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import io.github.jan.supabase.storage.Storage
import io.github.jan.supabase.storage.storage
import io.ktor.http.ContentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add
import ru.sfu.kgp.BuildConfig
import ru.sfu.kgp.domain.AppException
import ru.sfu.kgp.domain.AppNotification
import ru.sfu.kgp.domain.AuthState
import ru.sfu.kgp.domain.Category
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.Duplicate
import ru.sfu.kgp.domain.HistoryItem
import ru.sfu.kgp.domain.NewComplaint
import ru.sfu.kgp.domain.Photo
import ru.sfu.kgp.domain.Provider
import ru.sfu.kgp.domain.Role
import ru.sfu.kgp.domain.Stats
import ru.sfu.kgp.domain.Status
import ru.sfu.kgp.domain.User
import ru.sfu.kgp.domain.UserStats
import ru.sfu.kgp.domain.toAppException
import java.io.File
import java.time.Instant
import kotlin.time.Duration.Companion.hours

@Serializable
private data class FeedRow(
    val id: String,
    @SerialName("category_id") val categoryId: String,
    val title: String,
    val description: String,
    val lat: Double,
    val lng: Double,
    val address: String,
    val district: String,
    val status: Status,
    @SerialName("duplicate_of") val duplicateOf: String? = null,
    @SerialName("supports_count") val supports: Int,
    @SerialName("confirms_count") val confirms: Int,
    @SerialName("is_demo") val isDemo: Boolean,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
    @SerialName("author_nickname") val author: String,
    @SerialName("is_mine") val isMine: Boolean,
    @SerialName("supported_by_me") val supportedByMe: Boolean,
    @SerialName("confirmed_by_me") val confirmedByMe: Boolean,
    val photos: List<PhotoRow> = emptyList(),
)

@Serializable
private data class PhotoRow(val id: String, val path: String, val kind: String, val approved: Boolean)

@Serializable
private data class HistoryRow(
    @SerialName("new_status") val status: Status,
    @SerialName("actor_label") val by: String,
    val comment: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
private data class ProfileJson(
    val id: String,
    val nickname: String,
    val provider: String,
    val role: String,
    @SerialName("is_blocked") val isBlocked: Boolean,
    @SerialName("notify_enabled") val notifyEnabled: Boolean,
    val complaints: Int = 0,
    val solved: Int = 0,
    val supported: Int = 0,
)

@Serializable
private data class CategoryRow(
    val id: String,
    val name: String,
    val icon: String,
    val color: String,
    @SerialName("org_hint") val org: String,
    @SerialName("is_active") val isActive: Boolean = true,
)

@Serializable
private data class NotificationRow(
    val id: String,
    @SerialName("complaint_id") val complaintId: String? = null,
    val text: String,
    @SerialName("read_at") val readAt: String? = null,
    @SerialName("created_at") val createdAt: String,
    val complaints: CatRef? = null,
)

@Serializable
private data class CatRef(@SerialName("category_id") val categoryId: String)

@Serializable
private data class DupRow(
    val id: String,
    val title: String,
    val status: Status,
    @SerialName("supports_count") val supports: Int,
    val address: String,
    @SerialName("distance_m") val distance: Double,
)

@Serializable
private data class StatsJson(
    val total: Int,
    val open: Int,
    val resolved: Int,
    val supports: Int,
    @SerialName("by_day") val byDay: List<DayN> = emptyList(),
    @SerialName("by_category") val byCategory: List<CatN> = emptyList(),
    @SerialName("by_status") val byStatus: List<StatusN> = emptyList(),
    @SerialName("by_district") val byDistrict: List<DistrictN> = emptyList(),
    @SerialName("median_moderation_hours") val medianModerationHours: Double? = null,
    @SerialName("median_resolution_days") val medianResolutionDays: Double? = null,
) {
    @Serializable data class DayN(val day: String, val n: Int)
    @Serializable data class CatN(@SerialName("category_id") val categoryId: String, val n: Int)
    @Serializable data class StatusN(val status: Status, val n: Int)
    @Serializable data class DistrictN(val district: String, val n: Int)
}

@Serializable
private data class ConfirmJson(val status: Status, @SerialName("confirms_count") val confirms: Int)

private const val FEED_COLUMNS =
    "id,category_id,title,description,lat,lng,address,district,status,duplicate_of,supports_count,confirms_count,is_demo," +
        "created_at,updated_at,author_nickname,is_mine,supported_by_me,confirmed_by_me,photos"

private fun ts(s: String): Long = runCatching { Instant.parse(s).toEpochMilli() }
    .getOrElse { runCatching { java.time.OffsetDateTime.parse(s).toInstant().toEpochMilli() }.getOrDefault(0L) }

/** Shared database through supabase-kt (Auth, Postgrest, Storage, Realtime, Functions). */
class SupabaseBackend(
    url: String = BuildConfig.SUPABASE_URL,
    anonKey: String = BuildConfig.SUPABASE_ANON_KEY,
) : Backend {
    override val isDemo = false
    private val baseUrl = url.trimEnd('/')

    val client: SupabaseClient = createSupabaseClient(url, anonKey) {
        install(Auth) {
            scheme = "kgp"
            host = "auth"
        }
        install(Postgrest)
        install(Storage)
        install(Realtime)
        install(Functions)
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val signed = HashMap<String, Pair<String, Long>>()

    private suspend fun <T> call(block: suspend () -> T): T = try {
        block()
    } catch (e: Throwable) {
        throw e.toAppException()
    }

    private fun uid(): String? = client.auth.currentUserOrNull()?.id

    override suspend fun init(): AuthState = call {
        client.auth.awaitInitialization()
        stateForCurrent()
    }

    private suspend fun stateForCurrent(): AuthState {
        val user = client.auth.currentUserOrNull() ?: return AuthState.Guest
        val raw = client.postgrest.rpc("my_profile").decodeAs<JsonElement>()
        val provider = when (user.appMetadata?.get("kgp_provider")?.jsonPrimitive?.contentOrNull) {
            "yandex" -> Provider.YANDEX
            "vk" -> Provider.VK
            else -> Provider.DEMO
        }
        if (raw is JsonNull) return AuthState.NeedsProfile(provider)
        return AuthState.SignedIn(toUser(json.decodeFromJsonElement(ProfileJson.serializer(), raw)))
    }

    private fun toUser(p: ProfileJson) = User(
        id = p.id,
        nick = p.nickname,
        provider = Provider.entries.firstOrNull { it.key == p.provider } ?: Provider.DEMO,
        role = when (p.role) { "admin" -> Role.ADMIN; "moderator" -> Role.MODERATOR; else -> Role.USER },
        notifyEnabled = p.notifyEnabled,
        isBlocked = p.isBlocked,
        stats = UserStats(p.complaints, p.solved, p.supported),
    )

    override suspend fun categories(): List<Category> = call {
        client.from("categories").select(Columns.raw("id,name,icon,color,org_hint,is_active")) { order("sort", Order.ASCENDING) }
            .decodeList<CategoryRow>().filter { it.isActive }.map { Category(it.id, it.name, it.icon, it.color, it.org) }
    }

    override suspend fun feed(): List<Complaint> = call {
        val rows = client.from("complaint_feed").select(Columns.raw(FEED_COLUMNS)) {
            order("created_at", Order.DESCENDING)
            limit(1000)
        }.decodeList<FeedRow>()
        sign(rows.mapNotNull { it.photos.firstOrNull()?.path })
        rows.map { toComplaint(it) }
    }

    override suspend fun complaint(id: String): Complaint? = call {
        val row = client.from("complaint_feed").select(Columns.raw(FEED_COLUMNS)) { filter { eq("id", id) } }
            .decodeSingleOrNull<FeedRow>() ?: return@call null
        val hist = client.from("status_history").select(Columns.raw("id,new_status,actor_label,comment,created_at")) {
            filter { eq("complaint_id", id) }
            order("created_at", Order.DESCENDING)
            order("id", Order.DESCENDING)
        }.decodeList<HistoryRow>()
        sign(row.photos.map { it.path })
        toComplaint(row).copy(history = hist.map { HistoryItem(it.status, ts(it.createdAt), it.by, it.comment) })
    }

    private suspend fun sign(paths: List<String>) {
        val now = System.currentTimeMillis()
        val need = paths.distinct().filter { (signed[it]?.second ?: 0) < now + 60_000 }
        need.chunked(100).forEach { chunk ->
            runCatching { client.storage.from("photos").createSignedUrls(1.hours, chunk) }.getOrNull()?.forEach {
                if (it.error == null) signed[it.path] = (if (it.signedURL.startsWith("http")) it.signedURL else "$baseUrl/storage/v1${it.signedURL}") to now + 3_600_000
            }
        }
    }

    private fun toComplaint(r: FeedRow) = Complaint(
        id = r.id, demo = r.isDemo, title = r.title, category = r.categoryId, description = r.description,
        lat = r.lat, lng = r.lng, address = r.address, district = r.district, status = r.status, duplicateOf = r.duplicateOf,
        createdAt = ts(r.createdAt), updatedAt = ts(r.updatedAt),
        photos = r.photos.map { Photo(it.id, it.path, it.kind, it.approved, signed[it.path]?.first.orEmpty()) },
        author = r.author, mine = r.isMine, supports = r.supports, supportedByMe = r.supportedByMe,
        confirms = r.confirms, confirmedByMe = r.confirmedByMe,
    )

    override suspend fun nearbyDuplicates(lat: Double, lng: Double, category: String): List<Duplicate> = call {
        client.postgrest.rpc("nearby_duplicates", buildJsonObject {
            put("p_lat", lat); put("p_lng", lng); put("p_category", category); put("p_radius_m", 30)
        }).decodeList<DupRow>().map { Duplicate(it.id, it.title, it.status, it.supports, it.address, it.distance) }
    }

    override suspend fun stats(): Stats = call {
        val s = client.postgrest.rpc("stats_summary", buildJsonObject { put("p_days", 21) }).decodeAs<StatsJson>()
        Stats(
            s.total, s.open, s.resolved, s.supports,
            s.byDay.map { it.day to it.n }, s.byCategory.map { it.categoryId to it.n }, s.byStatus.map { it.status to it.n },
            s.byDistrict.map { it.district to it.n }, s.medianModerationHours, s.medianResolutionDays,
        )
    }

    // ---------- auth ----------

    override suspend fun signInDemo(): AuthState = call {
        if (!BuildConfig.DEMO_LOGIN_ENABLED) throw AppException("Демо-вход отключён.")
        client.auth.signInAnonymously()
        stateForCurrent()
    }

    override fun providerAvailable(provider: String) =
        if (provider == "yandex") BuildConfig.YANDEX_CLIENT_ID.isNotBlank() else BuildConfig.VK_CLIENT_ID.isNotBlank()

    override fun oauthStartUrl(provider: String): String? =
        if (!providerAvailable(provider)) null else "$baseUrl/functions/v1/auth-$provider?start=1&platform=android"

    override suspend fun finishRedirect(tokenHash: String?, error: String?): AuthState = call {
        if (error != null) throw AppException(error)
        if (tokenHash.isNullOrBlank()) throw AppException("Ссылка входа устарела. Войдите ещё раз.")
        client.auth.verifyEmailOtp(OtpType.Email.EMAIL, tokenHash)
        stateForCurrent()
    }

    override suspend fun completeProfile(nickname: String, consent: Boolean): AuthState = call {
        client.postgrest.rpc("complete_profile", buildJsonObject { put("p_nickname", nickname); put("p_consent", consent) })
        stateForCurrent()
    }

    override suspend fun signOut() = call { client.auth.signOut() }

    override suspend fun deleteAccount() = call {
        val r = client.functions.invoke("delete-account")
        if (!r.status.isSuccess()) throw AppException("Не удалось удалить учётную запись. Повторите попытку.")
        runCatching { client.auth.clearSession() }
        Unit
    }

    override suspend fun updateSettings(notifyEnabled: Boolean): User = call {
        toUser(client.postgrest.rpc("update_my_settings", buildJsonObject { put("p_notify_enabled", notifyEnabled) }).decodeAs<ProfileJson>())
    }

    // ---------- actions ----------

    override suspend fun createComplaint(c: NewComplaint): String = call {
        val me = uid() ?: throw AppException("Войдите, чтобы отправить обращение.", "KGP_AUTH")
        val paths = c.photoFiles.mapIndexed { i, f ->
            val path = "$me/${c.id}/${i + 1}.jpg"
            client.storage.from("photos").upload(path, File(f).readBytes()) {
                upsert = true
                contentType = ContentType.Image.JPEG
            }
            path
        }
        client.postgrest.rpc("create_complaint", buildJsonObject {
            put("p_id", c.id); put("p_category", c.category); put("p_title", c.title); put("p_description", c.description)
            put("p_lat", c.lat); put("p_lng", c.lng); put("p_address", c.address); put("p_district", c.district)
            putJsonArray("p_photos") { paths.forEach { add(it) } }
        }).decodeAs<String>()
    }

    override suspend fun setSupport(id: String, on: Boolean): Int = call {
        client.postgrest.rpc("set_support", buildJsonObject { put("p_id", id); put("p_on", on) }).decodeAs<Int>()
    }

    override suspend fun confirm(id: String, resolved: Boolean): Pair<Status, Int> = call {
        val r = client.postgrest.rpc("confirm_resolution", buildJsonObject { put("p_id", id); put("p_resolved", resolved) }).decodeAs<ConfirmJson>()
        r.status to r.confirms
    }

    override suspend fun markSent(id: String) = call {
        client.postgrest.rpc("author_mark_sent", buildJsonObject { put("p_id", id) })
        Unit
    }

    override suspend fun addAfterPhoto(id: String, file: String) = call {
        val me = uid() ?: throw AppException("Войдите, чтобы продолжить.", "KGP_AUTH")
        val path = "$me/$id/after-${System.currentTimeMillis()}.jpg"
        client.storage.from("photos").upload(path, File(file).readBytes()) { upsert = true; contentType = ContentType.Image.JPEG }
        client.postgrest.rpc("add_after_photo", buildJsonObject { put("p_id", id); put("p_path", path) })
        Unit
    }

    override suspend fun report(id: String, reason: String) = call {
        client.postgrest.rpc("report_complaint", buildJsonObject { put("p_id", id); put("p_reason", reason) })
        Unit
    }

    override suspend fun notifications(): List<AppNotification> = call {
        if (uid() == null) return@call emptyList()
        client.from("notifications").select(Columns.raw("id,complaint_id,text,read_at,created_at,complaints(category_id)")) {
            order("created_at", Order.DESCENDING)
            limit(100)
        }.decodeList<NotificationRow>().map {
            AppNotification(it.id, it.complaintId, it.text, ts(it.createdAt), it.readAt != null, it.complaints?.categoryId ?: "other")
        }
    }

    override suspend fun markRead(ids: List<String>?) = call {
        client.postgrest.rpc("mark_notifications_read", buildJsonObject {
            if (ids == null) put("p_ids", JsonNull) else putJsonArray("p_ids") { ids.forEach { add(it) } }
        })
        Unit
    }

    override fun notificationStream(): Flow<AppNotification> {
        val me = uid() ?: return emptyFlow()
        return flow {
            val ch = client.realtime.channel("notifications-android-$me")
            val changes = ch.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
                table = "notifications"
                filter = "user_id=eq.$me"
            }
            ch.subscribe()
            try {
                changes.map { it.record }.collect { r: JsonObject -> emit(toNotification(r)) }
            } finally {
                runCatching { ch.unsubscribe() }
            }
        }
    }

    private fun toNotification(r: JsonObject) = AppNotification(
        id = r["id"]?.jsonPrimitive?.content.orEmpty(),
        complaintId = r["complaint_id"]?.jsonPrimitive?.contentOrNull,
        text = r["text"]?.jsonPrimitive?.content.orEmpty(),
        at = ts(r["created_at"]?.jsonPrimitive?.content.orEmpty()),
        read = false,
        cat = "",
    )

    // ---------- moderation ----------

    override suspend fun moderateStatus(id: String, status: Status, comment: String?) = call {
        client.postgrest.rpc("moderate_set_status", buildJsonObject {
            put("p_id", id); put("p_status", status.key); if (comment != null) put("p_comment", comment) else put("p_comment", JsonNull)
        })
        Unit
    }

    override suspend fun markDuplicate(id: String, originalId: String) = call {
        client.postgrest.rpc("moderate_mark_duplicate", buildJsonObject { put("p_id", id); put("p_original", originalId) })
        Unit
    }

    override suspend fun reviewAfterPhoto(photoId: String, approve: Boolean) = call {
        client.postgrest.rpc("moderate_review_after_photo", buildJsonObject { put("p_photo", photoId); put("p_approve", approve) })
        Unit
    }
}
