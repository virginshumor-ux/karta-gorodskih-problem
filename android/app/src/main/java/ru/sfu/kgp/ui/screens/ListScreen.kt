package ru.sfu.kgp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.sfu.kgp.domain.DISTRICTS
import ru.sfu.kgp.domain.Period
import ru.sfu.kgp.domain.StatusFilter
import ru.sfu.kgp.domain.fmtDate
import ru.sfu.kgp.domain.plural
import ru.sfu.kgp.ui.Banner
import ru.sfu.kgp.ui.BtnKind
import ru.sfu.kgp.ui.ComplaintItem
import ru.sfu.kgp.ui.EmptyState
import ru.sfu.kgp.ui.IconBtn
import ru.sfu.kgp.ui.KBtn
import ru.sfu.kgp.ui.KChip
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.Sym
import ru.sfu.kgp.ui.TopBar
import ru.sfu.kgp.ui.UiState
import ru.sfu.kgp.ui.theme.LocalKgp

@Composable
fun ModeBanners(s: UiState) {
    if (s.isDemo) Banner("science", "Автономный демо-режим: сервер не подключён, данные хранятся только на этом устройстве.")
    s.offlineSince?.let {
        Banner("cloud_off", "Нет связи с сервером — показаны сохранённые данные на ${fmtDate(it)}." + if (s.pendingDrafts > 0) " Черновиков к отправке: ${s.pendingDrafts}." else "", warn = true)
    }
}

@Composable
fun KTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedContainerColor = LocalKgp.current.surface,
    unfocusedContainerColor = LocalKgp.current.surface,
    unfocusedBorderColor = LocalKgp.current.line,
    focusedBorderColor = LocalKgp.current.primary,
)

@Composable
private fun Select(icon: String, label: String, value: String, options: List<Pair<String, String>>, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    val k = LocalKgp.current
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).background(k.surface).border(1.dp, k.line, RoundedCornerShape(10.dp))
                .clickable(onClickLabel = label, role = Role.DropdownList) { open = true }.padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Sym(icon, size = 18.sp, color = k.fg2)
            Text(" " + (options.firstOrNull { it.first == value }?.second ?: value), fontSize = 13.sp, color = k.fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Sym("chevron_right", size = 18.sp, color = k.fg2)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (v, t) -> DropdownMenuItem(text = { Text(t) }, onClick = { open = false; onPick(v) }) }
        }
    }
}

@Composable
fun ListScreen(s: UiState, vm: MainViewModel, onOpen: (String) -> Unit, onMap: () -> Unit) {
    val items = s.visible
    val districts = (DISTRICTS + s.complaints.map { it.district }.filter { it.isNotEmpty() }).distinct().sorted()
    LazyColumn(Modifier.fillMaxSize().background(LocalKgp.current.bg).testTag("list"), contentPadding = ru.sfu.kgp.ui.ScreenPadding) {
        item { TopBar("Обращения", actions = { IconBtn("map", "Показать на карте", onMap) }) }
        item { ModeBanners(s) }
        item {
            OutlinedTextField(
                value = s.search, onValueChange = vm::setSearch, singleLine = true,
                placeholder = { Text("Поиск по адресу или описанию") },
                modifier = Modifier.padding(horizontal = 16.dp).fillMaxWidth().testTag("search"),
                shape = RoundedCornerShape(12.dp), colors = KTextFieldColors(),
            )
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(StatusFilter.OPEN to "Актуальные", StatusFilter.RESOLVED to "Решённые", StatusFilter.ALL to "Все").forEach { (f, t) ->
                    KChip(t, s.filter.status == f, { vm.setStatusFilter(f) })
                }
                KChip("Мои", s.filter.mine, vm::toggleMine, icon = "person")
                s.cats.forEach { c -> KChip(c.name, c.id in s.filter.cats, { vm.toggleCat(c.id) }, icon = c.icon) }
            }
        }
        item {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Select("location_city", "Район", s.filter.district, listOf("" to "Все районы") + districts.map { it to it }, vm::setDistrict, Modifier.weight(1f))
                Select("date_range", "Период", s.filter.period.name, Period.entries.map { it.name to it.title }, { vm.setPeriod(Period.valueOf(it)) }, Modifier.weight(1f))
            }
        }
        if (s.loading && s.complaints.isEmpty()) {
            item { EmptyState("hourglass_top", "Загружаем обращения…") }
        } else {
            item {
                Text(
                    "${items.size} ${plural(items.size, "обращение", "обращения", "обращений")} · сначала новые",
                    fontSize = 13.sp, color = LocalKgp.current.fg2, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            if (items.isEmpty()) item {
                EmptyState("search_off", "Ничего не найдено. Сбросьте фильтры или сообщите о новой проблеме.") {
                    KBtn("Сбросить фильтры", vm::resetFilters, kind = BtnKind.TONAL)
                }
            }
            items(items, key = { it.id }) { c ->
                Column(Modifier.padding(horizontal = 16.dp, vertical = 5.dp)) { ComplaintItem(c, s.cat(c.category)) { onOpen(c.id) } }
            }
        }
    }
}
