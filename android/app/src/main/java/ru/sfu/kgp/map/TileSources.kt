package ru.sfu.kgp.map

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.tileprovider.tilesource.XYTileSource
import kotlin.math.abs

/**
 * The same chain as the site: tile.openstreetmap.org → tile.openstreetmap.de → a.tile.openstreetmap.fr.
 * OSM blocks clients without a proper User-Agent and serves an "Access blocked" image (sometimes with HTTP 200),
 * so the first tile is downloaded and checked by its pixels. CARTO basemaps are not used (they need an API key).
 */
data class TileSourceDef(val id: String, val urls: Array<String>, val maxZoom: Int, val attribution: String, val probe: String) {
    fun toOsmdroid(): OnlineTileSourceBase = XYTileSource(id, 3, maxZoom, 256, ".png", urls, attribution)
}

val TILE_SOURCES = listOf(
    TileSourceDef("OSM", arrayOf("https://tile.openstreetmap.org/"), 19, "© участники OpenStreetMap", "https://tile.openstreetmap.org/15/24828/10203.png"),
    TileSourceDef("OSMDE", arrayOf("https://tile.openstreetmap.de/"), 18, "© участники OpenStreetMap · сервер openstreetmap.de", "https://tile.openstreetmap.de/15/24828/10203.png"),
    TileSourceDef("OSMFR", arrayOf("https://a.tile.openstreetmap.fr/osmfr/"), 19, "© участники OpenStreetMap · сервер OSM France", "https://a.tile.openstreetmap.fr/osmfr/15/24828/10203.png"),
)

/** Built-in map of Krasnoyarsk (assets/snapshots), shown when no tile server is usable. */
data class Snapshot(val asset: String, val north: Double, val south: Double, val west: Double, val east: Double)

val SNAPSHOTS = listOf(
    Snapshot("snapshots/city.jpg", 56.12106042504408, 55.94919982336745, 92.6806640625, 93.1201171875),
    Snapshot("snapshots/campus.jpg", 56.02294807962744, 55.979945357882315, 92.735595703125, 92.83447265625),
)

/**
 * The OSM stub has a yellow-black stripe; real tiles have almost no saturated yellow or pure black.
 * [argb] are pixels of a 128×128 downscale.
 */
fun isBlockedPixels(argb: IntArray): Boolean {
    var black = 0
    var yellow = 0
    for (p in argb) {
        val r = (p shr 16) and 0xff
        val g = (p shr 8) and 0xff
        val b = p and 0xff
        if (r < 45 && g < 45 && b < 45) black++
        else if (r > 150 && g > 150 && b < 80 && abs(r - g) < 50) yellow++
    }
    return black > 250 && yellow > 150
}

fun isBlockedTile(bmp: Bitmap): Boolean {
    val s = Bitmap.createScaledBitmap(bmp, 128, 128, false)
    val px = IntArray(128 * 128)
    s.getPixels(px, 0, 128, 0, 0, 128, 128)
    return isBlockedPixels(px)
}

/** First source whose probe tile is a real 256 px tile; null → built-in snapshot mode. */
suspend fun pickTileSource(http: OkHttpClient, sources: List<TileSourceDef> = TILE_SOURCES): TileSourceDef? = withContext(Dispatchers.IO) {
    sources.firstOrNull { s ->
        runCatching {
            http.newCall(Request.Builder().url(s.probe + "?probe=" + System.currentTimeMillis().toString(36)).build()).execute().use { r ->
                if (!r.isSuccessful) return@use false
                val bmp = BitmapFactory.decodeStream(r.body.byteStream()) ?: return@use false
                bmp.width >= 256 && !isBlockedTile(bmp)
            }
        }.getOrDefault(false)
    }
}
