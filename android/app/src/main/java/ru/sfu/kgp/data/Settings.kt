package ru.sfu.kgp.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

enum class ThemeMode(val title: String) { SYSTEM("как в системе"), LIGHT("светлая"), DARK("тёмная") }

/** Small local preferences (the prototype's localStorage). */
class Settings(private val prefs: SharedPreferences) {
    constructor(context: Context) : this(context.getSharedPreferences("kgp", Context.MODE_PRIVATE))

    var onboarded: Boolean
        get() = prefs.getBoolean("onboarded", false)
        set(v) = prefs.edit { putBoolean("onboarded", v) }

    var theme: ThemeMode
        get() = runCatching { ThemeMode.valueOf(prefs.getString("theme", ThemeMode.SYSTEM.name)!!) }.getOrDefault(ThemeMode.SYSTEM)
        set(v) = prefs.edit { putString("theme", v.name) }

    /** Last notification time already shown as a system notification (NotificationPollWorker). */
    var lastNotifiedAt: Long
        get() = prefs.getLong("lastNotifiedAt", 0L)
        set(v) = prefs.edit { putLong("lastNotifiedAt", v) }

    var weatherJson: String?
        get() = prefs.getString("weather", null)
        set(v) = prefs.edit { putString("weather", v) }

    var airJson: String?
        get() = prefs.getString("air", null)
        set(v) = prefs.edit { putString("air", v) }

    /** Density view of the main map instead of pins. */
    var heatmap: Boolean
        get() = prefs.getBoolean("heatmap", false)
        set(v) = prefs.edit { putBoolean("heatmap", v) }

    var pendingAction: String?
        get() = prefs.getString("pending", null)
        set(v) = prefs.edit { putString("pending", v) }
}
