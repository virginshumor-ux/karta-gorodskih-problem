package ru.sfu.kgp.ui

import android.Manifest
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.delay
import ru.sfu.kgp.AppContainer
import ru.sfu.kgp.ui.screens.AboutScreen
import ru.sfu.kgp.ui.screens.AppealScreen
import ru.sfu.kgp.ui.screens.CreateScreen
import ru.sfu.kgp.ui.screens.DetailScreen
import ru.sfu.kgp.ui.screens.ListScreen
import ru.sfu.kgp.ui.screens.LoginOverlay
import ru.sfu.kgp.ui.screens.MapScreen
import ru.sfu.kgp.ui.screens.NotificationsScreen
import ru.sfu.kgp.ui.screens.Onboarding
import ru.sfu.kgp.ui.screens.PrivacyDialog
import ru.sfu.kgp.ui.screens.PrivacyScreen
import ru.sfu.kgp.ui.screens.ProfileForm
import ru.sfu.kgp.ui.screens.ProfileScreen
import ru.sfu.kgp.ui.screens.StatsScreen
import ru.sfu.kgp.ui.screens.WeatherScreen
import ru.sfu.kgp.ui.theme.LocalKgp

object Routes {
    const val MAP = "map"
    const val LIST = "list"
    const val CREATE = "create"
    const val NOTIF = "notif"
    const val PROFILE = "profile"
    const val STATS = "stats"
    const val WEATHER = "weather"
    const val ABOUT = "about"
    const val PRIVACY = "privacy"
    const val DETAIL = "detail/{id}"
    const val APPEAL = "appeal/{id}"
    fun detail(id: String) = "detail/$id"
    fun appeal(id: String) = "appeal/$id"
}

private val TABS = listOf(
    Triple(Routes.MAP, "map", "Карта"),
    Triple(Routes.LIST, "format_list_bulleted", "Список"),
    Triple(Routes.CREATE, "add_a_photo", ""),
    Triple(Routes.NOTIF, "notifications", "Уведомления"),
    Triple(Routes.PROFILE, "person", "Профиль"),
)

fun NavHostController.tab(route: String) = navigate(route) {
    popUpTo(Routes.MAP) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

@Composable
fun KgpRoot(container: AppContainer, vm: MainViewModel, nav: NavHostController = rememberNavController()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val k = LocalKgp.current
    val context = LocalContext.current
    var toast by remember { mutableStateOf<String?>(null) }
    var privacyDialog by rememberSaveable { mutableStateOf(false) }
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    LaunchedEffect(vm) {
        vm.toasts.collect {
            toast = it
            delay(3200)
            if (toast == it) toast = null
        }
    }
    LaunchedEffect(vm) {
        vm.nav.collect { e ->
            when (e) {
                is NavEvent.Detail -> nav.navigate(Routes.detail(e.id))
                NavEvent.Create -> nav.navigate(Routes.CREATE)
                NavEvent.Back -> nav.popBackStack()
                NavEvent.Map -> nav.tab(Routes.MAP)
                is NavEvent.OpenUrl -> runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(e.url)) }
                    .onFailure { vm.toast("Не найден браузер для входа") }
            }
        }
    }
    // Ф-11: local notifications need the runtime permission on Android 13+; asked once the user signs in.
    LaunchedEffect(s.user?.id) {
        if (s.user != null && Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    val back by nav.currentBackStackEntryAsState()
    val route = back?.destination?.route ?: Routes.MAP
    val showNav = route in setOf(Routes.MAP, Routes.LIST, Routes.NOTIF, Routes.PROFILE, Routes.DETAIL)
    val open: (String) -> Unit = { nav.navigate(Routes.detail(it)) }

    Box(Modifier.fillMaxSize().background(k.bg)) {
        NavHost(nav, startDestination = Routes.MAP, modifier = Modifier.fillMaxSize()) {
            composable(Routes.MAP) { MapScreen(s, vm, container.http, open, { nav.tab(Routes.LIST) }, { nav.navigate(Routes.WEATHER) }) }
            composable(Routes.LIST) { ListScreen(s, vm, open) { nav.tab(Routes.MAP) } }
            composable(Routes.NOTIF) { NotificationsScreen(s, vm) }
            composable(Routes.PROFILE) {
                ProfileScreen(s, vm, open, { nav.navigate(Routes.STATS) }, { nav.navigate(Routes.WEATHER) }, { nav.navigate(Routes.ABOUT) }, { nav.navigate(Routes.PRIVACY) })
            }
            composable(Routes.STATS) { StatsScreen(s, vm) { nav.popBackStack() } }
            composable(Routes.WEATHER) { WeatherScreen(s, vm) { nav.popBackStack() } }
            composable(Routes.ABOUT) { AboutScreen(vm, { nav.popBackStack() }) { nav.navigate(Routes.PRIVACY) } }
            composable(Routes.PRIVACY) { PrivacyScreen(vm) { nav.popBackStack() } }
            composable(Routes.DETAIL) { e ->
                val id = e.arguments?.getString("id").orEmpty()
                DetailScreen(id, s, vm, container.http, container.photos, { nav.popBackStack() }, { nav.navigate(Routes.appeal(id)) }, open)
            }
            composable(Routes.APPEAL) { e -> AppealScreen(e.arguments?.getString("id").orEmpty(), s, vm) { nav.popBackStack() } }
            composable(Routes.CREATE) {
                val cvm: CreateViewModel = viewModel(factory = CreateViewModel.factory(container) { vm.state.value.complaints })
                CreateScreen(
                    cvm, vm, s, container.http, container.photos,
                    onExit = { nav.popBackStack() },
                    onOpen = { id -> nav.popBackStack(); open(id) },
                    onAppeal = { id -> nav.popBackStack(); nav.navigate(Routes.appeal(id)) },
                    onMap = { nav.popBackStack(); nav.tab(Routes.MAP) },
                )
            }
        }
        if (showNav) BottomNav(route, s.unread, Modifier.align(Alignment.BottomCenter)) { r ->
            if (r == Routes.CREATE) vm.requestCreate() else if (r == Routes.MAP && route == Routes.MAP) vm.select(null) else nav.tab(r)
        }
        AnimatedVisibility(toast != null, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 100.dp).navigationBarsPadding()) {
            Text(
                toast.orEmpty(), color = k.bg, fontSize = 14.sp,
                modifier = Modifier.padding(horizontal = 16.dp).widthIn(max = 480.dp).shadow(8.dp, RoundedCornerShape(12.dp)).clip(RoundedCornerShape(12.dp))
                    .background(k.fg).padding(horizontal = 18.dp, vertical = 12.dp).semantics { liveRegion = LiveRegionMode.Polite }.testTag("toast"),
            )
        }
        s.onboardingStep?.let { Onboarding(it, vm) }
        if (s.onboardingStep == null && s.login != null) LoginOverlay(s.login.orEmpty(), s, vm) { privacyDialog = true }
        if (s.profileForm) ProfileForm(vm) { privacyDialog = true }
        if (privacyDialog) PrivacyDialog(vm) { privacyDialog = false }
    }
}

@Composable
private fun BottomNav(route: String, unread: Int, modifier: Modifier, onTab: (String) -> Unit) {
    val k = LocalKgp.current
    val current = if (route == Routes.DETAIL) Routes.MAP else route
    Row(
        modifier.fillMaxWidth().background(k.surface).border(1.dp, k.line).navigationBarsPadding().padding(horizontal = 4.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.Bottom,
    ) {
        TABS.forEach { (r, icon, label) ->
            if (r == Routes.CREATE) {
                Box(
                    Modifier.offset(y = (-14).dp).size(56.dp).shadow(4.dp, RoundedCornerShape(18.dp)).clip(RoundedCornerShape(18.dp)).background(k.accent)
                        .clickable(onClickLabel = "Сообщить о проблеме", role = Role.Button) { onTab(r) }.semantics { contentDescription = "Сообщить о проблеме" }.testTag("nav-create"),
                    contentAlignment = Alignment.Center,
                ) { Sym(icon, size = 30.sp, color = k.onAccent) }
            } else {
                val on = current == r
                Column(
                    Modifier.weight(1f).clickable(role = Role.Tab) { onTab(r) }.semantics { selected = on }.padding(vertical = 4.dp).testTag("nav-$r"),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box {
                        Box(Modifier.size(56.dp, 30.dp).clip(RoundedCornerShape(15.dp)).background(if (on) k.primarySoft else k.surface), contentAlignment = Alignment.Center) {
                            Sym(icon, color = if (on) k.primary else k.fg2, fill = on)
                        }
                        if (r == Routes.NOTIF && unread > 0) Text(
                            "$unread", color = k.onAccent, fontSize = 10.sp,
                            modifier = Modifier.align(Alignment.TopEnd).offset(x = 2.dp).clip(RoundedCornerShape(8.dp)).background(k.accent).padding(horizontal = 4.dp)
                                .semantics { contentDescription = "$unread непрочитанных" },
                        )
                    }
                    Text(label, fontSize = 12.sp, color = if (on) k.fg else k.fg2, modifier = Modifier.height(16.dp))
                }
            }
        }
    }
}
