package ru.sfu.kgp

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import ru.sfu.kgp.data.DemoBackend
import ru.sfu.kgp.data.SubmitResult
import ru.sfu.kgp.domain.AuthState
import ru.sfu.kgp.domain.NewComplaint
import ru.sfu.kgp.domain.StatusFilter
import ru.sfu.kgp.ui.CreateViewModel
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.WizardDraft

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class ViewModelTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun tearDown() = Dispatchers.resetMain()

    private fun idle() = org.robolectric.shadows.ShadowLooper.idleMainLooper()

    @Test fun mainLoadsFeedAndFilters() = runTest {
        val vm = MainViewModel(testContainer(ctx))
        idle()
        val s = vm.state.value
        assertEquals(15, s.complaints.size)
        assertFalse(s.loading)
        // «Актуальные» by default: no resolved, no moderation of others
        assertTrue(s.visible.all { it.status.isOpen || it.mine })
        vm.setStatusFilter(StatusFilter.RESOLVED)
        assertEquals(2, vm.state.value.visible.size)
        vm.setSearch("Кецховели")
        vm.setStatusFilter(StatusFilter.ALL)
        assertEquals(1, vm.state.value.visible.size)
    }

    @Test fun actionRequiringLoginContinuesAfterSignIn() = runTest {
        val vm = MainViewModel(testContainer(ctx))
        idle()
        val before = vm.state.value.find("demo-8")!!.supports
        vm.runAction("support", "demo-8")
        assertNotNull("login sheet is shown", vm.state.value.login)
        vm.demoLogin(); idle()
        assertTrue(vm.state.value.profileForm)
        vm.completeProfile("житель_1", consent = false); idle()
        assertTrue("consent is mandatory", vm.state.value.auth is AuthState.NeedsProfile)
        vm.completeProfile("житель_1", consent = true); idle()
        assertTrue(vm.state.value.auth is AuthState.SignedIn)
        assertNull(vm.state.value.login)
        assertEquals("pending support was executed", before + 1, vm.state.value.find("demo-8")!!.supports)
    }

    @Test fun onboardingIsShownOnce() = runTest {
        val c = testContainer(ctx)
        val vm = MainViewModel(c)
        assertEquals(0, vm.state.value.onboardingStep)
        vm.onboardingNext(1); vm.onboardingNext(2); vm.onboardingNext(3)
        assertNull(vm.state.value.onboardingStep)
        assertEquals("", vm.state.value.login)
        assertNull(MainViewModel(c).state.value.onboardingStep)
    }

    private suspend fun signedIn(c: AppContainer) {
        c.backend.init(); c.backend.signInDemo(); c.backend.completeProfile("тест", true)
    }

    @Test fun wizardStepsAreGated() = runTest {
        val c = testContainer(ctx)
        signedIn(c)
        val vm = CreateViewModel(c, SavedStateHandle()) { emptyList() }
        assertFalse(vm.ui.value.ready)
        vm.addDemoPhoto()
        assertTrue(vm.ui.value.ready)
        vm.next {}
        assertEquals(1, vm.ui.value.draft.step)
        vm.setLocation(55.5, 92.8)
        assertTrue(vm.ui.value.geoHint.contains("за пределами Красноярска"))
        assertFalse(vm.ui.value.ready)
        assertTrue(vm.back())
        assertEquals("back keeps the photos", 1, vm.ui.value.draft.photos.size)
        assertFalse(vm.back())
    }

    @Test fun wizardDraftSurvivesRecreationThroughSavedStateHandle() = runTest {
        val c = testContainer(ctx)
        val handle = SavedStateHandle()
        val first = CreateViewModel(c, handle) { emptyList() }
        first.addDemoPhoto()
        first.setTitle("Яма у остановки")
        first.setCategory("road")
        // A new ViewModel with the same handle = Activity recreated after rotation / config change.
        val second = CreateViewModel(c, handle) { emptyList() }
        val d = second.ui.value.draft
        assertEquals(first.ui.value.draft.id, d.id)
        assertEquals("Яма у остановки", d.title)
        assertEquals("road", d.category)
        assertEquals(1, d.photos.size)
    }

    @Test fun wizardDraftSurvivesProcessDeathThroughRoom() = runTest {
        val c = testContainer(ctx)
        val first = CreateViewModel(c, SavedStateHandle()) { emptyList() }
        first.setTitle("Наледь у подъезда")
        first.persist().join()
        // Process death: the SavedStateHandle is empty, the copy saved on ON_STOP is in Room.
        val restored = CreateViewModel(c, SavedStateHandle()) { emptyList() }
        idle()
        assertEquals("Наледь у подъезда", restored.ui.value.draft.title)
    }

    @Test fun submitSendsOrSavesAnOfflineDraft() = runTest {
        val flaky = FlakyBackend()
        val c = testContainer(ctx, flaky)
        signedIn(c)
        val handle = SavedStateHandle()
        handle[CreateViewModel.KEY] = kotlinx.serialization.json.Json.encodeToString(
            WizardDraft.serializer(),
            WizardDraft(step = 4, photos = listOf(c.photos.demoPhoto().absolutePath), lat = 56.0, lng = 92.8, address = "адрес", category = "road", title = "Яма во дворе"),
        )
        flaky.offline = true
        val vm = CreateViewModel(c, handle) { emptyList() }
        idle()
        var done = false
        vm.next { done = true }
        idle()
        assertTrue(done)
        assertTrue(vm.ui.value.draft.savedOffline)
        assertEquals(1, c.repository.pendingDrafts())
        flaky.offline = false
        assertEquals(listOf("Яма во дворе"), c.repository.flushDrafts())
        assertEquals(0, c.repository.pendingDrafts())
        assertNotNull(flaky.inner.complaint(vm.ui.value.draft.id))
    }

    @Test fun repositoryServesCachedFeedOffline() = runTest {
        val flaky = FlakyBackend()
        val c = testContainer(ctx, flaky)
        c.backend.init()
        assertNull(c.repository.feed().offlineSince)
        flaky.offline = true
        val f = c.repository.feed()
        assertEquals(15, f.items.size)
        assertNotNull(f.offlineSince)
        val r = c.repository.submit(NewComplaint("x", "road", "Тестовая яма", "", 56.0, 92.8, "адрес", "", emptyList()))
        assertEquals(SubmitResult.SavedOffline, r)
    }

    @Test fun demoModeratorToggleKeepsData() = runTest {
        val c = testContainer(ctx)
        signedIn(c)
        val vm = MainViewModel(c)
        idle()
        vm.runAction("support", "demo-8"); idle()
        vm.toggleDemoModerator(); idle()
        assertTrue(vm.state.value.moderator)
        assertTrue((c.backend as DemoBackend).complaint("demo-8")!!.supportedByMe)
    }
}
