package ru.sfu.kgp

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import ru.sfu.kgp.data.DemoBackend
import ru.sfu.kgp.domain.AppException
import ru.sfu.kgp.domain.AuthState
import ru.sfu.kgp.domain.NewComplaint
import ru.sfu.kgp.domain.Status

/** Business rules of the standalone mode mirror the server (supabase/tests). */
class DemoBackendTest {
    private lateinit var b: DemoBackend

    @Before fun setUp() = runTest {
        b = DemoBackend(null)
        assertEquals(AuthState.Guest, b.init())
    }

    private suspend fun login() {
        b.signInDemo()
        b.completeProfile("тест", true)
    }

    private fun nc(id: String, lat: Double = 56.0) = NewComplaint(id, "road", "Яма у подъезда $id", "", lat, 92.8, "адрес", "", emptyList())

    private suspend fun expectCode(code: String, block: suspend () -> Unit) {
        try { block(); fail("expected $code") } catch (e: AppException) { assertEquals(code, e.code) }
    }

    @Test fun seedHas15DemoComplaints() = runTest {
        assertEquals(15, b.feed().size)
        assertTrue(b.feed().all { it.demo })
    }

    @Test fun guestCannotAct() = runTest {
        expectCode("KGP_AUTH") { b.setSupport("demo-8", true) }
    }

    @Test fun consentIsRequired() = runTest {
        b.signInDemo()
        expectCode("KGP_CONSENT") { b.completeProfile("тест", false) }
        assertTrue(b.completeProfile("тест", true) is AuthState.SignedIn)
    }

    @Test fun supportAndOwnComplaint() = runTest {
        login()
        assertEquals(48, b.setSupport("demo-8", true))
        assertEquals(48, b.setSupport("demo-8", true))
        assertEquals(47, b.setSupport("demo-8", false))
        expectCode("KGP_OWN") { b.setSupport("demo-4", true) }
    }

    @Test fun createIsIdempotentAndLimitedToFivePerHour() = runTest {
        login()
        assertEquals("c1", b.createComplaint(nc("c1")))
        assertEquals("c1", b.createComplaint(nc("c1")))
        (2..5).forEach { b.createComplaint(nc("c$it")) }
        expectCode("KGP_RATE_LIMIT") { b.createComplaint(nc("c6")) }
    }

    @Test fun pointOutsideTheCityIsRejected() = runTest {
        login()
        expectCode("KGP_OUT_OF_CITY") { b.createComplaint(nc("far", lat = 55.5)) }
    }

    @Test fun threeConfirmationsResolveAndNotFixedReopens() = runTest {
        login()
        // demo-4 is resolved_wait with one confirmation
        val (st, n) = b.confirm("demo-4", true)
        assertEquals(Status.RESOLVED_WAIT to 2, st to n)
        assertEquals(Status.PUBLISHED to 0, b.confirm("demo-4", false))
        expectCode("KGP_STATUS") { b.confirm("demo-5", true) }
    }

    @Test fun moderatorFlowNotifiesAuthor() = runTest {
        login()
        b.createComplaint(nc("m1"))
        expectCode("KGP_FORBIDDEN") { b.moderateStatus("m1", Status.PUBLISHED) }
        b.setModerator(true)
        b.moderateStatus("m1", Status.PUBLISHED)
        assertEquals(Status.PUBLISHED, b.complaint("m1")!!.status)
        assertTrue(b.notifications().any { "опубликовано" in it.text })
        assertEquals(2, b.complaint("m1")!!.history.size)
    }

    @Test fun deleteAccountRemovesOwnData() = runTest {
        login()
        b.createComplaint(nc("d1"))
        b.deleteAccount()
        assertEquals(null, b.complaint("d1"))
        assertEquals(AuthState.Guest, b.init())
    }
}
