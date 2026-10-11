package ru.sfu.kgp.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.BitmapDrawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.res.ResourcesCompat
import androidx.core.graphics.createBitmap
import okhttp3.OkHttpClient
import org.osmdroid.events.DelayedMapListener
import org.osmdroid.events.MapListener
import org.osmdroid.events.ScrollEvent
import org.osmdroid.events.ZoomEvent
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.GroundOverlay
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.events.MapEventsReceiver
import androidx.compose.runtime.getValue
import org.osmdroid.views.overlay.Marker

import ru.sfu.kgp.R
import ru.sfu.kgp.domain.Category
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.Status
import kotlin.math.floor

enum class MapMode { PENDING, LIVE, SNAPSHOT }

/** One probe per process, like pickTileSource() on the site. */
object TileChoice {
    @Volatile private var chosen: Result<TileSourceDef?>? = null
    suspend fun get(http: OkHttpClient): TileSourceDef? {
        chosen?.let { return it.getOrNull() }
        val r = runCatching { pickTileSource(http) }
        chosen = r
        return r.getOrNull()
    }
}

private val CITY_BOUNDS = BoundingBox(56.14, 93.20, 55.90, 92.60)

/** Applies the live tile source or the built-in Krasnoyarsk snapshot (never the "Access blocked" stub). */
suspend fun applyBase(map: MapView, http: OkHttpClient, onMode: (MapMode) -> Unit) {
    onMode(MapMode.PENDING)
    val src = TileChoice.get(http)
    if (src != null) {
        map.setTileSource(src.toOsmdroid())
        map.maxZoomLevel = src.maxZoom.toDouble()
        onMode(MapMode.LIVE)
    } else {
        map.setUseDataConnection(false)
        addSnapshots(map)
        map.setScrollableAreaLimitDouble(CITY_BOUNDS)
        map.minZoomLevel = 11.0
        map.maxZoomLevel = 18.0
        onMode(MapMode.SNAPSHOT)
    }
    map.invalidate()
}

private val snapshotBitmaps = HashMap<String, Bitmap>()

fun addSnapshots(map: MapView) {
    SNAPSHOTS.forEach { s ->
        val bmp = snapshotBitmaps.getOrPut(s.asset) { map.context.assets.open(s.asset).use { BitmapFactory.decodeStream(it) } }
        map.overlays.add(0, GroundOverlay().apply {
            image = bmp
            setPosition(GeoPoint(s.north, s.west), GeoPoint(s.south, s.east))
        })
    }
}

fun newMapView(context: Context, interactive: Boolean = true): MapView = MapView(context).apply {
    setTilesScaledToDpi(true)
    zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
    setMultiTouchControls(interactive)
    isClickable = interactive
    minZoomLevel = 3.0
    if (!interactive) setOnTouchListener { _, _ -> true }
}

// ---------- pins ----------

private val pinCache = HashMap<String, Bitmap>()

/** The prototype's pin: rotated drop in the category colour with a white border, glyph and support count. */
fun pinBitmap(context: Context, cat: Category, c: Complaint, selected: Boolean): Bitmap {
    val resolved = c.status == Status.RESOLVED
    val key = "${cat.id}|$resolved|$selected|${if (c.supports >= 10) c.supports else 0}"
    return pinCache.getOrPut(key) {
        val d = context.resources.displayMetrics.density
        val scale = if (selected) 1.18f else 1f
        val size = (36 * d * scale)
        val w = (size + 16 * d).toInt()
        val h = (size + 12 * d).toInt()
        val b = createBitmap(w, h)
        val cv = Canvas(b)
        val col = if (resolved) Color.parseColor("#2e7d4f") else runCatching { Color.parseColor(cat.color) }.getOrDefault(Color.GRAY)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val top = 6 * d
        cv.save()
        cv.rotate(-45f, size / 2, top + size / 2)
        val r = RectF(0f, top, size, top + size)
        val path = Path().apply {
            addRoundRect(r, floatArrayOf(size / 2, size / 2, size / 2, size / 2, size / 2, size / 2, 4 * d, 4 * d), Path.Direction.CW)
        }
        p.color = Color.argb(90, 0, 0, 0)
        cv.translate(0f, 2 * d)
        cv.drawPath(path, p)
        cv.translate(0f, -2 * d)
        p.color = col
        cv.drawPath(path, p)
        p.style = Paint.Style.STROKE
        p.strokeWidth = 2 * d
        p.color = Color.WHITE
        cv.drawPath(path, p)
        cv.restore()
        p.style = Paint.Style.FILL
        p.typeface = ResourcesCompat.getFont(context, R.font.symbols_fill) ?: Typeface.DEFAULT
        p.textSize = 19 * d * scale
        p.textAlign = Paint.Align.CENTER
        p.color = Color.WHITE
        val glyph = if (resolved) "check" else cat.icon
        val fm = p.fontMetrics
        cv.drawText(glyph, size / 2, top + size / 2 - (fm.ascent + fm.descent) / 2, p)
        if (c.supports >= 10) {
            p.typeface = Typeface.DEFAULT_BOLD
            p.textSize = 10 * d
            val txt = c.supports.toString()
            val tw = maxOf(p.measureText(txt) + 8 * d, 16 * d)
            val bx = size - 6 * d
            p.color = Color.WHITE
            cv.drawRoundRect(RectF(bx, 0f, bx + tw, 14 * d), 7 * d, 7 * d, p)
            p.color = Color.parseColor("#10201f")
            cv.drawText(txt, bx + tw / 2, 11 * d, p)
        }
        b
    }
}

fun clusterBitmap(context: Context, n: Int, primary: Int, ring: Int): Bitmap {
    val d = context.resources.displayMetrics.density
    val size = ((if (n < 10) 40 else if (n < 50) 46 else 54) * d).toInt()
    val b = createBitmap(size, size)
    val cv = Canvas(b)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    p.color = ring
    cv.drawCircle(size / 2f, size / 2f, size / 2f, p)
    p.color = primary
    cv.drawCircle(size / 2f, size / 2f, size / 2f - 3 * d, p)
    p.color = Color.WHITE
    p.typeface = Typeface.DEFAULT_BOLD
    p.textSize = 14 * d
    p.textAlign = Paint.Align.CENTER
    cv.drawText(n.toString(), size / 2f, size / 2f - (p.fontMetrics.ascent + p.fontMetrics.descent) / 2, p)
    return b
}

/**
 * Ф-01 clustering: pins are grouped by a screen grid when zoomed out (below street level 16),
 * a tap on a cluster zooms in on it.
 */
fun drawPins(map: MapView, list: List<Complaint>, cat: (String) -> Category, selected: String?, primary: Int, ring: Int, onSelect: (String) -> Unit) {
    map.overlays.removeAll { it is Marker }
    val ctx = map.context
    val zoom = map.zoomLevelDouble
    if (zoom >= 16 || list.size < 2) {
        list.forEach { c -> map.overlays.add(pin(map, c, cat(c.category), selected == c.id, onSelect)) }
    } else {
        val proj = map.projection
        val cell = 56 * ctx.resources.displayMetrics.density
        val groups = list.groupBy { c ->
            val pt = proj.toPixels(GeoPoint(c.lat, c.lng), null)
            floor(pt.x / cell).toInt() to floor(pt.y / cell).toInt()
        }
        groups.values.forEach { g ->
            if (g.size == 1) map.overlays.add(pin(map, g[0], cat(g[0].category), selected == g[0].id, onSelect))
            else map.overlays.add(Marker(map).apply {
                position = GeoPoint(g.sumOf { it.lat } / g.size, g.sumOf { it.lng } / g.size)
                icon = BitmapDrawable(ctx.resources, clusterBitmap(ctx, g.size, primary, ring))
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                title = "${g.size} обращений"
                setInfoWindow(null)
                setOnMarkerClickListener { m, mv ->
                    mv.controller.animateTo(m.position, minOf(mv.zoomLevelDouble + 2, 17.0), 300L)
                    true
                }
            })
        }
    }
    map.invalidate()
}

private fun pin(map: MapView, c: Complaint, cat: Category, selected: Boolean, onSelect: (String) -> Unit) = Marker(map).apply {
    position = GeoPoint(c.lat, c.lng)
    icon = BitmapDrawable(map.context.resources, pinBitmap(map.context, cat, c, selected))
    setAnchor(0.15f, 0.95f)
    title = c.title
    setInfoWindow(null)
    setPanToView(false)
    setOnMarkerClickListener { _, _ -> onSelect(c.id); true }
}

/** Main map with pins; [onReady] gives the MapView for zoom / locate buttons. */
@Composable
fun ComplaintsMap(
    complaints: List<Complaint>,
    cat: (String) -> Category,
    selected: String?,
    http: OkHttpClient,
    primary: Int,
    ring: Int,
    onSelect: (String?) -> Unit,
    onMode: (MapMode) -> Unit,
    onReady: (MapView) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val map = remember { newMapView(context).apply { controller.setZoom(15.0); controller.setCenter(GeoPoint(56.0005, 92.7820)) } }
    val select by rememberUpdatedState(onSelect)
    val data = rememberUpdatedState(Triple(complaints, selected, cat))
    LaunchedEffect(map) {
        map.overlays.add(MapEventsOverlay(object : MapEventsReceiver {
            override fun singleTapConfirmedHelper(p: GeoPoint?): Boolean { select(null); return false }
            override fun longPressHelper(p: GeoPoint?) = false
        }))
        map.addMapListener(DelayedMapListener(object : MapListener {
            override fun onScroll(event: ScrollEvent?) = false
            override fun onZoom(event: ZoomEvent?): Boolean {
                val (l, s, k) = data.value
                drawPins(map, l, k, s, primary, ring) { select(it) }
                return false
            }
        }, 150))
        onReady(map)
        applyBase(map, http, onMode)
    }
    val fitted = remember { booleanArrayOf(false) }
    LaunchedEffect(complaints, selected) {
        if (!fitted[0] && complaints.isNotEmpty()) {
            fitted[0] = true
            val box = BoundingBox.fromGeoPoints(complaints.map { GeoPoint(it.lat, it.lng) })
            map.post { runCatching { map.zoomToBoundingBox(box.increaseByScale(1.3f), false, 60, 16.0, null) } }
        }
        map.post { drawPins(map, complaints, cat, selected, primary, ring) { select(it) } }
    }
    DisposableEffect(map) {
        map.onResume()
        onDispose { map.onPause(); map.onDetach() }
    }
    AndroidView(factory = { map }, modifier = modifier)
}

/** Wizard step 2: the map moves under a fixed centre pin; [onCenter] fires after each move. */
@Composable
fun PlacePickerMap(start: GeoPoint, http: OkHttpClient, onCenter: (Double, Double) -> Unit, onReady: (MapView) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val map = remember { newMapView(context).apply { controller.setZoom(17.0); controller.setCenter(start) } }
    val cb by rememberUpdatedState(onCenter)
    LaunchedEffect(map) {
        map.addMapListener(DelayedMapListener(object : MapListener {
            override fun onScroll(event: ScrollEvent?): Boolean { val c = map.mapCenter; cb(c.latitude, c.longitude); return false }
            override fun onZoom(event: ZoomEvent?): Boolean { val c = map.mapCenter; cb(c.latitude, c.longitude); return false }
        }, 400))
        onReady(map)
        applyBase(map, http) { }
    }
    DisposableEffect(map) {
        map.onResume()
        onDispose { map.onPause(); map.onDetach() }
    }
    AndroidView(factory = { map }, modifier = modifier)
}

/** Static mini map in the complaint card. */
@Composable
fun MiniMap(c: Complaint, cat: Category, http: OkHttpClient, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val map = remember(c.id) {
        newMapView(context, interactive = false).apply {
            controller.setZoom(16.0)
            controller.setCenter(GeoPoint(c.lat, c.lng))
            overlays.add(Marker(this).apply {
                position = GeoPoint(c.lat, c.lng)
                icon = BitmapDrawable(context.resources, pinBitmap(context, cat, c, true))
                setAnchor(0.15f, 0.95f)
                setInfoWindow(null)
            })
        }
    }
    LaunchedEffect(map) { applyBase(map, http) { } }
    DisposableEffect(map) {
        map.onResume()
        onDispose { map.onPause(); map.onDetach() }
    }
    AndroidView(factory = { map }, modifier = modifier)
}
