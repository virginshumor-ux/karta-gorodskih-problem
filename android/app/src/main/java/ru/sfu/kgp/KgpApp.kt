package ru.sfu.kgp

import android.app.Application
import android.content.Context
import okhttp3.OkHttpClient
import org.maplibre.android.MapLibre
import org.maplibre.android.module.http.HttpRequestUtil
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
        check(USER_AGENT.isNotEmpty())
        if (!::container.isInitialized) container = AppContainer(this)
        if (ru.sfu.kgp.map.mapsSupported) {
            MapLibre.getInstance(this)
            // Map tiles go through our OkHttp client: the identifying User-Agent required by the OSM tile policy.
            // MapLibre caches only viewed tiles (ambient cache), nothing is prefetched.
            HttpRequestUtil.setOkHttpClient(container.http)
        }
        Notifier.createChannel(this)
        Work.scheduleNotificationPolling(this)
        Work.scheduleDraftUpload(this)
    }
}
