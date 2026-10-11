package ru.sfu.kgp.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.sfu.kgp.domain.Krsk
import ru.sfu.kgp.domain.Wmo
import ru.sfu.kgp.domain.fmtDate
import ru.sfu.kgp.domain.iceRisk
import ru.sfu.kgp.domain.plural
import ru.sfu.kgp.domain.Provider
import ru.sfu.kgp.domain.Role
import ru.sfu.kgp.ui.Banner
import ru.sfu.kgp.ui.BtnKind
import ru.sfu.kgp.ui.ComplaintItem
import ru.sfu.kgp.ui.EmptyState
import ru.sfu.kgp.ui.IconBtn
import ru.sfu.kgp.ui.KBtn
import ru.sfu.kgp.ui.KCard
import ru.sfu.kgp.ui.ListGroup
import ru.sfu.kgp.ui.ListRow
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.SectionTitle
import ru.sfu.kgp.ui.Stat
import ru.sfu.kgp.ui.StatusChip
import ru.sfu.kgp.ui.Sym
import ru.sfu.kgp.ui.TopBar
import ru.sfu.kgp.ui.UiState
import ru.sfu.kgp.ui.theme.LocalKgp
import ru.sfu.kgp.ui.theme.Unbounded
import ru.sfu.kgp.ui.theme.parseHex
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

private val RU = Locale.forLanguageTag("ru-RU")

// ---------- уведомления ----------

@Composable
fun NotificationsScreen(s: UiState, vm: MainViewModel) {
    val k = LocalKgp.current
    LaunchedEffect(Unit) { vm.openNotifications() }
    Column(Modifier.fillMaxSize().background(k.bg).verticalScroll(rememberScrollState()).padding(bottom = 96.dp)) {
        TopBar("Уведомления", actions = { if (s.notifications.any { !it.read }) KBtn("Прочитать все", vm::readAll, kind = BtnKind.TEXT) })
        if (s.user == null) {
            EmptyState("notifications_off", "Войдите, чтобы получать уведомления об изменении статуса ваших и поддержанных обращений.") { KBtn("Войти", { vm.openLogin() }) }
            return@Column
        }
        ModeBanners(s.copy(isDemo = false))
        if (s.notifications.isEmpty()) EmptyState("notifications_off", "Пока нет уведомлений. Здесь появятся изменения статусов ваших и поддержанных обращений.")
        s.notifications.sortedByDescending { it.at }.forEach { n ->
            val cat = s.cat(n.cat.ifEmpty { s.complaints.firstOrNull { it.id == n.complaintId }?.category ?: "other" })
            Row(
                Modifier.fillMaxWidth().background(if (n.read) k.bg else k.primarySoft).clickable(onClickLabel = "Открыть обращение") { vm.openNotification(n) }.padding(horizontal = 16.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(parseHex(cat.color)), contentAlignment = Alignment.Center) { Sym(cat.icon, color = androidx.compose.ui.graphics.Color.White, fill = true) }
                Column {
                    Text(n.text, color = k.fg)
                    Text(fmtDate(n.at) + if (n.read) "" else " · новое", fontSize = 13.sp, color = k.fg2)
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(k.line))
        }
    }
}

// ---------- профиль ----------

@Composable
fun ProfileScreen(s: UiState, vm: MainViewModel, onOpen: (String) -> Unit, onStats: () -> Unit, onWeather: () -> Unit, onAbout: () -> Unit, onPrivacy: () -> Unit) {
    val k = LocalKgp.current
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(k.bg).verticalScroll(rememberScrollState()).padding(bottom = 96.dp)) {
        TopBar("Профиль")
        ModeBanners(s)
        val u = s.user
        if (u == null) {
            EmptyState("account_circle", "Войдите, чтобы сообщать о проблемах и получать уведомления о статусе.") { KBtn("Войти", { vm.openLogin() }) }
        } else {
            val mine = s.complaints.filter { it.mine }.sortedByDescending { it.createdAt }
            val supported = s.complaints.filter { it.supportedByMe }.sortedByDescending { it.createdAt }
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(64.dp).clip(CircleShape).background(k.primary), contentAlignment = Alignment.Center) {
                    Text(u.nick.take(1).uppercase(), fontFamily = Unbounded, fontSize = 24.sp, color = k.onPrimary)
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(u.nick, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = k.fg)
                    val role = when (u.role) { Role.ADMIN -> " · администратор"; Role.MODERATOR -> " · модератор"; Role.USER -> "" }
                    Text("Вход через ${if (u.provider == Provider.DEMO) "демо-вход" else u.provider.title} · ${Krsk.NAME}$role", fontSize = 13.sp, color = k.fg2)
                }
            }
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Stat("${mine.size}", plural(mine.size, "обращение", "обращения", "обращений"), Modifier.weight(1f))
                Stat("${mine.count { it.status.name.startsWith("RESOLVED") }}", "решено", Modifier.weight(1f))
                Stat("${supported.size}", "поддержано", Modifier.weight(1f))
            }
            if (s.pendingDrafts > 0) Banner("cloud_upload", "Черновиков ждут отправки: ${s.pendingDrafts}. Отправим при появлении сети.", warn = true) {
                KBtn("Отправить", vm::flushDrafts, kind = BtnKind.TEXT)
            }
            SectionTitle("Мои обращения")
            if (mine.isEmpty()) Text("Вы ещё не сообщали о проблемах.", color = k.fg2, modifier = Modifier.padding(horizontal = 16.dp))
            mine.forEach { c -> Box(Modifier.padding(horizontal = 16.dp, vertical = 5.dp)) { ComplaintItem(c, s.cat(c.category)) { onOpen(c.id) } } }
            SectionTitle("Поддержанные")
            if (supported.isEmpty()) Text("Нажмите «Я тоже видел» в карточке обращения — оно появится здесь, а вы будете получать уведомления.", color = k.fg2, modifier = Modifier.padding(horizontal = 16.dp))
            supported.forEach { c -> Box(Modifier.padding(horizontal = 16.dp, vertical = 5.dp)) { ComplaintItem(c, s.cat(c.category)) { onOpen(c.id) } } }
        }
        SectionTitle("Разделы")
        ListGroup {
            ListRow("bar_chart", "Статистика по району", chevron = true, onClick = onStats)
            ListRow("partly_cloudy_day", "Погода и городские предупреждения", chevron = true, onClick = onWeather)
            ListRow("info", "О приложении и правила публикации", chevron = true, onClick = onAbout)
            ListRow("policy", "Политика обработки персональных данных", chevron = true, onClick = onPrivacy)
        }
        SectionTitle("Настройки")
        ListGroup {
            ListRow("dark_mode", "Тема оформления", trailing = s.theme.title, onClick = vm::cycleTheme)
            u?.let { ListRow("notifications", "Уведомления о статусах", "Ваши и поддержанные обращения", switch = it.notifyEnabled, onClick = { vm.toggleNotify() }) }
            if (s.isDemo) {
                ListRow("shield_person", "Режим модератора (демо)", "Показывает кнопки модерации в карточке обращения", switch = s.moderator, onClick = { vm.toggleDemoModerator() })
                ListRow("restart_alt", "Сбросить демо-данные", onClick = { vm.resetDemo() })
            }
            if (u != null) {
                ListRow("logout", "Выйти", onClick = { vm.logout() })
                ListRow("person_remove", "Удалить учётную запись и мои данные", danger = true, onClick = { confirmDelete = true })
            }
        }
        Text(
            "Версия ${vm.version} · " + if (s.isDemo) "автономный демо-режим: данные хранятся на этом устройстве" else "данные хранятся на сервере проекта",
            fontSize = 12.sp, color = k.fg2, modifier = Modifier.padding(16.dp),
        )
        if (s.moderator && !s.isDemo) Text("Очередь модерации, жалобы и справочники — в веб-панели модератора на сайте (раздел #/admin).", fontSize = 12.sp, color = k.fg2, modifier = Modifier.padding(horizontal = 16.dp))
    }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Удалить учётную запись?") },
        text = { Text("Будут безвозвратно удалены ваш профиль, созданные вами обращения с фотографиями, поддержки, подтверждения и уведомления. Действие нельзя отменить.") },
        confirmButton = { KBtn("Удалить", { confirmDelete = false; vm.deleteAccount() }, kind = BtnKind.DANGER) },
        dismissButton = { KBtn("Отмена", { confirmDelete = false }, kind = BtnKind.OUTLINE) },
    )
}

// ---------- статистика ----------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatsScreen(s: UiState, vm: MainViewModel, onBack: () -> Unit) {
    val k = LocalKgp.current
    LaunchedEffect(Unit) { vm.loadStats() }
    Column(Modifier.fillMaxSize().background(k.bg).verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 24.dp)) {
        TopBar("Статистика", onBack = onBack)
        val st = s.stats
        if (st == null) {
            EmptyState(if (s.offlineSince != null) "cloud_off" else "hourglass_top", if (s.offlineSince != null) "Статистика недоступна без сети." else "Считаем показатели…")
            return@Column
        }
        Text("${Krsk.NAME} · все опубликованные обращения и обращения на модерации", color = k.fg2, modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp))
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Stat("${st.total}", "обращений всего", Modifier.weight(1f))
                Stat("${st.open}", "ждут решения", Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Stat("${(st.resolved * 100.0 / maxOf(1, st.total)).roundToInt()}%", "решено и подтверждено", Modifier.weight(1f))
                Stat("${st.supports}", "поддержек жителей", Modifier.weight(1f))
            }
        }
        SectionTitle("Новые обращения за 3 недели")
        val counts = st.byDay.map { it.second }
        KCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
            Column(Modifier.padding(10.dp)) {
                Canvas(Modifier.fillMaxWidth().height(110.dp).semantics { contentDescription = "Число новых обращений по дням: всего ${counts.sum()} за ${counts.size} дней" }) {
                    val max = maxOf(2, counts.maxOrNull() ?: 0).toFloat()
                    val step = if (counts.size > 1) size.width / (counts.size - 1) else size.width
                    fun pt(i: Int) = Offset(i * step, size.height * (1 - counts[i] / max) * 0.9f + size.height * 0.05f)
                    drawLine(k.line, Offset(0f, size.height * 0.95f), Offset(size.width, size.height * 0.95f))
                    drawLine(k.line, Offset(0f, size.height * 0.05f), Offset(size.width, size.height * 0.05f), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
                    if (counts.isNotEmpty()) {
                        val line = Path().apply { counts.indices.forEach { i -> if (i == 0) moveTo(pt(i).x, pt(i).y) else lineTo(pt(i).x, pt(i).y) } }
                        val area = Path().apply { addPath(line); lineTo(size.width, size.height * 0.95f); lineTo(0f, size.height * 0.95f); close() }
                        drawPath(area, k.primarySoft)
                        drawPath(line, k.primary, style = Stroke(width = 2.dp.toPx()))
                        drawCircle(k.primary, 3.5.dp.toPx(), pt(counts.lastIndex))
                    }
                }
                Row(Modifier.fillMaxWidth()) {
                    val first = st.byDay.firstOrNull()?.first?.let { runCatching { LocalDate.parse(it).format(DateTimeFormatter.ofPattern("d MMM", RU)) }.getOrNull() } ?: ""
                    Text(first, fontSize = 10.sp, color = k.fg3, modifier = Modifier.weight(1f))
                    Text("сегодня", fontSize = 10.sp, color = k.fg3)
                }
            }
        }
        SectionTitle("По категориям")
        Bars(st.byCategory.filter { it.second > 0 }.map { (id, n) -> Triple(s.cat(id).name, n, parseHex(s.cat(id).color)) })
        SectionTitle("По статусам")
        FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            st.byStatus.filter { it.second > 0 }.forEach { (status, n) -> Row(verticalAlignment = Alignment.CenterVertically) { StatusChip(status); Text(" $n", fontSize = 12.sp, color = k.fg2) } }
        }
        if (st.byDistrict.isNotEmpty()) {
            SectionTitle("По районам")
            Bars(st.byDistrict.map { Triple(it.first.removeSuffix(" район"), it.second, k.primary) })
        }
        if (st.medianModerationHours != null || st.medianResolutionDays != null) {
            SectionTitle("Скорость")
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                st.medianModerationHours?.let { Stat("$it ч", "медиана до модерации", Modifier.weight(1f)) }
                st.medianResolutionDays?.let { Stat("$it дн", "медиана до решения", Modifier.weight(1f)) }
            }
        }
        Text("Обезличенные данные с сервера. Те же показатели доступны для Yandex DataLens через представления analytics_*.", fontSize = 12.sp, color = k.fg3, modifier = Modifier.padding(16.dp))
    }
}

@Composable
private fun Bars(rows: List<Triple<String, Int, androidx.compose.ui.graphics.Color>>) {
    val k = LocalKgp.current
    val max = maxOf(1, rows.maxOfOrNull { it.second } ?: 1)
    KCard(Modifier.padding(horizontal = 16.dp).fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            rows.forEach { (name, n, color) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(name, fontSize = 13.sp, color = k.fg, modifier = Modifier.width(132.dp), maxLines = 2)
                    Box(Modifier.weight(1f).height(12.dp).clip(RoundedCornerShape(6.dp)).background(k.surface2)) {
                        Box(Modifier.fillMaxWidth(n.toFloat() / max).height(12.dp).clip(RoundedCornerShape(6.dp)).background(color))
                    }
                    Text("$n", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.width(32.dp).padding(start = 6.dp))
                }
            }
        }
    }
}

// ---------- погода ----------

@Composable
fun WeatherScreen(s: UiState, vm: MainViewModel, onBack: () -> Unit) {
    val k = LocalKgp.current
    Column(Modifier.fillMaxSize().background(k.bg).verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 24.dp)) {
        TopBar("Погода в Красноярске", onBack = onBack, actions = { IconBtn("refresh", "Обновить", { vm.refreshWeather() }) })
        val w = s.weather?.data
        if (w == null) { EmptyState("cloud_off", "Данные о погоде пока не загружены."); return@Column }
        val c = w.current
        val t = c.temperature.roundToInt()
        Row(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(k.primary).padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("${if (c.temperature > 0) "+" else ""}$t°", fontFamily = Unbounded, fontSize = 56.sp, color = k.onPrimary, lineHeight = 60.sp)
                Text(Wmo.text(c.code), fontWeight = FontWeight.SemiBold, color = k.onPrimary)
                Text("Ощущается как ${c.apparent.roundToInt()}° · ветер ${"%.1f".format(c.wind)} м/с · влажность ${c.humidity}%", fontSize = 13.sp, color = k.onPrimary.copy(alpha = 0.85f))
            }
            Sym(Wmo.icon(c.code, c.isDay == 1), size = 72.sp, color = k.onPrimary)
        }
        val risk = iceRisk(w)
        KCard(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp).fillMaxWidth(), bg = if (risk != null) k.warnSoft else null, border = risk == null) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Sym(if (risk != null) "warning" else "verified", color = if (risk != null) k.warn else k.fg2, fill = risk != null)
                Spacer(Modifier.width(8.dp))
                Text(risk ?: "Погодных предупреждений для городской среды нет.", fontSize = 13.sp, color = k.fg)
            }
        }
        SectionTitle("Ближайшие 24 часа")
        val t0 = runCatching { LocalDateTime.parse(c.time) }.getOrNull()
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            w.hourly.time.indices.map { i -> i to runCatching { LocalDateTime.parse(w.hourly.time[i]) }.getOrNull() }
                .filter { (_, dt) -> dt != null && (t0 == null || !dt.isBefore(t0.minusHours(1))) }.take(24).forEach { (i, dt) ->
                    val h = dt!!.hour
                    val temp = w.hourly.temperature.getOrElse(i) { 0.0 }.roundToInt()
                    val p = w.hourly.precipitationProbability?.getOrNull(i)
                    Column(
                        Modifier.width(64.dp).clip(RoundedCornerShape(14.dp)).background(k.surface).padding(vertical = 10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("%02d:00".format(h), fontSize = 13.sp, color = k.fg2)
                        Sym(Wmo.icon(w.hourly.code.getOrElse(i) { 0 }, h in 7..18), color = k.primary)
                        Text("${if (temp > 0) "+" else ""}$temp°", fontWeight = FontWeight.SemiBold, color = k.fg)
                        Text(if (p != null && p > 0) "$p%" else " ", fontSize = 12.sp, color = k.fg2)
                    }
                }
        }
        SectionTitle("3 дня")
        ListGroup {
            w.daily.time.forEachIndexed { i, d ->
                val day = if (i == 0) "Сегодня" else runCatching { LocalDate.parse(d).format(DateTimeFormatter.ofPattern("EEEE, d MMM", RU)) }.getOrDefault(d)
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Sym(Wmo.icon(w.daily.code.getOrElse(i) { 0 }), color = k.fg2)
                    Column(Modifier.weight(1f)) {
                        Text(day, color = k.fg)
                        Text(Wmo.text(w.daily.code.getOrElse(i) { 0 }), fontSize = 13.sp, color = k.fg2)
                    }
                    Text("${w.daily.max.getOrElse(i) { 0.0 }.roundToInt()}°", fontWeight = FontWeight.SemiBold, color = k.fg)
                    Text("${w.daily.min.getOrElse(i) { 0.0 }.roundToInt()}°", color = k.fg2)
                }
            }
        }
        val src = if (s.weather.live) "обновлено ${fmtDate(w.fetchedAt ?: System.currentTimeMillis())}"
        else "сохранённые данные на " + (w.fetchedAt?.let { fmtDate(it) } ?: c.time.replace('T', ' '))
        Text("Источник: открытый API Open-Meteo (open-meteo.com), $src.", fontSize = 12.sp, color = k.fg3, modifier = Modifier.padding(16.dp))
    }
}

// ---------- о приложении, политика ----------

@Composable
fun AboutScreen(vm: MainViewModel, onBack: () -> Unit, onPrivacy: () -> Unit) {
    val k = LocalKgp.current
    Column(Modifier.fillMaxSize().background(k.bg).verticalScroll(rememberScrollState()).navigationBarsPadding()) {
        TopBar("О приложении", onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("«Карта городских проблем» помогает жителям Красноярска сообщать о проблемах городской среды, видеть их на карте и доводить до решения.", color = k.fg)
            KCard {
                Column(Modifier.padding(14.dp)) {
                    Text("Это не официальный канал обращений", fontWeight = FontWeight.SemiBold, color = k.fg)
                    Text("Публикация на карте не является обращением в орган власти. Для официального ответа используйте кнопку «Обращение» в карточке — она готовит текст для платформы «Госуслуги. Решаем вместе».", fontSize = 13.sp, color = k.fg)
                }
            }
            Text("Правила публикации", fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.semantics { heading() })
            listOf(
                "Одна проблема — одно обращение с реальным фото.",
                "На фото не должно быть узнаваемых лиц и номеров автомобилей.",
                "Без оскорблений, рекламы и политической агитации.",
                "Не более 5 обращений в час.",
            ).forEach { Text("•  $it", fontSize = 13.sp, color = k.fg) }
            Text("Открытые данные и сервисы", fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.semantics { heading() })
            Text("Карта © участники OpenStreetMap (серверы openstreetmap.org, openstreetmap.de, openstreetmap.fr). Погода — Open-Meteo. Адреса — геокодеры Nominatim (OpenStreetMap) и Photon (komoot).", fontSize = 13.sp, color = k.fg)
            KBtn("Политика обработки персональных данных", onPrivacy, kind = BtnKind.TEXT, icon = "policy")
            Text("Учебный проект СФУ, Институт управления бизнес-процессами, 2026. Команда: Д. Д. Кутненко, Т. А. Гончаров, Е. В. Эбель.", fontSize = 13.sp, color = k.fg2)
            Text("Версия ${vm.version}", fontSize = 12.sp, color = k.fg2, modifier = Modifier.padding(bottom = 24.dp))
        }
    }
}

/** Tiny Markdown renderer for docs/privacy.md (headings, lists, paragraphs, **bold**). */
fun markdownBlocks(md: String): List<Pair<String, String>> {
    val out = mutableListOf<Pair<String, String>>()
    val para = StringBuilder()
    fun flush() { if (para.isNotBlank()) out += "p" to para.toString().trim(); para.clear() }
    md.replace("\r", "").lines().forEach { line ->
        when {
            line.startsWith("#") -> { flush(); out += "h${line.takeWhile { it == '#' }.length}" to line.trimStart('#').trim() }
            Regex("""^\s*([-*]|\d+\.)\s+""").containsMatchIn(line) -> { flush(); out += "li" to line.replace(Regex("""^\s*([-*]|\d+\.)\s+"""), "") }
            line.isBlank() -> flush()
            else -> para.append(line.trim()).append(' ')
        }
    }
    flush()
    return out
}

fun inlineBold(s: String): AnnotatedString = buildAnnotatedString {
    val parts = s.split("**")
    parts.forEachIndexed { i, p -> if (i % 2 == 1) withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(p) } else append(p) }
}

@Composable
fun PrivacyContent(md: String) {
    val k = LocalKgp.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        markdownBlocks(md).forEach { (kind, text) ->
            when (kind) {
                "h1" -> Text(text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.semantics { heading() })
                "h2", "h3" -> Text(text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.padding(top = 10.dp).semantics { heading() })
                "li" -> Text(inlineBold("•  $text"), fontSize = 14.sp, color = k.fg)
                else -> Text(inlineBold(text), fontSize = 14.sp, color = k.fg, lineHeight = 21.sp)
            }
        }
    }
}

@Composable
fun PrivacyScreen(vm: MainViewModel, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(LocalKgp.current.bg).verticalScroll(rememberScrollState()).navigationBarsPadding()) {
        TopBar("Персональные данные", onBack = onBack)
        Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 24.dp)) { PrivacyContent(vm.privacyText) }
    }
}
