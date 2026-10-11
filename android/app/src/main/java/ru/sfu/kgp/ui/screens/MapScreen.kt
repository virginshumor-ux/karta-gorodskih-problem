package ru.sfu.kgp.ui.screens

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.Krsk
import ru.sfu.kgp.domain.StatusFilter
import ru.sfu.kgp.domain.Wmo
import ru.sfu.kgp.domain.fmtDate
import ru.sfu.kgp.domain.iceRisk
import ru.sfu.kgp.domain.plural
import ru.sfu.kgp.map.ComplaintsMap
import ru.sfu.kgp.map.MapMode
import ru.sfu.kgp.ui.BtnKind
import ru.sfu.kgp.ui.IconBtn
import ru.sfu.kgp.ui.KBtn
import ru.sfu.kgp.ui.KChip
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.StatusChip
import ru.sfu.kgp.ui.Sym
import ru.sfu.kgp.ui.Thumb
import ru.sfu.kgp.ui.UiState
import ru.sfu.kgp.ui.theme.LocalKgp
import kotlin.math.roundToInt

@SuppressLint("MissingPermission")
fun lastKnownLocation(context: Context): Location? {
    val lm = context.getSystemService(LocationManager::class.java) ?: return null
    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!granted) return null
    return listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
        .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
        .maxByOrNull { it.time }
}

/** One fresh fix through LocationManager (no Google Play services needed). */
@SuppressLint("MissingPermission")
fun requestLocation(context: Context, onResult: (Location?) -> Unit) {
    val lm = context.getSystemService(LocationManager::class.java)
    val provider = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).firstOrNull { runCatching { lm?.isProviderEnabled(it) }.getOrDefault(false) == true }
    if (lm == null || provider == null) return onResult(lastKnownLocation(context))
    var done = false
    val listener = object : android.location.LocationListener {
        override fun onLocationChanged(l: Location) {
            if (!done) { done = true; lm.removeUpdates(this); onResult(l) }
        }
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(p: String?, s: Int, e: android.os.Bundle?) = Unit
        override fun onProviderDisabled(p: String) = Unit
        override fun onProviderEnabled(p: String) = Unit
    }
    runCatching { lm.requestLocationUpdates(provider, 0L, 0f, listener, android.os.Looper.getMainLooper()) }.onFailure { return onResult(lastKnownLocation(context)) }
    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        if (!done) { done = true; lm.removeUpdates(listener); onResult(lastKnownLocation(context)) }
    }, 8000)
}

@Composable
fun MapScreen(s: UiState, vm: MainViewModel, http: OkHttpClient, onOpen: (String) -> Unit, onList: () -> Unit, onWeather: () -> Unit) {
    val k = LocalKgp.current
    val context = LocalContext.current
    var mapView by remember { mutableStateOf<MapView?>(null) }
    val visible = s.visible
    val locate = {
        requestLocation(context) { l ->
            if (l != null) mapView?.controller?.animateTo(GeoPoint(l.latitude, l.longitude), 16.0, 400L)
            else {
                vm.toast("Не удалось определить местоположение — показываем район СФУ")
                mapView?.controller?.animateTo(GeoPoint(Krsk.CAMPUS_LAT, Krsk.CAMPUS_LNG), Krsk.CAMPUS_ZOOM, 400L)
            }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        if (r.values.any { it }) locate() else vm.toast("Геолокация недоступна — передвиньте карту вручную")
    }
    Box(Modifier.fillMaxSize().background(k.surface2)) {
        ComplaintsMap(
            complaints = visible, cat = s::cat, selected = s.selected, http = http,
            primary = k.primary.toArgb(), ring = k.surface.toArgb(),
            onSelect = vm::select, onMode = vm::setMapMode, onReady = { mapView = it },
            modifier = Modifier.fillMaxSize().semantics { contentDescription = "Карта обращений: ${visible.size}" },
        )
        Column(Modifier.statusBarsPadding().padding(top = 10.dp)) {
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    Modifier.weight(1f).shadow(4.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp)).background(k.surface)
                        .clickable(onClickLabel = "Открыть список обращений", role = Role.Button, onClick = onList).padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(k.primary), contentAlignment = Alignment.Center) {
                        Sym("location_on", color = k.onPrimary, fill = true)
                    }
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text("Карта городских проблем", fontFamily = ru.sfu.kgp.ui.theme.Unbounded, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = k.fg)
                        Text("${Krsk.NAME} · ${visible.size} ${plural(visible.size, "обращение", "обращения", "обращений")}", fontSize = 12.sp, color = k.fg2, maxLines = 1)
                    }
                }
                s.weather?.data?.let { w ->
                    val t = w.current.temperature.roundToInt()
                    Row(
                        Modifier.heightIn(min = 52.dp).shadow(4.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp)).background(k.surface)
                            .clickable(onClickLabel = "Погода в Красноярске: $t градусов, ${Wmo.text(w.current.code)}", onClick = onWeather).padding(horizontal = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Sym(Wmo.icon(w.current.code, w.current.isDay == 1), size = 30.sp, color = k.primary)
                        Spacer(Modifier.width(6.dp))
                        Text("${if (t > 0) "+" else ""}$t°", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = k.fg)
                    }
                }
            }
            iceRisk(s.weather?.data)?.let { risk ->
                Row(
                    Modifier.padding(horizontal = 12.dp, vertical = 8.dp).fillMaxWidth().shadow(4.dp, RoundedCornerShape(16.dp)).clip(RoundedCornerShape(16.dp))
                        .background(k.warnSoft).clickable(onClick = onWeather).padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Sym("warning", color = k.warn, fill = true)
                    Spacer(Modifier.width(10.dp))
                    Text(risk, fontSize = 13.sp, color = k.fg, modifier = Modifier.weight(1f))
                    Sym("chevron_right", color = k.fg2)
                }
            }
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(StatusFilter.OPEN to "Актуальные", StatusFilter.RESOLVED to "Решённые", StatusFilter.ALL to "Все").forEach { (f, t) ->
                    Box(Modifier.shadow(3.dp, RoundedCornerShape(10.dp))) { KChip(t, s.filter.status == f, { vm.setStatusFilter(f) }, raised = true) }
                }
                Box(Modifier.shadow(3.dp, RoundedCornerShape(10.dp))) { KChip("Мои", s.filter.mine, vm::toggleMine, icon = "person", raised = true) }
                s.cats.take(8).forEach { c ->
                    Box(Modifier.shadow(3.dp, RoundedCornerShape(10.dp))) { KChip(c.name, c.id in s.filter.cats, { vm.toggleCat(c.id) }, icon = c.icon, raised = true) }
                }
            }
        }
        Column(Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 100.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.shadow(4.dp, RoundedCornerShape(50))) { IconBtn("add", "Приблизить", { mapView?.controller?.zoomIn() }, tonal = true) }
            Box(Modifier.shadow(4.dp, RoundedCornerShape(50))) { IconBtn("remove", "Отдалить", { mapView?.controller?.zoomOut() }, tonal = true) }
            Box(Modifier.shadow(4.dp, RoundedCornerShape(50))) {
                IconBtn("my_location", "Моё местоположение", {
                    if (lastKnownLocation(context) != null || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) locate()
                    else permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }, tonal = true)
            }
        }
        val mode = when {
            s.mapMode == MapMode.SNAPSHOT -> "Встроенная карта: сервер карт недоступен"
            s.offlineSince != null -> "Нет сети — сохранённые данные"
            else -> null
        }
        if (mode != null) Row(
            Modifier.align(Alignment.BottomStart).padding(start = 12.dp, bottom = 100.dp).clip(RoundedCornerShape(6.dp)).background(k.surface).padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Sym("cloud_off", size = 14.sp, color = k.fg2)
            Text(" $mode", fontSize = 11.sp, color = k.fg2)
        }
        Text(
            "© участники OpenStreetMap",
            fontSize = 10.sp, color = k.fg2,
            modifier = Modifier.align(Alignment.BottomEnd).padding(bottom = 84.dp, end = 4.dp).background(k.surface.copy(alpha = 0.8f)).padding(horizontal = 4.dp),
        )
        s.find(s.selected)?.let { c -> Sheet(c, s, vm, onOpen, Modifier.align(Alignment.BottomCenter)) }
    }
}

@Composable
private fun Sheet(c: Complaint, s: UiState, vm: MainViewModel, onOpen: (String) -> Unit, modifier: Modifier) {
    val k = LocalKgp.current
    Column(
        modifier.padding(start = 8.dp, end = 8.dp, bottom = 84.dp).fillMaxWidth().shadow(12.dp, RoundedCornerShape(28.dp))
            .clip(RoundedCornerShape(28.dp)).background(k.surface).padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 16.dp)
            .semantics { contentDescription = c.title },
    ) {
        Box(Modifier.align(Alignment.CenterHorizontally).size(32.dp, 4.dp).clip(RoundedCornerShape(2.dp)).background(k.line))
        Spacer(Modifier.size(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Thumb(c, s.cat(c.category))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                StatusChip(c.status)
                Text(c.title, fontWeight = FontWeight.SemiBold, color = k.fg, lineHeight = 19.sp)
                Text("${c.address} · ${fmtDate(c.createdAt)}", fontSize = 13.sp, color = k.fg2)
            }
            IconBtn("close", "Закрыть", { vm.select(null) })
        }
        Spacer(Modifier.size(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            KBtn(
                "${c.supports} " + if (c.supportedByMe) "Вы поддержали" else "Я тоже видел",
                { vm.runAction("support", c.id) },
                Modifier.weight(1f),
                kind = if (c.supportedByMe) BtnKind.ON else BtnKind.TONAL,
                icon = "thumb_up", iconFill = c.supportedByMe, enabled = !c.mine,
            )
            KBtn("Подробнее", { onOpen(c.id) }, Modifier.weight(1f))
        }
    }
}
