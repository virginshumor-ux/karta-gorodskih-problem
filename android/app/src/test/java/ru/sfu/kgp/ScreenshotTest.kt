package ru.sfu.kgp

import android.graphics.Bitmap
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.activity.ComponentActivity
import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ru.sfu.kgp.data.ThemeMode
import ru.sfu.kgp.ui.CreateViewModel
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.WizardDraft
import ru.sfu.kgp.ui.screens.CreateScreen
import ru.sfu.kgp.ui.screens.DetailScreen
import ru.sfu.kgp.ui.screens.ListScreen
import ru.sfu.kgp.ui.screens.Onboarding
import ru.sfu.kgp.ui.screens.ProfileScreen
import ru.sfu.kgp.ui.screens.StatsScreen
import ru.sfu.kgp.ui.screens.WeatherScreen
import ru.sfu.kgp.ui.theme.KgpTheme
import java.io.File

/**
 * Renders key screens to PNG (build/screenshots) for a visual comparison with docs/handoff/screenshots.
 * Run with KGP_SCREENSHOTS=1 ./gradlew testDebugUnitTest --tests '*ScreenshotTest*'.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w390dp-h844dp-xxhdpi")
class ScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun shot(name: String, theme: ThemeMode = ThemeMode.LIGHT, content: @androidx.compose.runtime.Composable (MainViewModel, AppContainer) -> Unit) {
        assumeTrue(System.getenv("KGP_SCREENSHOTS") != null)
        val c = testContainer(rule.activity)
        runBlocking { c.backend.init(); c.backend.signInDemo(); c.backend.completeProfile("житель_101", true) }
        val vm = MainViewModel(c)
        rule.setContent { KgpTheme(theme) { content(vm, c) } }
        rule.waitForIdle()
        save(name, rule.onRoot().captureToImage().asAndroidBitmap())
    }

    @Test fun onboarding() = shot("a01_onboarding") { vm, _ -> Onboarding(0, vm) }
    @Test fun list() = shot("a02_list") { vm, _ -> val s by vm.state.collectAsState(); ListScreen(s, vm, {}, {}) }
    @Test fun listDark() = shot("a03_list_dark", ThemeMode.DARK) { vm, _ -> val s by vm.state.collectAsState(); ListScreen(s, vm, {}, {}) }
    @Test fun detail() = shot("a04_detail") { vm, c -> val s by vm.state.collectAsState(); DetailScreen("demo-9", s, vm, c.http, c.photos, {}, {}, {}) }
    @Test fun profile() = shot("a05_profile") { vm, _ -> val s by vm.state.collectAsState(); ProfileScreen(s, vm, {}, {}, {}, {}, {}) }
    @Test fun stats() = shot("a06_stats") { vm, _ -> val s by vm.state.collectAsState(); StatsScreen(s, vm) {} }
    @Test fun weather() = shot("a07_weather") { vm, _ -> val s by vm.state.collectAsState(); WeatherScreen(s, vm) {} }
    @Test fun wizardCategory() {
        assumeTrue(System.getenv("KGP_SCREENSHOTS") != null)
        val c = testContainer(rule.activity)
        runBlocking { c.backend.init(); c.backend.signInDemo(); c.backend.completeProfile("житель_101", true) }
        val vm = MainViewModel(c)
        val handle = SavedStateHandle().apply { set(CreateViewModel.KEY, Json.encodeToString(WizardDraft.serializer(), WizardDraft(step = 2, category = "snow"))) }
        val wizard = CreateViewModel(c, handle) { emptyList() }
        rule.setContent {
            val s by vm.state.collectAsState()
            KgpTheme(ThemeMode.LIGHT) { CreateScreen(wizard, vm, s, c.http, c.photos, {}, {}, {}, {}) }
        }
        rule.waitForIdle()
        save("a08_wizard_category", rule.onRoot().captureToImage().asAndroidBitmap())
    }

    private fun save(name: String, bmp: Bitmap) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
