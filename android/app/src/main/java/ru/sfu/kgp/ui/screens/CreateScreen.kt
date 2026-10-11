package ru.sfu.kgp.ui.screens

import android.Manifest
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import okhttp3.OkHttpClient
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import ru.sfu.kgp.BuildConfig
import ru.sfu.kgp.data.Photos
import ru.sfu.kgp.domain.Krsk
import ru.sfu.kgp.map.PlacePickerMap
import ru.sfu.kgp.ui.BtnKind
import ru.sfu.kgp.ui.CreateViewModel
import ru.sfu.kgp.ui.IconBtn
import ru.sfu.kgp.ui.KBtn
import ru.sfu.kgp.ui.KCard
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.Sym
import ru.sfu.kgp.ui.TopBar
import ru.sfu.kgp.ui.UiState
import ru.sfu.kgp.ui.theme.LocalKgp
import ru.sfu.kgp.ui.theme.parseHex
import java.io.File
import java.util.Locale

val STEP_TITLES = listOf("Фото проблемы", "Где это?", "Что случилось?", "Описание", "Проверка")

@Composable
fun CreateScreen(
    vm: CreateViewModel,
    main: MainViewModel,
    s: UiState,
    http: OkHttpClient,
    photos: Photos,
    onExit: () -> Unit,
    onOpen: (String) -> Unit,
    onAppeal: (String) -> Unit,
    onMap: () -> Unit,
) {
    val k = LocalKgp.current
    val ui by vm.ui.collectAsStateWithLifecycle()
    val d = ui.draft
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        // Lifecycle (course lectures): on ON_STOP the wizard is written to Room, so even process death loses nothing.
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_STOP) vm.persist() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(vm) { vm.errors.collect { main.toast(it) } }
    BackHandler(enabled = d.step in 1..4) { vm.back() }

    if (d.step == 5) {
        Column(Modifier.fillMaxSize().background(k.bg).verticalScroll(rememberScrollState()).navigationBarsPadding()) {
            TopBar("Готово")
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(88.dp).clip(CircleShape).background(k.okSoft), contentAlignment = Alignment.Center) {
                    Sym(if (d.savedOffline) "cloud_upload" else "check_circle", size = 48.sp, color = k.ok, fill = true)
                }
                if (d.savedOffline) {
                    Text("Черновик сохранён на устройстве", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = k.fg)
                    Text("Сейчас нет связи с сервером. Обращение отправится автоматически, как только появится интернет, — приложение можно закрыть.", color = k.fg2)
                    KBtn("На карту", { vm.reset(); onMap() }, Modifier.fillMaxWidth())
                } else {
                    Text("Обращение отправлено на модерацию", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = k.fg)
                    Text("Обычно проверка занимает до 24 часов. Мы пришлём уведомление, когда обращение появится на карте.", color = k.fg2)
                    val id = d.createdId.orEmpty()
                    KBtn("Открыть обращение", { vm.reset(); onOpen(id) }, Modifier.fillMaxWidth().testTag("open-created"))
                    KBtn("Подготовить официальное обращение", { vm.reset(); onAppeal(id) }, Modifier.fillMaxWidth(), kind = BtnKind.TONAL, icon = "description")
                    KBtn("На карту", { vm.reset(); onMap() }, kind = BtnKind.TEXT)
                }
            }
        }
        return
    }

    Column(Modifier.fillMaxSize().background(k.bg).imePadding().navigationBarsPadding()) {
        TopBar(
            "Новое обращение", subtitle = "шаг ${d.step + 1} из 5", onBack = if (d.step > 0) ({ vm.back() }) else null,
            actions = { IconBtn("close", "Отменить", { vm.reset(); onExit() }) },
        )
        Row(
            Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp).semantics { progressBarRangeInfo = ProgressBarRangeInfo((d.step + 1).toFloat(), 1f..5f, 5) },
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            repeat(5) { i -> Box(Modifier.weight(1f).height(4.dp).clip(RoundedCornerShape(2.dp)).background(if (i <= d.step) k.primary else k.surface3)) }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState(), enabled = d.step != 1)) {
            when (d.step) {
                0 -> StepPhotos(vm, d.photos, photos, main)
                1 -> StepPlace(vm, ui.draft.lat, ui.draft.lng, ui.draft.address, ui.draft.district, ui.geoHint, ui.geocoding, http)
                2 -> StepCategory(vm, s, d.category)
                3 -> StepDescription(vm, d.title, d.description)
                4 -> StepCheck(vm, main, s, ui) { id -> vm.reset(); onOpen(id) }
            }
        }
        Row(Modifier.fillMaxWidth().background(k.bg).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (d.step > 0) KBtn("Назад", { vm.back() }, Modifier.weight(1f), kind = BtnKind.OUTLINE)
            val dup = ui.dups?.firstOrNull()
            KBtn(
                when {
                    ui.busy -> "Отправляем…"
                    d.step == 4 && dup != null -> "Всё равно отправить"
                    d.step == 4 -> "Отправить"
                    else -> "Далее"
                },
                { vm.next { main.onCreated() } },
                Modifier.weight(1f).testTag("next"),
                kind = if (d.step == 4) BtnKind.ACCENT else BtnKind.PRIMARY,
                enabled = ui.ready,
            )
        }
    }
}

@Composable
private fun Title(t: String, sub: String) {
    val k = LocalKgp.current
    Text(t, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 4.dp))
    Text(sub, color = k.fg2, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp))
}

@Composable
private fun StepPhotos(vm: CreateViewModel, files: List<String>, photos: Photos, main: MainViewModel) {
    val k = LocalKgp.current
    val context = LocalContext.current
    var captureFile by rememberSaveable { mutableStateOf<String?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = captureFile
        if (ok && f != null) vm.addPhoto(Uri.fromFile(File(f))) { main.toast(it) }
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(3)) { uris ->
        uris.take(3 - files.size).forEach { vm.addPhoto(it) { e -> main.toast(e) } }
    }
    Title("Сфотографируйте проблему", "До трёх фото. Не снимайте лица людей и номера машин — такие фото не пройдут модерацию.")
    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        files.forEachIndexed { i, f ->
            Box(Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(16.dp)).background(k.surface)) {
                AsyncImage(model = File(f), contentDescription = "Фото ${i + 1}", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                Box(Modifier.align(Alignment.TopEnd).padding(4.dp)) { IconBtn("close", "Удалить фото ${i + 1}", { vm.removePhoto(i) }, onDark = true) }
            }
        }
        if (files.size < 3) {
            AddSlot("photo_camera", "Снять фото", Modifier.weight(1f)) {
                val f = photos.newCaptureFile()
                captureFile = f.absolutePath
                camera.launch(FileProvider.getUriForFile(context, BuildConfig.APPLICATION_ID + ".files", f))
            }
            AddSlot("photo_library", "Из галереи", Modifier.weight(1f)) {
                gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
        }
        repeat(maxOf(0, 3 - files.size - if (files.size < 3) 2 else 0)) { Spacer(Modifier.weight(1f)) }
    }
    KBtn("Нет фото под рукой — добавить демо-иллюстрацию", vm::addDemoPhoto, Modifier.padding(16.dp).testTag("demo-photo"), kind = BtnKind.TEXT, icon = "image", enabled = files.size < 3)
}

@Composable
private fun AddSlot(icon: String, label: String, modifier: Modifier, onClick: () -> Unit) {
    val k = LocalKgp.current
    Column(
        modifier.aspectRatio(1f).clip(RoundedCornerShape(16.dp)).background(k.surface)
            .drawBehind { drawRoundRect(k.line, style = Stroke(width = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 8f))), cornerRadius = CornerRadius(16.dp.toPx())) }
            .clickable(onClickLabel = label, role = Role.Button, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Sym(icon, size = 32.sp, color = k.primary)
        Text(label, fontSize = 12.sp, color = k.fg2)
    }
}

@Composable
private fun StepPlace(vm: CreateViewModel, lat: Double?, lng: Double?, address: String, district: String, hint: String, geocoding: Boolean, http: OkHttpClient) {
    val k = LocalKgp.current
    val context = LocalContext.current
    var map by remember { mutableStateOf<MapView?>(null) }
    val start = remember { GeoPoint(lat ?: lastKnownLocation(context)?.latitude?.takeIf { Krsk.inCity(it, Krsk.CAMPUS_LNG) } ?: Krsk.CAMPUS_LAT, lng ?: lastKnownLocation(context)?.longitude?.takeIf { Krsk.inCity(Krsk.CAMPUS_LAT, it) } ?: Krsk.CAMPUS_LNG) }
    val locate = {
        vm.setGeoHint("Определяем местоположение…")
        requestLocation(context) { l ->
            when {
                l == null -> vm.setGeoHint("Не удалось определить местоположение. Передвиньте карту вручную.")
                !Krsk.inCity(l.latitude, l.longitude) -> vm.setGeoHint("Вы находитесь за пределами Красноярска — передвиньте карту к месту проблемы.")
                else -> {
                    map?.controller?.animateTo(GeoPoint(l.latitude, l.longitude), 18.0, 300L)
                    vm.setGeoHint(if (l.accuracy > 50) "Точность около ${l.accuracy.toInt()} м — уточните метку вручную." else "")
                }
            }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        if (r.values.any { it }) locate() else vm.setGeoHint("Геолокация недоступна. Передвиньте карту вручную.")
    }
    LaunchedEffect(Unit) { if (lat == null) vm.setLocation(start.latitude, start.longitude) }
    Title("Отметьте место", "Передвиньте карту так, чтобы метка указывала на проблему.")
    Box(Modifier.padding(horizontal = 16.dp).fillMaxWidth().heightIn(min = 280.dp).height(340.dp).clip(RoundedCornerShape(16.dp)).border(1.dp, k.line, RoundedCornerShape(16.dp))) {
        PlacePickerMap(start, http, onCenter = { a, b -> vm.setLocation(a, b) }, onReady = { map = it }, modifier = Modifier.fillMaxSize().semantics { contentDescription = "Карта выбора места" })
        Sym("location_on", size = 48.sp, color = k.accent, fill = true, modifier = Modifier.align(Alignment.Center).offset(y = (-24).dp))
    }
    Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(k.surface).border(1.dp, k.line, RoundedCornerShape(12.dp)).padding(12.dp)) {
        Sym("place", color = k.fg2)
        Spacer(Modifier.width(10.dp))
        Column {
            Text(if (geocoding || address.isEmpty()) "Определяем адрес…" else address, fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.testTag("address"))
            if (lat != null && lng != null) Text(listOf(district, "%.5f, %.5f".format(Locale.US, lat, lng)).filter { it.isNotEmpty() }.joinToString(" · "), fontSize = 13.sp, color = k.fg2)
        }
    }
    KBtn("Определить моё местоположение", {
        if (lastKnownLocation(context) != null) locate() else permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), kind = BtnKind.TEXT, icon = "my_location")
    if (hint.isNotEmpty()) Text(hint, fontSize = 12.sp, color = k.fg3, modifier = Modifier.padding(horizontal = 16.dp))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StepCategory(vm: CreateViewModel, s: UiState, chosen: String?) {
    val k = LocalKgp.current
    Title("Выберите категорию", "От категории зависит, какой организации будет адресовано обращение.")
    FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), maxItemsInEachRow = 2) {
        s.cats.forEach { c ->
            val on = chosen == c.id
            Column(
                Modifier.weight(1f).heightIn(min = 104.dp).clip(RoundedCornerShape(16.dp)).background(if (on) k.primarySoft else k.surface)
                    .border(2.dp, if (on) k.primary else k.line, RoundedCornerShape(16.dp))
                    .clickable(role = Role.RadioButton) { vm.setCategory(c.id) }.semantics { selected = on }.padding(14.dp).testTag("cat-${c.id}"),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(parseHex(c.color)), contentAlignment = Alignment.Center) { Sym(c.icon, color = Color.White, fill = true) }
                Text(c.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 18.sp, color = k.fg)
            }
        }
    }
}

@Composable
private fun StepDescription(vm: CreateViewModel, title: String, description: String) {
    val k = LocalKgp.current
    Title("Опишите проблему", "Коротко: что, где именно и почему опасно. Можно пропустить подробности.")
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Заголовок", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = k.fg2)
        OutlinedTextField(title, vm::setTitle, Modifier.fillMaxWidth().testTag("title"), singleLine = true, placeholder = { Text("Например: Яма на въезде во двор") }, shape = RoundedCornerShape(12.dp), colors = KTextFieldColors())
        Text("От 5 до 80 символов", fontSize = 12.sp, color = k.fg3)
        Spacer(Modifier.height(8.dp))
        Text("Подробности (необязательно)", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = k.fg2)
        OutlinedTextField(description, vm::setDescription, Modifier.fillMaxWidth().heightIn(min = 120.dp).testTag("description"), placeholder = { Text("Яма около 40 см, после дождя не видна") }, shape = RoundedCornerShape(12.dp), colors = KTextFieldColors())
        Text("${description.length} / 500", fontSize = 12.sp, color = k.fg3, modifier = Modifier.testTag("desc-count"))
    }
}

@Composable
private fun StepCheck(vm: CreateViewModel, main: MainViewModel, s: UiState, ui: ru.sfu.kgp.ui.WizardUi, onOpen: (String) -> Unit) {
    val k = LocalKgp.current
    val d = ui.draft
    val cat = s.cat(d.category ?: "other")
    Text("Проверьте и отправьте", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
    if (ui.dups == null) Text("Ищем похожие обращения рядом…", fontSize = 13.sp, color = k.fg2, modifier = Modifier.padding(horizontal = 16.dp))
    ui.dups?.firstOrNull()?.let { dup ->
        KCard(Modifier.padding(horizontal = 16.dp, vertical = 8.dp).testTag("dup"), bg = k.warnSoft) {
            Row(Modifier.padding(14.dp)) {
                Sym("info", color = k.warn, fill = true)
                Spacer(Modifier.width(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Рядом уже есть похожее обращение", fontWeight = FontWeight.SemiBold, color = k.fg)
                    Text("В радиусе 30 м: «${dup.title}». Поддержите его — так проблему решат быстрее.", fontSize = 13.sp, color = k.fg)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        KBtn("Поддержать", { vm.reset(); main.supportDuplicate(dup.id) }, icon = "thumb_up")
                        KBtn("Открыть", { onOpen(dup.id) }, kind = BtnKind.OUTLINE)
                    }
                }
            }
        }
    }
    Row(Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(k.surface).border(1.dp, k.line, RoundedCornerShape(16.dp)).padding(10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(76.dp).clip(RoundedCornerShape(12.dp))) {
            d.photos.firstOrNull()?.let { AsyncImage(model = File(it), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(d.title, fontWeight = FontWeight.SemiBold, color = k.fg)
            Row { Sym(cat.icon, size = 15.sp, color = k.fg2); Text(" ${cat.name}", fontSize = 12.sp, color = k.fg2) }
            Row { Sym("place", size = 15.sp, color = k.fg2); Text(" ${d.address}", fontSize = 12.sp, color = k.fg2) }
        }
    }
    Text("После отправки обращение проверит модератор. Публично отображается только ваш никнейм «${s.user?.nick.orEmpty()}».", fontSize = 13.sp, color = k.fg2, modifier = Modifier.padding(horizontal = 16.dp))
}
