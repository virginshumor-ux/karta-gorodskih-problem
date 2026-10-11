package ru.sfu.kgp

import android.content.Context
import android.util.Log
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import okhttp3.OkHttpClient
import ru.sfu.kgp.data.Backend
import ru.sfu.kgp.data.DemoBackend
import ru.sfu.kgp.data.Settings
import ru.sfu.kgp.data.db.AppDatabase
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.NewComplaint
import java.io.IOException

/** HTTP client that is always "offline": tests never touch OSM, Nominatim or Open-Meteo. */
fun offlineHttp(): OkHttpClient = OkHttpClient.Builder().addInterceptor { throw IOException("offline in tests") }.build()

fun testContainer(context: Context, backend: Backend = DemoBackend(null)) = AppContainer(
    context = context,
    settings = Settings(context.getSharedPreferences("kgp-test-${System.nanoTime()}", Context.MODE_PRIVATE)),
    db = AppDatabase.create(context, inMemory = true),
    http = offlineHttp(),
    backend = backend,
)

/** Application for Robolectric: synchronous WorkManager and an isolated container (see robolectric.properties). */
class TestApp : KgpApp() {
    override fun onCreate() {
        WorkManagerTestInitHelper.initializeTestWorkManager(
            this,
            Configuration.Builder().setMinimumLoggingLevel(Log.ERROR).setExecutor(SynchronousExecutor()).build(),
        )
        container = testContainer(this)
        super.onCreate()
    }
}

/** Backend whose network can be switched off: delegates to the demo backend, throws IOException when offline. */
class FlakyBackend(val inner: DemoBackend = DemoBackend(null)) : Backend by inner {
    var offline = false
    override val isDemo = false

    private fun check() {
        if (offline) throw IOException("Unable to resolve host")
    }

    override suspend fun feed(): List<Complaint> { check(); return inner.feed() }
    override suspend fun createComplaint(c: NewComplaint): String { check(); return inner.createComplaint(c) }
    override suspend fun nearbyDuplicates(lat: Double, lng: Double, category: String) = run { check(); inner.nearbyDuplicates(lat, lng, category) }
}
