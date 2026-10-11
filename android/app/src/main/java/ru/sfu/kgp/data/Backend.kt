package ru.sfu.kgp.data

import kotlinx.coroutines.flow.Flow
import ru.sfu.kgp.domain.AppNotification
import ru.sfu.kgp.domain.AuthState
import ru.sfu.kgp.domain.Category
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.Duplicate
import ru.sfu.kgp.domain.NewComplaint
import ru.sfu.kgp.domain.Stats
import ru.sfu.kgp.domain.Status
import ru.sfu.kgp.domain.User

/**
 * Everything the screens need from the server — the same contract as the site (web/src/api/backend.ts).
 * SupabaseBackend works with the shared database; DemoBackend is the standalone mode used when the APK
 * is built without server settings (and by unit tests).
 */
interface Backend {
    val isDemo: Boolean

    suspend fun init(): AuthState
    suspend fun categories(): List<Category>
    suspend fun feed(): List<Complaint>
    suspend fun complaint(id: String): Complaint?
    suspend fun nearbyDuplicates(lat: Double, lng: Double, category: String): List<Duplicate>
    suspend fun stats(): Stats

    suspend fun signInDemo(): AuthState
    fun providerAvailable(provider: String): Boolean
    /** URL to open in a Custom Tab; the Edge Function returns to kgp://auth/callback?token_hash=… */
    fun oauthStartUrl(provider: String): String?
    suspend fun finishRedirect(tokenHash: String?, error: String?): AuthState
    suspend fun completeProfile(nickname: String, consent: Boolean): AuthState
    suspend fun signOut()
    suspend fun deleteAccount()
    suspend fun updateSettings(notifyEnabled: Boolean): User

    /** Idempotent by [NewComplaint.id] — a retried offline draft never creates a second complaint. */
    suspend fun createComplaint(c: NewComplaint): String
    suspend fun setSupport(id: String, on: Boolean): Int
    suspend fun confirm(id: String, resolved: Boolean): Pair<Status, Int>
    suspend fun markSent(id: String)
    suspend fun addAfterPhoto(id: String, file: String)
    suspend fun report(id: String, reason: String)
    suspend fun notifications(): List<AppNotification>
    suspend fun markRead(ids: List<String>? = null)
    /** New notifications while the app is open (Realtime); empty for the demo backend. */
    fun notificationStream(): Flow<AppNotification>

    suspend fun moderateStatus(id: String, status: Status, comment: String? = null)
    suspend fun markDuplicate(id: String, originalId: String)
    suspend fun reviewAfterPhoto(photoId: String, approve: Boolean)
}
