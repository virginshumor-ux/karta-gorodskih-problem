package ru.sfu.kgp.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import ru.sfu.kgp.BuildConfig
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.WeatherData
import ru.sfu.kgp.domain.Wmo
import ru.sfu.kgp.domain.distM
import java.util.concurrent.TimeUnit

/** Own User-Agent for OpenStreetMap services (tile and Nominatim usage policies require it). */
val USER_AGENT = "${BuildConfig.APPLICATION_ID}/${BuildConfig.VERSION_NAME} (Karta gorodskih problem, Krasnoyarsk)"

fun httpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(6, TimeUnit.SECONDS)
    .readTimeout(10, TimeUnit.SECONDS)
    .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("User-Agent", USER_AGENT).build()) }
    .build()

private val json = Json { ignoreUnknownKeys = true }

data class GeoResult(val address: String, val district: String, val source: String)

/** Reverse geocoding: Nominatim (≤ 1 request/s, cached) → Photon → «рядом с: …» by the nearest known complaint. */
class Geocoder(private val http: OkHttpClient) {
    private val cache = LinkedHashMap<String, GeoResult>()
    private var lastNominatim = 0L

    suspend fun reverse(lat: Double, lng: Double, known: List<Complaint>): GeoResult = withContext(Dispatchers.IO) {
        val key = "%.5f,%.5f".format(java.util.Locale.US, lat, lng)
        cache[key]?.let { return@withContext it }
        runCatching {
            val wait = lastNominatim + 1100 - System.currentTimeMillis()
            if (wait > 0) Thread.sleep(wait)
            lastNominatim = System.currentTimeMillis()
            val o = get("https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=ru&lat=$lat&lon=$lng")
            val a = o["address"]?.jsonObject ?: JsonObject(emptyMap())
            fun s(k: String) = a[k]?.jsonPrimitive?.contentOrNull.orEmpty()
            val road = listOf("road", "pedestrian", "footway", "path", "neighbourhood", "suburb").map(::s).firstOrNull { it.isNotEmpty() }.orEmpty()
            val addr = if (road.isNotEmpty()) road + (s("house_number").takeIf { it.isNotEmpty() }?.let { ", $it" } ?: "") else o["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
            if (addr.isNotEmpty()) return@withContext remember(key, GeoResult(addr, s("city_district").ifEmpty { s("suburb") }, "nominatim"))
        }
        runCatching {
            val o = get("https://photon.komoot.io/reverse?lat=$lat&lon=$lng")
            val p = o["features"]?.jsonArray?.firstOrNull()?.jsonObject?.get("properties")?.jsonObject ?: JsonObject(emptyMap())
            fun s(k: String) = p[k]?.jsonPrimitive?.contentOrNull.orEmpty()
            val addr = if (s("street").isNotEmpty()) s("street") + (s("housenumber").takeIf { it.isNotEmpty() }?.let { ", $it" } ?: "") else s("name")
            if (addr.isNotEmpty()) return@withContext remember(key, GeoResult(addr, s("district"), "photon"))
        }
        val near = known.minByOrNull { distM(it.lat, it.lng, lat, lng) }
        if (near != null && distM(near.lat, near.lng, lat, lng) < 300) GeoResult("рядом с: ${near.address}", near.district, "local")
        else GeoResult("Точка на карте (адрес не определён)", "", "none")
    }

    private fun remember(k: String, r: GeoResult): GeoResult {
        cache[k] = r
        if (cache.size > 200) cache.remove(cache.keys.first())
        return r
    }

    private fun get(url: String): JsonObject {
        http.newCall(Request.Builder().url(url).build()).execute().use { r ->
            if (!r.isSuccessful) error("HTTP ${r.code}")
            return json.parseToJsonElement(r.body.string()).jsonObject
        }
    }
}

data class WeatherState(val data: WeatherData, val live: Boolean)

/** Open-Meteo with the last answer cached (shown with its time when offline). */
class WeatherRepository(private val http: OkHttpClient, private val settings: Settings, private val snapshot: () -> String) {
    fun cached(): WeatherState {
        val raw = settings.weatherJson ?: snapshot()
        return WeatherState(json.decodeFromString(WeatherData.serializer(), raw), false)
    }

    suspend fun fetch(): WeatherState? = withContext(Dispatchers.IO) {
        runCatching {
            http.newCall(Request.Builder().url(Wmo.URL).build()).execute().use { r ->
                if (!r.isSuccessful) error("HTTP ${r.code}")
                val d = json.decodeFromString(WeatherData.serializer(), r.body.string()).copy(fetchedAt = System.currentTimeMillis())
                settings.weatherJson = Json.encodeToString(WeatherData.serializer(), d)
                WeatherState(d, true)
            }
        }.getOrNull()
    }
}
