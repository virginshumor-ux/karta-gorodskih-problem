package ru.sfu.kgp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.sfu.kgp.BuildConfig
import ru.sfu.kgp.ui.BtnKind
import ru.sfu.kgp.ui.KBtn
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.Sym
import ru.sfu.kgp.ui.UiState
import ru.sfu.kgp.ui.theme.LocalKgp
import ru.sfu.kgp.ui.theme.Unbounded
import kotlin.random.Random

private data class Slide(val icon: String, val color: Color?, val title: String, val text: String)

private val SLIDES = listOf(
    Slide("add_location_alt", null, "Увидели яму, свалку или наледь?", "Сфотографируйте и отметьте место — на обращение уходит меньше минуты."),
    Slide("groups", Color(0xFF2F7FB5), "Объединяемся с соседями", "Поддерживайте обращения других жителей и подтверждайте, когда проблему решили."),
    Slide("gavel", Color(0xFFB3471D), "Это не официальный канал", "Карта делает проблемы видимыми. Для официального ответа приложение подготовит текст обращения для «Госуслуги. Решаем вместе»."),
)

@Composable
fun Onboarding(step: Int, vm: MainViewModel) {
    val k = LocalKgp.current
    val sl = SLIDES[step.coerceIn(0, 2)]
    BackHandler(enabled = step > 0) { vm.onboardingNext(step - 1) }
    Column(
        Modifier.fillMaxSize().background(k.bg).statusBarsPadding().navigationBarsPadding().padding(24.dp).testTag("onboarding"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                repeat(3) { i -> Box(Modifier.size(if (i == step) 24.dp else 8.dp, 8.dp).clip(RoundedCornerShape(4.dp)).background(if (i == step) k.primary else k.surface3)) }
            }
            KBtn("Пропустить", { vm.onboardingNext(3) }, kind = BtnKind.TEXT)
        }
        Box(Modifier.weight(1f).fillMaxWidth().heightIn(min = 220.dp).clip(RoundedCornerShape(28.dp)).background(sl.color ?: k.primary), contentAlignment = Alignment.Center) {
            Sym(sl.icon, size = 120.sp, color = k.onPrimary, fill = true)
        }
        Text(sl.title, fontFamily = Unbounded, fontSize = 24.sp, lineHeight = 29.sp, color = k.fg, modifier = Modifier.semantics { heading() })
        Text(sl.text, color = k.fg2)
        if (step == 2) Text("Приложению понадобятся доступ к камере, геолокации и уведомлениям — система спросит разрешение в момент использования.", fontSize = 13.sp, color = k.fg2)
        KBtn(if (step < 2) "Далее" else "Начать", { vm.onboardingNext(step + 1) }, Modifier.fillMaxWidth().testTag("onb-next"))
    }
}

@Composable
fun LoginOverlay(reason: String, s: UiState, vm: MainViewModel, onPrivacy: () -> Unit) {
    val k = LocalKgp.current
    BackHandler { vm.closeLogin() }
    Column(
        Modifier.fillMaxSize().background(k.bg).statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(24.dp).testTag("login"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(Modifier.padding(top = 24.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(k.primary), contentAlignment = Alignment.Center) { Sym("location_on", size = 32.sp, color = k.onPrimary, fill = true) }
            Spacer(Modifier.width(14.dp))
            Text("Красноярск", fontSize = 13.sp, color = k.fg2)
        }
        Text("Карта городских проблем", fontFamily = Unbounded, fontSize = 26.sp, lineHeight = 30.sp, color = k.fg, modifier = Modifier.semantics { heading() })
        Text(reason.ifEmpty { "Войдите, чтобы сообщать о проблемах, поддерживать обращения соседей и получать уведомления о статусе." }, color = k.fg2)
        ProviderButton("VK", "Войти через VK ID", Color(0xFF0077FF), soon(s, "vk", vm)) { vm.providerLogin("vk") }
        ProviderButton("Я", "Войти через Яндекс ID", Color(0xFFFC3F1D), soon(s, "yandex", vm)) { vm.providerLogin("yandex") }
        if (BuildConfig.DEMO_LOGIN_ENABLED) KBtn("Демо-вход без аккаунта", { vm.demoLogin() }, Modifier.fillMaxWidth().testTag("demo-login"), kind = BtnKind.TONAL, icon = "science")
        KBtn("Продолжить без входа", { vm.closeLogin() }, Modifier.fillMaxWidth().testTag("skip-login"), kind = BtnKind.TEXT)
        Text("Публично показывается только ваш никнейм. Перед первым входом вы отдельно дадите согласие на обработку данных.", fontSize = 12.sp, color = k.fg3)
        KBtn("Политика обработки персональных данных", onPrivacy, kind = BtnKind.TEXT, icon = "policy")
    }
}

private fun soon(s: UiState, p: String, vm: MainViewModel): String? =
    if (vm.providerAvailable(p)) null else if (s.isDemo) "нужен сервер" else "скоро"

@Composable
private fun ProviderButton(mark: String, text: String, color: Color, badge: String?, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(color)
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x38FFFFFF)), contentAlignment = Alignment.Center) {
            Text(mark, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
        }
        Spacer(Modifier.width(10.dp))
        Text(text, color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        if (badge != null) Text(badge, color = Color.White, fontSize = 11.sp, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Color(0x33FFFFFF)).padding(horizontal = 6.dp, vertical = 2.dp))
    }
}

/** Nickname and the separate PD consent (152-ФЗ) after the first sign-in. */
@Composable
fun ProfileForm(vm: MainViewModel, onPrivacy: () -> Unit) {
    val k = LocalKgp.current
    var nick by rememberSaveable { mutableStateOf("житель_${Random.nextInt(100, 1000)}") }
    var consent by rememberSaveable { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = { },
        title = { Text("Придумайте никнейм") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Он будет виден на карте вместо имени. Реальные имя, телефон и почта не публикуются.", fontSize = 13.sp, color = k.fg2)
                OutlinedTextField(nick, { nick = it.take(24) }, label = { Text("Никнейм") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("nick"), colors = KTextFieldColors())
                Text("От 3 до 24 символов: буквы, цифры, пробел, _ . -", fontSize = 12.sp, color = k.fg3)
                Row(Modifier.clickable(role = Role.Checkbox) { consent = !consent }.testTag("consent"), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = consent, onCheckedChange = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Даю согласие на обработку персональных данных (152-ФЗ)", fontSize = 13.sp, color = k.fg)
                }
                KBtn("Политика обработки персональных данных", onPrivacy, kind = BtnKind.TEXT)
            }
        },
        confirmButton = { KBtn("Войти", { vm.completeProfile(nick, consent) }, Modifier.testTag("do-login")) },
        dismissButton = { KBtn("Отмена", { vm.cancelProfile() }, kind = BtnKind.OUTLINE) },
    )
}

@Composable
fun PrivacyDialog(vm: MainViewModel, onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        text = { Column(Modifier.verticalScroll(rememberScrollState())) { PrivacyContent(vm.privacyText) } },
        confirmButton = { KBtn("Понятно", onClose) },
    )
}
