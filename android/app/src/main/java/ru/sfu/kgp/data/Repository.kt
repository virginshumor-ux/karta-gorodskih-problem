package ru.sfu.kgp.data

import kotlinx.serialization.json.Json
import ru.sfu.kgp.data.db.AppDatabase
import ru.sfu.kgp.data.db.CachedComplaint
import ru.sfu.kgp.data.db.DraftEntity
import ru.sfu.kgp.data.db.KvEntity
import ru.sfu.kgp.data.db.WizardStateEntity
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.NewComplaint
import ru.sfu.kgp.domain.toAppException

data class Feed(val items: List<Complaint>, val offlineSince: Long?)

sealed interface SubmitResult {
    data class Sent(val id: String) : SubmitResult
    /** No connection: the complaint is a draft now and DraftUploadWorker will send it. */
    data object SavedOffline : SubmitResult
}

/** Feed with an offline cache (Room), offline drafts (Ф-07) and the saved wizard state. */
class Repository(
    val backend: Backend,
    private val db: AppDatabase,
    private val scheduleUpload: () -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun feed(): Feed = try {
        val items = backend.feed()
        if (!backend.isDemo) {
            db.cache().replaceAll(items.map { CachedComplaint(it.id, json.encodeToString(Complaint.serializer(), it), it.createdAt) })
            db.cache().putKv(KvEntity("feedAt", clock().toString(), clock()))
        }
        Feed(items, null)
    } catch (e: Throwable) {
        val err = e.toAppException()
        val cached = db.cache().all()
        if (!err.offline || cached.isEmpty()) throw err
        Feed(cached.map { json.decodeFromString(Complaint.serializer(), it.json) }, db.cache().kv("feedAt")?.at ?: 0L)
    }

    suspend fun submit(c: NewComplaint): SubmitResult = try {
        SubmitResult.Sent(backend.createComplaint(c))
    } catch (e: Throwable) {
        val err = e.toAppException()
        if (!err.offline) throw err
        db.drafts().put(DraftEntity(c.id, json.encodeToString(NewComplaint.serializer(), c), c.title, clock()))
        scheduleUpload()
        SubmitResult.SavedOffline
    }

    suspend fun pendingDrafts(): Int = db.drafts().count()

    /**
     * Sends saved drafts. Returns titles of sent drafts; stops at the first network error (retry later).
     * Drafts the server rejects for good (e.g. out of the city) are dropped with their error.
     */
    suspend fun flushDrafts(onRejected: (String, String) -> Unit = { _, _ -> }): List<String> {
        val sent = mutableListOf<String>()
        for (d in db.drafts().all()) {
            val c = json.decodeFromString(NewComplaint.serializer(), d.json)
            try {
                backend.createComplaint(c)
                db.drafts().delete(d.id)
                sent += d.title
            } catch (e: Throwable) {
                val err = e.toAppException()
                when {
                    err.offline -> return sent
                    err.code == "KGP_RATE_LIMIT" || err.code == "KGP_AUTH" ->
                        db.drafts().put(d.copy(attempts = d.attempts + 1, lastError = err.message))
                    else -> {
                        db.drafts().delete(d.id)
                        onRejected(d.title, err.message.orEmpty())
                    }
                }
            }
        }
        return sent
    }

    suspend fun saveWizard(stateJson: String) = db.drafts().saveWizard(WizardStateEntity(0, stateJson, clock()))
    suspend fun loadWizard(): String? = db.drafts().wizard()?.json
    suspend fun clearWizard() = db.drafts().clearWizard()
}
