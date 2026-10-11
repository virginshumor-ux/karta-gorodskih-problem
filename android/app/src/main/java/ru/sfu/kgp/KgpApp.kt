package ru.sfu.kgp

import android.app.Application
import android.content.Context
import okhttp3.OkHttpClient
import org.osmdroid.config.Configuration
import ru.sfu.kgp.data.Backend
import ru.sfu.kgp.data.DemoBackend
import ru.sfu.kgp.data.Geocoder
import ru.sfu.kgp.data.Photos
import ru.sfu.kgp.data.Repository
import ru.sfu.kgp.data.Settings
import ru.sfu.kgp.data.SupabaseBackend
import ru.sfu.kgp.data.USER_AGENT
import ru.sfu.kgp.data.WeatherRepository
import ru.sfu.kgp.data.db.AppDatabase
import ru.sfu.kgp.data.httpClient
import ru.sfu.kgp.work.Notifier
import ru.sfu.kgp.work.Work
import java.io.File

/** Manual DI: one container per process. Tests build their own with a DemoBackend and an in-memory DB. */
class AppContainer(
    val context: Context,
    val settings: Settings = Settings(context),
    val db: AppDatabase = AppDatabase.create(context),
    val http: OkHttpClient = httpClient(),
    backend: Backend? = null,
) {
    val hasServer: Boolean = BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()
    val backend: Backend = backend ?: if (hasServer) SupabaseBackend() else DemoBackend(File(context.filesDir, "demo-state.json"))
    val photos = Photos(context)
    val geocoder = Geocoder(http)
    val weather = WeatherRepository(http, settings) { context.assets.open("weather-snapshot.json").bufferedReader().use { it.readText() } }
    val repository = Repository(this.backend, db, scheduleUpload = { Work.scheduleDraftUpload(context) })
    val privacyText: String by lazy { context.assets.open("privacy.md").bufferedReader().use { it.readText() } }
}

open class KgpApp : Application() {
    lateinit var container: AppContainer

    override fun onCreate() {
        super.onCreate()
        // OSM tile usage policy: an identifying User-Agent is mandatory, otherwise tiles are blocked.
        Configuration.getInstance().apply {
            userAgentValue = BuildConfig.APPLICATION_ID + "/" + BuildConfig.VERSION_NAME
            osmdroidBasePath = File(cacheDir, "osmdroid")
            osmdroidTileCache = File(cacheDir, "osmdroid/tiles")
            // Only viewed tiles are cached; nothing is prefetched (no bulk downloads).
            tileFileSystemCacheMaxBytes = 200L * 1024 * 1024
        }
        check(USER_AGENT.isNotEmpty())
        if (!::container.isInitialized) container = AppContainer(this)
        Notifier.createChannel(this)
        Work.scheduleNotificationPolling(this)
        Work.scheduleDraftUpload(this)
    }
}
