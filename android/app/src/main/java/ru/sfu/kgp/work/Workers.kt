package ru.sfu.kgp.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ru.sfu.kgp.KgpApp
import ru.sfu.kgp.MainActivity
import ru.sfu.kgp.R
import ru.sfu.kgp.domain.AppNotification
import ru.sfu.kgp.domain.toAppException
import java.util.concurrent.TimeUnit

/** Ф-07: sends offline drafts when the network is back (constraint CONNECTED, exponential backoff). */
class DraftUploadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as KgpApp).container
        return try {
            c.repository.backend.init()
            val sent = c.repository.flushDrafts { title, error -> Notifier.show(applicationContext, "draft-$title".hashCode(), "Черновик не принят", "«$title»: $error", null) }
            sent.forEach { Notifier.show(applicationContext, it.hashCode(), "Черновик отправлен", "«$it» отправлено на модерацию", null) }
            if (c.repository.pendingDrafts() > 0) Result.retry() else Result.success()
        } catch (e: Throwable) {
            if (e.toAppException().offline) Result.retry() else Result.failure()
        }
    }
}

/**
 * Ф-11 without FCM (no Firebase): every 15 minutes new status notifications are fetched from the
 * `notifications` table and shown as local notifications.
 */
class NotificationPollWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as KgpApp).container
        return try {
            c.repository.backend.init()
            val last = c.settings.lastNotifiedAt
            val fresh = c.repository.backend.notifications().filter { !it.read && it.at > last }.sortedBy { it.at }
            fresh.forEach { Notifier.show(applicationContext, it) }
            fresh.maxOfOrNull { it.at }?.let { c.settings.lastNotifiedAt = it }
            Result.success()
        } catch (e: Throwable) {
            if (e.toAppException().offline) Result.retry() else Result.success()
        }
    }
}

object Work {
    private val connected = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun scheduleDraftUpload(context: Context) {
        val req = OneTimeWorkRequestBuilder<DraftUploadWorker>()
            .setConstraints(connected)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("draft-upload", ExistingWorkPolicy.REPLACE, req)
    }

    fun scheduleNotificationPolling(context: Context) {
        val req = PeriodicWorkRequestBuilder<NotificationPollWorker>(15, TimeUnit.MINUTES).setConstraints(connected).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("notification-poll", ExistingPeriodicWorkPolicy.KEEP, req)
    }
}

object Notifier {
    const val CHANNEL = "status"

    fun createChannel(context: Context) {
        val ch = NotificationChannel(CHANNEL, "Статусы обращений", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Изменения статусов ваших и поддержанных обращений"
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    fun show(context: Context, n: AppNotification) =
        show(context, n.id.hashCode(), "Карта городских проблем", n.text, n.complaintId)

    fun show(context: Context, id: Int, title: String, text: String, complaintId: String?) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = (if (complaintId != null) "kgp://complaint/$complaintId" else "kgp://notifications").toUri()
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_kgp)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id, notification) }
    }
}
