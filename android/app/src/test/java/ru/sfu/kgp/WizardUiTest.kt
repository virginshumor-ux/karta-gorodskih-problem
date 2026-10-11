package ru.sfu.kgp

import androidx.activity.ComponentActivity
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.lifecycle.SavedStateHandle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import ru.sfu.kgp.data.ThemeMode
import ru.sfu.kgp.ui.CreateViewModel
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.WizardDraft
import ru.sfu.kgp.ui.screens.CreateScreen
import ru.sfu.kgp.ui.theme.KgpTheme

/** Compose UI tests of the create wizard (Robolectric, no emulator needed). */
@RunWith(RobolectricTestRunner::class)
class WizardUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun setUp(draft: WizardDraft = WizardDraft()): Pair<AppContainer, CreateViewModel> {
        val c = testContainer(rule.activity)
        runBlocking { c.backend.init(); c.backend.signInDemo(); c.backend.completeProfile("тест", true) }
        val handle = SavedStateHandle().apply { set(CreateViewModel.KEY, Json.encodeToString(WizardDraft.serializer(), draft)) }
        val main = MainViewModel(c)
        val vm = CreateViewModel(c, handle) { main.state.value.complaints }
        rule.setContent {
            val state by main.state.collectAsState()
            KgpTheme(ThemeMode.LIGHT) {
                CreateScreen(vm, main, state, c.http, c.photos, onExit = {}, onOpen = {}, onAppeal = {}, onMap = {})
            }
        }
        return c to vm
    }

    @Test fun photoStepRequiresAPhoto() {
        setUp()
        rule.onNodeWithText("Сфотографируйте проблему").assertIsDisplayed()
        rule.onNodeWithTag("next").assertIsNotEnabled()
        rule.onNodeWithTag("demo-photo").performClick()
        rule.waitForIdle()
        rule.onNode(hasContentDescription("Удалить фото 1")).assertExists()
        rule.onNodeWithTag("next").assertIsEnabled()
    }

    @Test fun categoryDescriptionCheckAndSend() {
        val (c, _) = setUp(WizardDraft(step = 2, photos = listOf(testPhoto()), lat = 56.00602, lng = 92.80505, address = "Сопочная улица, 54А"))
        rule.onNodeWithText("Выберите категорию").assertIsDisplayed()
        rule.onNodeWithTag("next").assertIsNotEnabled()
        rule.onNodeWithTag("cat-snow").performClick()
        rule.onNodeWithTag("next").performClick()

        rule.onNodeWithText("Опишите проблему").assertIsDisplayed()
        rule.onNodeWithTag("title").performTextInput("Тест")
        rule.onNodeWithTag("next").assertIsNotEnabled()
        rule.onNodeWithTag("title").performTextReplacement("Тротуар не чищен у остановки")
        rule.onNodeWithTag("description").performTextInput("Проверка описания")
        rule.onNodeWithTag("desc-count").assertTextContains("17 / 500")
        rule.onNodeWithTag("next").performClick()

        // Duplicate within 30 m: demo «Не убран тротуар после снегопада» (same category)
        rule.waitUntil(5_000) { rule.onAllNodesWithTagExists("dup") }
        rule.onNodeWithTag("next").assertTextContains("Всё равно отправить")
        rule.onNodeWithTag("next").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTextExists("Обращение отправлено на модерацию") }
        runBlocking { assert(c.backend.feed().any { it.title == "Тротуар не чищен у остановки" }) }
    }

    private fun testPhoto(): String = ru.sfu.kgp.data.Photos(ApplicationProvider.getApplicationContext()).demoPhoto().absolutePath
}

private fun androidx.compose.ui.test.junit4.ComposeTestRule.onAllNodesWithTagExists(tag: String) =
    onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()

private fun androidx.compose.ui.test.junit4.ComposeTestRule.onAllNodesWithTextExists(text: String) =
    onAllNodes(androidx.compose.ui.test.hasText(text)).fetchSemanticsNodes().isNotEmpty()

/** Lifecycle requirement: the wizard survives Activity recreation (rotation, config change). */
@RunWith(RobolectricTestRunner::class)
class RecreationTest {
    @get:Rule val rule = createEmptyComposeRule()

    @Test fun wizardDraftSurvivesActivityRecreation() {
        val app = ApplicationProvider.getApplicationContext<KgpApp>()
        app.container.settings.onboarded = true
        runBlocking { app.container.backend.init(); app.container.backend.signInDemo(); app.container.backend.completeProfile("тест", true) }
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            rule.waitForIdle()
            rule.onNodeWithTag("nav-create").performClick()
            rule.waitUntil(5_000) { rule.onAllNodesWithTagExists("demo-photo") }
            rule.onNodeWithTag("demo-photo").performClick()
            rule.waitForIdle()
            rule.onNode(hasContentDescription("Удалить фото 1")).assertExists()

            scenario.recreate()
            rule.waitForIdle()

            rule.onNodeWithText("Сфотографируйте проблему").assertIsDisplayed()
            rule.onNode(hasContentDescription("Удалить фото 1")).assertExists()
            rule.onNodeWithTag("next").assertIsEnabled()
        }
    }
}
