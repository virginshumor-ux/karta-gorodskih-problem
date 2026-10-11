package ru.sfu.kgp.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class Status(val title: String) {
    @SerialName("moderation") MODERATION("На модерации"),
    @SerialName("published") PUBLISHED("Опубликовано"),
    @SerialName("sent") SENT("Передано в организацию"),
    @SerialName("work") WORK("В работе"),
    @SerialName("resolved_wait") RESOLVED_WAIT("Решено — ждёт подтверждения"),
    @SerialName("resolved") RESOLVED("Решено"),
    @SerialName("rejected") REJECTED("Отклонено"),
    @SerialName("duplicate") DUPLICATE("Дубликат");

    val key: String get() = name.lowercase()
    val isOpen: Boolean get() = this in OPEN_STATUSES

    companion object {
        val OPEN_STATUSES = setOf(PUBLISHED, SENT, WORK, RESOLVED_WAIT)
        fun of(key: String): Status = entries.firstOrNull { it.key == key } ?: PUBLISHED
    }
}

@Serializable
data class Category(val id: String, val name: String, val icon: String, val color: String, val org: String)

@Serializable
data class Photo(val id: String, val path: String, val kind: String, val approved: Boolean, val url: String = "")

@Serializable
data class HistoryItem(val status: Status, val at: Long, val by: String, val comment: String)

@Serializable
data class Complaint(
    val id: String,
    val demo: Boolean,
    val title: String,
    val category: String,
    val description: String,
    val lat: Double,
    val lng: Double,
    val address: String,
    val district: String,
    val status: Status,
    val duplicateOf: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val photos: List<Photo> = emptyList(),
    val author: String,
    val mine: Boolean = false,
    val supports: Int = 0,
    val supportedByMe: Boolean = false,
    val confirms: Int = 0,
    val confirmedByMe: Boolean = false,
    val history: List<HistoryItem> = emptyList(),
) {
    /** Public gallery: "before" photos and approved "after" photos (the author also sees pending ones). */
    val gallery: List<Photo> get() = photos.filter { it.kind == "before" || it.approved || mine }
}

@Serializable
data class AppNotification(val id: String, val complaintId: String?, val text: String, val at: Long, val read: Boolean, val cat: String)

enum class Provider(val key: String, val title: String) { YANDEX("yandex", "Яндекс ID"), VK("vk", "VK ID"), DEMO("demo", "демо-вход") }
enum class Role { USER, MODERATOR, ADMIN }

@Serializable
data class UserStats(val complaints: Int = 0, val solved: Int = 0, val supported: Int = 0)

data class User(
    val id: String,
    val nick: String,
    val provider: Provider,
    val role: Role,
    val notifyEnabled: Boolean,
    val isBlocked: Boolean,
    val stats: UserStats,
) {
    val isModerator: Boolean get() = role == Role.MODERATOR || role == Role.ADMIN
}

sealed interface AuthState {
    data object Guest : AuthState
    /** Signed in but the nickname and the separate PD consent are not given yet (152-ФЗ). */
    data class NeedsProfile(val provider: Provider) : AuthState
    data class SignedIn(val user: User) : AuthState
}

enum class StatusFilter { OPEN, RESOLVED, ALL }
enum class Period(val days: Int?, val title: String) { ALL(null, "За всё время"), WEEK(7, "За 7 дней"), MONTH(30, "За 30 дней") }

data class Filter(
    val cats: Set<String> = emptySet(),
    val status: StatusFilter = StatusFilter.OPEN,
    val mine: Boolean = false,
    val district: String = "",
    val period: Period = Period.ALL,
)

data class Duplicate(val id: String, val title: String, val status: Status, val supports: Int, val address: String, val distance: Double)

data class Stats(
    val total: Int,
    val open: Int,
    val resolved: Int,
    val supports: Int,
    val byDay: List<Pair<String, Int>>,
    val byCategory: List<Pair<String, Int>>,
    val byStatus: List<Pair<Status, Int>>,
    val byDistrict: List<Pair<String, Int>>,
    val medianModerationHours: Double?,
    val medianResolutionDays: Double?,
)

/** A complaint ready to be sent: photos are compressed JPEG files in the app storage. */
@Serializable
data class NewComplaint(
    val id: String,
    val category: String,
    val title: String,
    val description: String,
    val lat: Double,
    val lng: Double,
    val address: String,
    val district: String,
    val photoFiles: List<String>,
)
