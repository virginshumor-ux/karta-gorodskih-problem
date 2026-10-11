package ru.sfu.kgp.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import ru.sfu.kgp.data.Photos
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.Krsk
import ru.sfu.kgp.domain.REPORT_REASONS
import ru.sfu.kgp.domain.Status
import ru.sfu.kgp.domain.appealText
import ru.sfu.kgp.domain.distM
import ru.sfu.kgp.domain.fmtDate
import ru.sfu.kgp.domain.plural
import ru.sfu.kgp.map.MiniMap
import ru.sfu.kgp.ui.BtnKind
import ru.sfu.kgp.ui.DemoTag
import ru.sfu.kgp.ui.EmptyState
import ru.sfu.kgp.ui.IconBtn
import ru.sfu.kgp.ui.KBtn
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.PhotoOrIllustration
import ru.sfu.kgp.ui.SectionTitle
import ru.sfu.kgp.ui.StatusChip
import ru.sfu.kgp.ui.Sym
import ru.sfu.kgp.ui.TopBar
import ru.sfu.kgp.ui.UiState
import ru.sfu.kgp.ui.theme.LocalKgp
import java.util.Locale

fun complaintLink(site: String, id: String): String = if (site.isBlank()) "" else site.trimEnd('/') + "/#/c/$id"

fun share(context: Context, c: Complaint, site: String) {
    val link = complaintLink(site, c.id)
    val text = "${c.title} — ${c.address}, Красноярск" + if (link.isNotEmpty()) "\n$link" else ""
    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Поделиться"))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DetailScreen(id: String, s: UiState, vm: MainViewModel, http: OkHttpClient, photos: Photos, onBack: () -> Unit, onAppeal: () -> Unit, onOpen: (String) -> Unit) {
    val k = LocalKgp.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    LaunchedEffect(id) { vm.loadDetail(id) }
    val c = s.find(id)
    var photoIndex by rememberSaveable(id) { mutableIntStateOf(0) }
    var dialog by rememberSaveable { mutableStateOf<String?>(null) }
    val pickAfter = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri != null) scope.launch {
            vm.toast("Загружаем фото «после»…")
            runCatching { photos.compress(uri) }.onSuccess { vm.runAction("after", id, it.absolutePath) }.onFailure { vm.toast("Не удалось прочитать файл.") }
        }
    }
    if (c == null) {
        Column(Modifier.fillMaxSize().background(k.bg)) {
            TopBar("Обращение", onBack = onBack)
            if (s.loading) EmptyState("hourglass_top", "Загружаем обращение…")
            else EmptyState("help", "Обращение не найдено или ещё не опубликовано.") { KBtn("На карту", onBack, kind = BtnKind.TONAL) }
        }
        return
    }
    val cat = s.cat(c.category)
    val gallery = c.gallery
    val n = maxOf(1, gallery.size)
    val idx = photoIndex.coerceIn(0, n - 1)
    val open = c.status.isOpen
    Column(Modifier.fillMaxSize().background(k.bg).verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 96.dp)) {
        Box(Modifier.fillMaxWidth().height(240.dp).background(k.surface2)) {
            PhotoOrIllustration(c, cat, idx, iconSize = 96.sp)
            Row(Modifier.statusBarsPadding().padding(8.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                IconBtn("arrow_back", "Назад", onBack, onDark = true)
                IconBtn("share", "Поделиться", { share(context, c, vm.siteUrl) }, onDark = true)
            }
            val label = when {
                gallery.isEmpty() -> "Иллюстрация категории — фото не приложено" + if (c.demo) " (демо-данные)" else ""
                gallery[idx].kind == "after" -> "Фото «после»" + if (gallery[idx].approved) "" else " — ждёт проверки модератором"
                else -> null
            }
            if (label != null) Text(label, color = Color.White, fontSize = 11.sp, modifier = Modifier.align(Alignment.BottomStart).padding(12.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x80000000)).padding(horizontal = 8.dp, vertical = 3.dp))
            if (n > 1) {
                IconBtn("chevron_left", "Предыдущее фото", { photoIndex = (idx - 1 + n) % n }, Modifier.align(Alignment.CenterStart).padding(8.dp), onDark = true)
                IconBtn("chevron_right", "Следующее фото", { photoIndex = (idx + 1) % n }, Modifier.align(Alignment.CenterEnd).padding(8.dp), onDark = true)
                Row(Modifier.align(Alignment.BottomCenter).padding(10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    repeat(n) { i -> Box(Modifier.size(7.dp).clip(CircleShape).background(if (i == idx) Color.White else Color(0x8CFFFFFF))) }
                }
            }
        }
        ModeBanners(s.copy(isDemo = false))
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                StatusChip(c.status)
                if (c.demo) DemoTag()
            }
            Text(c.title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp, color = k.fg, modifier = Modifier.semantics { heading() })
            if (c.description.isNotEmpty()) Text(c.description, color = k.fg)
            if (c.status == Status.DUPLICATE && c.duplicateOf != null) KBtn("Открыть основное обращение", { onOpen(c.duplicateOf) }, kind = BtnKind.TEXT, icon = "call_merge")
        }
        Kv(cat.icon) { Text(cat.name, color = k.fg) }
        Kv("place") {
            Column {
                Text(c.address, color = k.fg)
                Text(listOf(c.district, "%.5f, %.5f".format(Locale.US, c.lat, c.lng)).filter { it.isNotEmpty() }.joinToString(" · "), fontSize = 13.sp, color = k.fg2)
            }
        }
        Kv("schedule") { Text("${fmtDate(c.createdAt)} · автор: ${if (c.mine) "вы" else c.author}", color = k.fg) }
        Kv("apartment") { Text("Ответственная организация (ориентировочно): ${cat.org}", fontSize = 13.sp, color = k.fg) }
        Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp).fillMaxWidth().height(160.dp).clip(RoundedCornerShape(16.dp)).border(1.dp, k.line, RoundedCornerShape(16.dp))) {
            MiniMap(c, cat, http, Modifier.fillMaxSize())
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KBtn(if (c.supportedByMe) "Поддержано" else "Я тоже видел", { vm.runAction("support", c.id) }, Modifier.weight(1f),
                    kind = if (c.supportedByMe) BtnKind.ON else BtnKind.TONAL, icon = "thumb_up", iconFill = c.supportedByMe, enabled = !c.mine && open)
                KBtn("Обращение", onAppeal, Modifier.weight(1f), kind = BtnKind.OUTLINE, icon = "description")
            }
            if (open && !c.confirmedByMe) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KBtn("Решено", { vm.runAction("confirm", c.id) }, Modifier.weight(1f), kind = BtnKind.OUTLINE, icon = "task_alt")
                KBtn("Не решено", { vm.runAction("notfixed", c.id) }, Modifier.weight(1f), kind = BtnKind.OUTLINE, icon = "replay", enabled = c.status == Status.RESOLVED_WAIT)
            }
            if (c.confirmedByMe && c.status != Status.RESOLVED) Text("Вы подтвердили, что проблема решена. Подтверждений: ${c.confirms} из ${Krsk.CONFIRM_NEED}.", fontSize = 13.sp, color = k.fg2)
            if (c.mine && c.status in setOf(Status.PUBLISHED, Status.SENT, Status.WORK))
                KBtn("Добавить фото «после»", { pickAfter.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, Modifier.fillMaxWidth(), kind = BtnKind.OUTLINE, icon = "add_photo_alternate")
        }
        Row(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(k.primarySoft).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${c.supports}", fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = k.primary)
            Spacer(Modifier.width(12.dp))
            Text(
                plural(c.supports, "житель поддержал", "жителя поддержали", "жителей поддержали") + " это обращение" +
                    if (c.status == Status.RESOLVED_WAIT) "\nПодтверждений решения: ${c.confirms} из ${Krsk.CONFIRM_NEED}" else "",
                fontSize = 13.sp, color = k.fg,
            )
        }
        if (s.moderator) {
            SectionTitle(if (s.isDemo) "Модерация (демо-режим)" else "Модерация")
            FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (c.status == Status.MODERATION) {
                    KBtn("Опубликовать", { vm.moderate(c.id, Status.PUBLISHED) }, icon = "check")
                    KBtn("Отклонить", { dialog = "reject" }, kind = BtnKind.OUTLINE, icon = "block")
                    KBtn("Дубликат…", { dialog = "dup" }, kind = BtnKind.OUTLINE, icon = "call_merge")
                }
                if (c.status == Status.PUBLISHED) KBtn("Передано в организацию", { vm.moderate(c.id, Status.SENT) }, kind = BtnKind.TONAL, icon = "forward_to_inbox")
                if (c.status in setOf(Status.PUBLISHED, Status.SENT)) KBtn("В работе", { vm.moderate(c.id, Status.WORK) }, kind = BtnKind.TONAL, icon = "construction")
                if (c.status in setOf(Status.PUBLISHED, Status.SENT, Status.WORK)) KBtn("Отметить решённым", { vm.moderate(c.id, Status.RESOLVED_WAIT) }, kind = BtnKind.TONAL, icon = "task_alt")
                if (c.status == Status.RESOLVED_WAIT) KBtn("Подтвердить решение", { vm.moderate(c.id, Status.RESOLVED) }, kind = BtnKind.TONAL, icon = "verified")
                if (c.status.isOpen) {
                    KBtn("Дубликат…", { dialog = "dup" }, kind = BtnKind.OUTLINE, icon = "call_merge")
                    KBtn("Скрыть", { dialog = "reject" }, kind = BtnKind.OUTLINE, icon = "visibility_off")
                }
            }
            c.photos.filter { it.kind == "after" && !it.approved }.forEach { p ->
                Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Фото «после» ждёт проверки", fontSize = 13.sp, modifier = Modifier.weight(1f), color = k.fg)
                    KBtn("Одобрить", { vm.reviewAfter(c.id, p.id, true) }, kind = BtnKind.TONAL, icon = "check")
                    KBtn("Отклонить", { vm.reviewAfter(c.id, p.id, false) }, kind = BtnKind.OUTLINE)
                }
            }
        }
        SectionTitle("История статусов")
        if (c.history.isEmpty()) Text(if (s.offlineSince != null) "История недоступна без сети." else "Загружаем историю…", fontSize = 13.sp, color = k.fg2, modifier = Modifier.padding(horizontal = 16.dp))
        Column(Modifier.padding(horizontal = 16.dp)) {
            c.history.forEachIndexed { i, h ->
                Row {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(16.dp)) {
                        Box(Modifier.padding(top = 4.dp).size(12.dp).clip(CircleShape).background(if (i == 0) k.primary else k.surface).border(2.dp, k.primary, CircleShape))
                        if (i < c.history.lastIndex) Box(Modifier.width(2.dp).height(48.dp).background(k.line))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.padding(bottom = 14.dp)) {
                        Text(h.status.title, fontWeight = FontWeight.SemiBold, color = k.fg)
                        Text("${fmtDate(h.at)} · ${h.by}", fontSize = 13.sp, color = k.fg2)
                        if (h.comment.isNotEmpty()) Text(h.comment, fontSize = 13.sp, color = k.fg)
                    }
                }
            }
        }
        KBtn("Пожаловаться на обращение", { if (vm.requireUser("report", c.id)) dialog = "report" }, Modifier.padding(horizontal = 16.dp), kind = BtnKind.TEXT, icon = "flag")
    }
    when (dialog) {
        "report" -> ChoiceDialog(
            "Пожаловаться на обращение", "Модератор проверит обращение и скроет его, если оно нарушает правила.", REPORT_REASONS, "Отправить",
            onDismiss = { dialog = null },
        ) { vm.runAction("report", c.id, it); dialog = null }
        "reject" -> ChoiceDialog(
            "Отклонить или скрыть обращение", "Причина попадёт в историю статусов и в уведомление автору.",
            listOf("Нарушены правила публикации", "На фото узнаваемые люди или номера машин", "Недостоверная информация", "Не относится к городской среде"), "Отклонить",
            onDismiss = { dialog = null },
        ) { vm.moderate(c.id, Status.REJECTED, it); dialog = null }
        "dup" -> {
            val cands = s.complaints.filter { it.id != c.id && it.status != Status.DUPLICATE && it.status != Status.REJECTED && distM(it.lat, it.lng, c.lat, c.lng) < 400 }
                .sortedWith(compareByDescending<Complaint> { it.category == c.category }.thenBy { distM(it.lat, it.lng, c.lat, c.lng) }).take(8)
            if (cands.isEmpty()) { vm.toast("Рядом (до 400 м) других обращений нет"); dialog = null }
            else ChoiceDialog(
                "Объединить с похожим обращением", "«${c.title}» станет дубликатом, а его автор — поддержавшим основное обращение.",
                cands.map { "${it.title} · ${distM(it.lat, it.lng, c.lat, c.lng).toInt()} м" }, "Объединить", onDismiss = { dialog = null },
            ) { picked -> cands.getOrNull(cands.indexOfFirst { picked.startsWith(it.title) })?.let { vm.markDuplicate(c.id, it.id) }; dialog = null }
        }
    }
}

@Composable
private fun Kv(icon: String, content: @Composable () -> Unit) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 5.dp)) {
        Sym(icon, size = 20.sp, color = LocalKgp.current.fg2, modifier = Modifier.width(24.dp))
        Spacer(Modifier.width(10.dp))
        content()
    }
}

@Composable
fun ChoiceDialog(title: String, text: String, options: List<String>, confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var chosen by remember { mutableIntStateOf(0) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                Text(text, fontSize = 13.sp, color = LocalKgp.current.fg2)
                Spacer(Modifier.height(8.dp))
                options.forEachIndexed { i, o ->
                    Row(
                        Modifier.fillMaxWidth().selectable(i == chosen, role = Role.RadioButton) { chosen = i }.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = i == chosen, onClick = null)
                        Spacer(Modifier.width(8.dp))
                        Text(o)
                    }
                }
            }
        },
        confirmButton = { KBtn(confirm, { onConfirm(options[chosen]) }) },
        dismissButton = { KBtn("Отмена", onDismiss, kind = BtnKind.OUTLINE) },
    )
}

@Composable
fun AppealScreen(id: String, s: UiState, vm: MainViewModel, onBack: () -> Unit) {
    val k = LocalKgp.current
    val context = LocalContext.current
    val c = s.find(id)
    Column(Modifier.fillMaxSize().background(k.bg).verticalScroll(rememberScrollState()).navigationBarsPadding()) {
        TopBar("Официальное обращение", onBack = onBack)
        if (c == null) { EmptyState("help", "Обращение не найдено."); return@Column }
        val text = appealText(c, s.cat(c.category), if (c.demo) "" else complaintLink(vm.siteUrl, c.id))
        Text(
            "Приложение не отправляет обращения в органы власти. Скопируйте текст и подайте его через платформу «Госуслуги. Решаем вместе» — там ответ обязателен в течение 30 дней.",
            color = k.fg2, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
        )
        SelectionContainer {
            Text(text, fontSize = 14.sp, lineHeight = 21.sp, color = k.fg, modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(k.surface).border(1.dp, k.line, RoundedCornerShape(12.dp)).padding(14.dp))
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            KBtn("Скопировать текст", {
                context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Обращение", text))
                vm.toast("Текст скопирован")
            }, Modifier.fillMaxWidth(), icon = "content_copy")
            KBtn("Открыть «Решаем вместе»", { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://pos.gosuslugi.ru/"))) }, Modifier.fillMaxWidth(), kind = BtnKind.OUTLINE, icon = "open_in_new")
            if (c.status == Status.PUBLISHED && c.mine) KBtn("Я отправил обращение — отметить «Передано»", { vm.runAction("marksent", c.id) }, kind = BtnKind.TEXT)
        }
    }
}

