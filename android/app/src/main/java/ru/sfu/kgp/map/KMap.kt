package ru.sfu.kgp.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.res.ResourcesCompat
import androidx.core.graphics.createBitmap
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.HeatmapLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import org.maplibre.geojson.Polygon
import ru.sfu.kgp.R
import ru.sfu.kgp.domain.Category
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.HomeArea
import ru.sfu.kgp.domain.Status
import ru.sfu.kgp.ui.theme.LocalKgp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

enum class MapMode { PENDING, LIVE, SNAPSHOT }

/** Point in the app's terms (independent of the map library). */
data class GeoPoint(val latitude: Double, val longitude: Double)

/**
 * MapLibre Native draws the map with OpenGL, which Robolectric cannot load: under unit tests the maps are replaced
 * by a plain placeholder (the screens around them are still tested).
 */
val mapsSupported: Boolean = Build.FINGERPRINT != "robolectric"

/** Handle for the screens: zoom buttons and "fly to". Zoom levels are the usual 256-px (OSM/Leaflet) ones. */
class KMap internal constructor(private val m: MapLibreMap?) {
    val controller = Controller()
    val center: GeoPoint? get() = m?.cameraPosition?.target?.let { GeoPoint(it.latitude, it.longitude) }

    inner class Controller {
        fun zoomIn() = m?.animateCamera(CameraUpdateFactory.zoomIn(), 250)
        fun zoomOut() = m?.animateCamera(CameraUpdateFactory.zoomOut(), 250)
        fun animateTo(p: GeoPoint, zoom: Double, ms: Long) =
            m?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(p.latitude, p.longitude), zoom - 1), ms.toInt())
    }
}

// ---------- base map choice: vector → raster chain → built-in snapshot ----------

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

object VectorChoice {
    @Volatile private var ok: Boolean? = null

    suspend fun reachable(http: OkHttpClient): Boolean {
        ok?.let { return it }
        val r = withContext(Dispatchers.IO) {
            runCatching {
                http.newCall(Request.Builder().url(VECTOR_TILEJSON).build()).execute().use { it.isSuccessful && it.body.string().contains("\"tiles\"") }
            }.getOrDefault(false)
        }
        ok = r
        return r
    }

    fun failed() {
        ok = false
    }
}

private suspend fun chooseStyle(http: OkHttpClient, dark: Boolean): Triple<String, MapMode, Double> {
    if (VectorChoice.reachable(http)) return Triple(vectorStyleJson(dark), MapMode.LIVE, 19.0)
    val src = TileChoice.get(http)
    return if (src != null) Triple(rasterStyleJson(src, dark), MapMode.LIVE, src.maxZoom - 1.0)
    else Triple(snapshotStyleJson(dark), MapMode.SNAPSHOT, 17.0)
}

// ---------- pins and clusters (sticker style: ink outline, hard shadow) ----------

private const val INK = 0xFF141414.toInt()
private val bitmaps = HashMap<String, Bitmap>()

/** Upright sticker pin: a circle in the category colour with an ink outline, a hard shadow and a white glyph. */
fun pinBitmap(context: Context, cat: Category, resolved: Boolean, selected: Boolean): Bitmap = bitmaps.getOrPut("pin|${cat.id}|$resolved|$selected") {
    val d = context.resources.displayMetrics.density
    val s = if (selected) 1.2f else 1f
    val r = 17 * d * s
    val sh = 3 * d
    val w = (2 * r + sh + 4 * d).toInt()
    val h = (2 * r + 12 * d * s + sh + 4 * d).toInt()
    val b = createBitmap(w, h)
    val cv = Canvas(b)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    val cx = 2 * d + r
    val cy = 2 * d + r
    fun shape(dx: Float, dy: Float) = Path().apply {
        addCircle(cx + dx, cy + dy, r, Path.Direction.CW)
        moveTo(cx - r * 0.55f + dx, cy + r * 0.7f + dy)
        lineTo(cx + dx, cy + r + 11 * d * s + dy)
        lineTo(cx + r * 0.55f + dx, cy + r * 0.7f + dy)
        close()
    }
    p.color = INK
    cv.drawPath(shape(sh, sh), p)
    p.color = if (resolved) Color.parseColor("#2e7d4f") else runCatching { Color.parseColor(cat.color) }.getOrDefault(Color.GRAY)
    cv.drawPath(shape(0f, 0f), p)
    p.style = Paint.Style.STROKE
    p.strokeWidth = 2.5f * d
    p.color = INK
    cv.drawPath(shape(0f, 0f), p)
    if (selected) {
        p.color = Color.parseColor("#c6f24e")
        p.strokeWidth = 3 * d
        cv.drawCircle(cx, cy, r - 3 * d, p)
    }
    p.style = Paint.Style.FILL
    p.typeface = ResourcesCompat.getFont(context, R.font.symbols_fill) ?: Typeface.DEFAULT
    p.textSize = 19 * d * s
    p.textAlign = Paint.Align.CENTER
    p.color = Color.WHITE
    val fm = p.fontMetrics
    cv.drawText(if (resolved) "check" else cat.icon, cx, cy - (fm.ascent + fm.descent) / 2, p)
    b
}

/** Cluster: a tilted lime square with the count (as on the site). */
fun clusterBitmap(context: Context, n: Int): Bitmap = bitmaps.getOrPut("cl|$n") {
    val d = context.resources.displayMetrics.density
    val size = (if (n < 10) 40 else if (n < 50) 46 else 54) * d
    val sh = 3 * d
    val b = createBitmap((size + sh + 6 * d).toInt(), (size + sh + 6 * d).toInt())
    val cv = Canvas(b)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    cv.rotate(-6f, b.width / 2f, b.height / 2f)
    val rect = RectF(3 * d, 3 * d, 3 * d + size, 3 * d + size)
    p.color = INK
    cv.drawRoundRect(RectF(rect.left + sh, rect.top + sh, rect.right + sh, rect.bottom + sh), 12 * d, 12 * d, p)
    p.color = Color.parseColor("#c6f24e")
    cv.drawRoundRect(rect, 12 * d, 12 * d, p)
    p.style = Paint.Style.STROKE
    p.strokeWidth = 2.5f * d
    p.color = INK
    cv.drawRoundRect(rect, 12 * d, 12 * d, p)
    p.style = Paint.Style.FILL
    p.typeface = Typeface.DEFAULT_BOLD
    p.textSize = 15 * d
    p.textAlign = Paint.Align.CENTER
    cv.drawText(n.toString(), rect.centerX(), rect.centerY() - (p.fontMetrics.ascent + p.fontMetrics.descent) / 2, p)
    b
}

private fun Style.image(name: String, make: () -> Bitmap): String {
    if (getImage(name) == null) addImage(name, make())
    return name
}

// ---------- overlays: pins, heatmap, home area ----------

private fun installOverlays(style: Style) {
    if (style.getSource("home") == null) style.addSource(GeoJsonSource("home"))
    if (style.getSource("heat-src") == null) style.addSource(GeoJsonSource("heat-src"))
    if (style.getSource("pins") == null) style.addSource(GeoJsonSource("pins"))
    if (style.getLayer("home-fill") == null) style.addLayer(FillLayer("home-fill", "home").withProperties(PropertyFactory.fillColor("#c6f24e"), PropertyFactory.fillOpacity(0.18f)))
    if (style.getLayer("home-line") == null) style.addLayer(
        LineLayer("home-line", "home").withProperties(PropertyFactory.lineColor("#141414"), PropertyFactory.lineWidth(2f), PropertyFactory.lineDasharray(arrayOf(3f, 2f))),
    )
    if (style.getLayer("heat") == null) style.addLayer(
        HeatmapLayer("heat", "heat-src").withProperties(
            PropertyFactory.heatmapWeight(Expression.get("w")),
            PropertyFactory.heatmapRadius(Expression.interpolate(Expression.linear(), Expression.zoom(), Expression.stop(9, 14), Expression.stop(15, 42))),
            PropertyFactory.heatmapOpacity(0.85f),
            PropertyFactory.heatmapColor(
                Expression.interpolate(
                    Expression.linear(), Expression.heatmapDensity(),
                    Expression.stop(0, Expression.rgba(0, 0, 0, 0)),
                    Expression.stop(0.3, Expression.rgb(47, 182, 191)),
                    Expression.stop(0.55, Expression.rgb(242, 179, 61)),
                    Expression.stop(0.8, Expression.rgb(240, 97, 28)),
                    Expression.stop(1, Expression.rgb(179, 38, 30)),
                ),
            ),
            PropertyFactory.visibility(Property.NONE),
        ),
    )
    if (style.getLayer("pins") == null) style.addLayer(
        SymbolLayer("pins", "pins").withProperties(
            PropertyFactory.iconImage(Expression.get("icon")),
            PropertyFactory.iconAnchor(Expression.get("anchor")),
            PropertyFactory.iconAllowOverlap(true),
            PropertyFactory.iconIgnorePlacement(true),
            PropertyFactory.symbolSortKey(Expression.get("z")),
        ),
    )
}

private fun setHome(style: Style, home: HomeArea?) {
    val src = style.getSourceAs<GeoJsonSource>("home") ?: return
    val fc = if (home == null) FeatureCollection.fromFeatures(emptyList())
    else FeatureCollection.fromFeature(Feature.fromGeometry(circle(home.lat, home.lng, home.radius.toDouble())))
    src.setGeoJson(fc)
}

/** Circle as a 64-gon (metres → degrees; precise enough for a few kilometres). */
private fun circle(lat: Double, lng: Double, r: Double, steps: Int = 64): Polygon {
    val pts = (0..steps).map { i ->
        val a = 2 * PI * i / steps
        Point.fromLngLat(lng + r / (111_320.0 * cos(Math.toRadians(lat))) * sin(a), lat + r / 111_320.0 * cos(a))
    }
    return Polygon.fromLngLats(listOf(pts))
}

/**
 * Ф-01 clustering: pins are grouped by a 56-dp screen grid below street level, a tap on a cluster zooms in.
 * The heatmap replaces pins when switched on.
 */
private fun drawPins(context: Context, map: MapLibreMap, style: Style, list: List<Complaint>, cat: (String) -> Category, selected: String?, heat: Boolean) {
    val pins = style.getSourceAs<GeoJsonSource>("pins") ?: return
    style.getLayer("heat")?.setProperties(PropertyFactory.visibility(if (heat) Property.VISIBLE else Property.NONE))
    style.getSourceAs<GeoJsonSource>("heat-src")?.setGeoJson(
        FeatureCollection.fromFeatures(list.map { c -> Feature.fromGeometry(Point.fromLngLat(c.lng, c.lat)).also { it.addNumberProperty("w", 0.4 + minOf(c.supports, 30) / 30.0) } }),
    )
    if (heat) {
        pins.setGeoJson(FeatureCollection.fromFeatures(emptyList()))
        return
    }
    fun pin(c: Complaint): Feature {
        val k = cat(c.category)
        val sel = c.id == selected
        val name = style.image("pin-${k.id}-${c.status == Status.RESOLVED}-$sel") { pinBitmap(context, k, c.status == Status.RESOLVED, sel) }
        return Feature.fromGeometry(Point.fromLngLat(c.lng, c.lat)).apply {
            addStringProperty("icon", name)
            addStringProperty("anchor", "bottom")
            addStringProperty("id", c.id)
            addBooleanProperty("cluster", false)
            addNumberProperty("z", if (sel) 2 else 1)
        }
    }
    val features = if (map.cameraPosition.zoom >= 15 || list.size < 2) list.map(::pin) else {
        val cell = 56 * context.resources.displayMetrics.density
        list.groupBy { c ->
            val pt = map.projection.toScreenLocation(LatLng(c.lat, c.lng))
            floor(pt.x / cell).toInt() to floor(pt.y / cell).toInt()
        }.values.map { g ->
            if (g.size == 1) pin(g[0]) else Feature.fromGeometry(Point.fromLngLat(g.sumOf { it.lng } / g.size, g.sumOf { it.lat } / g.size)).apply {
                addStringProperty("icon", style.image("cl-${g.size}") { clusterBitmap(context, g.size) })
                addStringProperty("anchor", "center")
                addBooleanProperty("cluster", true)
                addNumberProperty("z", 0)
            }
        }
    }
    pins.setGeoJson(FeatureCollection.fromFeatures(features))
}

// ---------- compose hosting ----------

@Composable
private fun rememberMapView(): MapView {
    val context = LocalContext.current
    val mv = remember { MapView(context).also { it.onCreate(null) } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, mv) {
        var started = false
        var resumed = false
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> if (!started) { mv.onStart(); started = true }
                Lifecycle.Event.ON_RESUME -> if (!resumed) { mv.onResume(); resumed = true }
                Lifecycle.Event.ON_PAUSE -> if (resumed) { mv.onPause(); resumed = false }
                Lifecycle.Event.ON_STOP -> if (started) { mv.onStop(); started = false }
                else -> Unit
            }
        }
        lifecycle.addObserver(obs)
        onDispose {
            lifecycle.removeObserver(obs)
            if (resumed) mv.onPause()
            if (started) mv.onStop()
            mv.onDestroy()
        }
    }
    return mv
}

private fun MapLibreMap.basics(interactive: Boolean) {
    uiSettings.isRotateGesturesEnabled = false
    uiSettings.isTiltGesturesEnabled = false
    uiSettings.isCompassEnabled = false
    uiSettings.isLogoEnabled = false
    uiSettings.isAttributionEnabled = false
    if (!interactive) uiSettings.setAllGesturesEnabled(false)
    setMinZoomPreference(2.0)
}

/** Loads the base style (vector → raster → snapshot) and re-adds the overlays; the vector style falls back on errors. */
@Composable
private fun BaseStyle(mv: MapView, map: MapLibreMap?, http: OkHttpClient, dark: Boolean, onMode: (MapMode) -> Unit, onStyle: (Style) -> Unit) {
    var attempt by remember { mutableStateOf(0) }
    val mode by rememberUpdatedState(onMode)
    val loaded by rememberUpdatedState(onStyle)
    LaunchedEffect(mv) {
        mv.addOnDidFailLoadingMapListener {
            VectorChoice.failed()
            attempt++
        }
    }
    LaunchedEffect(map, dark, attempt) {
        val m = map ?: return@LaunchedEffect
        mode(MapMode.PENDING)
        val (json, md, maxZoom) = chooseStyle(http, dark)
        m.setMaxZoomPreference(maxZoom)
        m.setStyle(Style.Builder().fromJson(json)) { st ->
            installOverlays(st)
            loaded(st)
            mode(md)
        }
    }
}

/** Main map with pins; [onReady] gives the handle for zoom / locate buttons. */
@Composable
fun ComplaintsMap(
    complaints: List<Complaint>,
    cat: (String) -> Category,
    selected: String?,
    http: OkHttpClient,
    onSelect: (String?) -> Unit,
    onMode: (MapMode) -> Unit,
    onReady: (KMap) -> Unit,
    modifier: Modifier = Modifier,
    heat: Boolean = false,
    home: HomeArea? = null,
) {
    val dark = LocalKgp.current.dark
    if (!mapsSupported) {
        Box(modifier.background(androidx.compose.ui.graphics.Color(if (dark) 0xFF17161C else 0xFFF1EBDD)))
        LaunchedEffect(Unit) { onReady(KMap(null)); onMode(MapMode.SNAPSHOT) }
        return
    }
    val context = LocalContext.current
    val mv = rememberMapView()
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var style by remember { mutableStateOf<Style?>(null) }
    val select by rememberUpdatedState(onSelect)
    val data = rememberUpdatedState(Triple(complaints, selected, heat))
    val catFn by rememberUpdatedState(cat)
    LaunchedEffect(mv) {
        mv.getMapAsync { m ->
            m.basics(interactive = true)
            m.cameraPosition = CameraPosition.Builder().target(LatLng(56.0005, 92.7820)).zoom(14.0).build()
            m.addOnCameraIdleListener {
                val st = m.style ?: return@addOnCameraIdleListener
                val (l, s, h) = data.value
                drawPins(context, m, st, l, catFn, s, h)
            }
            m.addOnMapClickListener { ll ->
                val pt: PointF = m.projection.toScreenLocation(ll)
                val r = 14 * context.resources.displayMetrics.density
                val f = m.queryRenderedFeatures(RectF(pt.x - r, pt.y - r, pt.x + r, pt.y + r), "pins").firstOrNull()
                when {
                    f == null -> select(null)
                    f.getBooleanProperty("cluster") == true -> {
                        val g = f.geometry() as? Point
                        if (g != null) m.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(g.latitude(), g.longitude()), minOf(m.cameraPosition.zoom + 2, 16.0)), 300)
                    }
                    else -> select(f.getStringProperty("id"))
                }
                f != null
            }
            map = m
            onReady(KMap(m))
        }
    }
    BaseStyle(mv, map, http, dark, onMode) { style = it }
    val fitted = remember { booleanArrayOf(false) }
    LaunchedEffect(map, style, complaints, selected, heat, home) {
        val m = map ?: return@LaunchedEffect
        val st = style ?: return@LaunchedEffect
        if (!fitted[0] && complaints.size > 1) {
            fitted[0] = true
            val b = LatLngBounds.Builder().includes(complaints.map { LatLng(it.lat, it.lng) }).build()
            runCatching { m.moveCamera(CameraUpdateFactory.newLatLngBounds(b, (60 * context.resources.displayMetrics.density).toInt())) }
            if (m.cameraPosition.zoom > 15) m.moveCamera(CameraUpdateFactory.zoomTo(15.0))
        }
        setHome(st, home)
        drawPins(context, m, st, complaints, cat, selected, heat)
    }
    AndroidView(factory = { mv }, modifier = modifier)
}

/** Wizard step 2 and "Мой район": the map moves under a fixed centre pin; [onCenter] fires after each move. */
@Composable
fun PlacePickerMap(start: GeoPoint, http: OkHttpClient, onCenter: (Double, Double) -> Unit, onReady: (KMap) -> Unit, modifier: Modifier = Modifier) {
    val dark = LocalKgp.current.dark
    if (!mapsSupported) {
        Box(modifier.background(androidx.compose.ui.graphics.Color(0xFFF1EBDD)))
        LaunchedEffect(Unit) { onReady(KMap(null)) }
        return
    }
    val mv = rememberMapView()
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    val cb by rememberUpdatedState(onCenter)
    LaunchedEffect(mv) {
        mv.getMapAsync { m ->
            m.basics(interactive = true)
            m.cameraPosition = CameraPosition.Builder().target(LatLng(start.latitude, start.longitude)).zoom(16.0).build()
            m.addOnCameraIdleListener { m.cameraPosition.target?.let { cb(it.latitude, it.longitude) } }
            map = m
            onReady(KMap(m))
        }
    }
    BaseStyle(mv, map, http, dark, onMode = {}) {}
    AndroidView(factory = { mv }, modifier = modifier)
}

/** Static map in the complaint card. */
@Composable
fun MiniMap(c: Complaint, cat: Category, http: OkHttpClient, modifier: Modifier = Modifier) {
    val dark = LocalKgp.current.dark
    if (!mapsSupported) {
        Box(modifier.background(androidx.compose.ui.graphics.Color(if (dark) 0xFF17161C else 0xFFF1EBDD)))
        return
    }
    val context = LocalContext.current
    val mv = rememberMapView()
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    LaunchedEffect(mv) {
        mv.getMapAsync { m ->
            m.basics(interactive = false)
            m.cameraPosition = CameraPosition.Builder().target(LatLng(c.lat, c.lng)).zoom(15.0).build()
            map = m
        }
    }
    BaseStyle(mv, map, http, dark, onMode = {}) { st ->
        val k = cat
        val name = st.image("pin-${k.id}-${c.status == Status.RESOLVED}-true") { pinBitmap(context, k, c.status == Status.RESOLVED, true) }
        st.getSourceAs<GeoJsonSource>("pins")?.setGeoJson(
            FeatureCollection.fromFeature(Feature.fromGeometry(Point.fromLngLat(c.lng, c.lat)).apply {
                addStringProperty("icon", name)
                addStringProperty("anchor", "bottom")
                addNumberProperty("z", 1)
            }),
        )
    }
    AndroidView(factory = { mv }, modifier = modifier)
}
