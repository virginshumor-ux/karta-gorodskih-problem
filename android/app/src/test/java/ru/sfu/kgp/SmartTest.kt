package ru.sfu.kgp

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import ru.sfu.kgp.data.DemoBackend
import ru.sfu.kgp.domain.AirData
import ru.sfu.kgp.domain.AppException
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.HomeArea
import ru.sfu.kgp.domain.Provider
import ru.sfu.kgp.domain.Role
import ru.sfu.kgp.domain.Sort
import ru.sfu.kgp.domain.Status
import ru.sfu.kgp.domain.User
import ru.sfu.kgp.domain.UserStats
import ru.sfu.kgp.domain.WeatherData
import ru.sfu.kgp.domain.achievements
import ru.sfu.kgp.domain.aqiLevel
import ru.sfu.kgp.domain.cityWarnings
import ru.sfu.kgp.domain.fmtDistance
import ru.sfu.kgp.domain.sortComplaints
import ru.sfu.kgp.domain.suggestCategory
import ru.sfu.kgp.domain.windDir

/** v1.1 features — the same cases as web/tests/unit/smart.test.ts and weather.test.ts. */
class SmartTest {
    private fun c(id: String, created: Long = 0, supports: Int = 0, lat: Double = 56.0, lng: Double = 92.8, mine: Boolean = false, cat: String = "road", district: String = "Октябрьский район", status: Status = Status.PUBLISHED) =
        Complaint(id, false, "Яма", cat, "", lat, lng, "адрес", district, status, createdAt = created, updatedAt = created, author = "житель", mine = mine, supports = supports)

    private fun user(stats: UserStats = UserStats()) = User("u", "житель", Provider.DEMO, Role.USER, true, false, stats)

    @Test fun suggestsCategoryFromText() {
        assertEquals("road", suggestCategory("Большая яма на дороге у остановки"))
        assertEquals("light", suggestCategory("Не горит фонарь во дворе"))
        assertEquals("ice", suggestCategory("Сосульки на крыше над входом"))
        assertEquals("snow", suggestCategory("ГОЛОЛЁД НА ПЕРЕХОДЕ"))
        assertNull(suggestCategory("Проблема"))
    }

    @Test fun sortsComplaints() {
        val a = c("a", 1000, 5, 56.01)
        val b = c("b", 3000, 1, 56.1, 92.9)
        val d = c("d", 2000, 5, 56.0)
        assertEquals(listOf("b", "d", "a"), sortComplaints(listOf(a, b, d), Sort.NEW, null).map { it.id })
        assertEquals(listOf("d", "a", "b"), sortComplaints(listOf(a, b, d), Sort.POPULAR, null).map { it.id })
        assertEquals(listOf("d", "a", "b"), sortComplaints(listOf(a, b, d), Sort.NEAR, 56.0 to 92.8).map { it.id })
        assertEquals(listOf("b", "d", "a"), sortComplaints(listOf(a, b, d), Sort.NEAR, null).map { it.id })
    }

    @Test fun formatsDistance() {
        assertEquals("10 м", fmtDistance(3.0))
        assertEquals("350 м", fmtDistance(347.0))
        assertEquals("1,5 км", fmtDistance(1530.0))
        assertEquals("23 км", fmtDistance(23_400.0))
    }

    @Test fun computesAchievements() {
        assertTrue(achievements(user(), emptyList()).none { it.done })
        val mine = listOf(
            c("1", mine = true, cat = "snow"),
            c("2", mine = true, cat = "ice", district = "Центральный район"),
            c("3", mine = true, cat = "snow", status = Status.RESOLVED),
        )
        val by = achievements(user(UserStats(complaints = 3, supported = 10, comments = 2)), mine).associateBy { it.id }
        assertTrue(by.getValue("first").done)
        assertEquals(3, by.getValue("active").progress)
        assertFalse(by.getValue("active").done)
        assertTrue(by.getValue("neighbour").done)
        assertTrue(by.getValue("winter").done)
        assertTrue(by.getValue("result").done)
        assertTrue(by.getValue("explorer").done)
        assertEquals(2, by.getValue("voice").progress)
    }

    private fun w(t: Double, code: Int, gusts: Double? = null) = WeatherData(
        WeatherData.Current("2026-11-02T08:00", t, t, 80, code, 3.0, 0.0, 1, gusts = gusts),
        WeatherData.Hourly(listOf("2026-11-02T08:00"), listOf(t), listOf(code)),
        WeatherData.Daily(emptyList(), emptyList(), emptyList(), emptyList()),
    )

    private fun air(aqi: Double) = AirData(AirData.Current("2026-11-02T08:00", aqi, 5.0, 10.0))

    @Test fun airQualityAndWarnings() {
        assertEquals(listOf("good", "fair", "moderate", "poor", "verypoor", "extreme"), listOf(10.0, 35.0, 55.0, 75.0, 95.0, 140.0).map { aqiLevel(it).key })
        assertTrue(aqiLevel(75.0).advice.contains("чёрного неба"))
        assertEquals(listOf("С", "В", "ЮЗ", "С", ""), listOf(0.0, 92.0, 225.0, 359.0, null).map { windDir(it) })
        assertTrue(cityWarnings(w(-5.0, 0), air(15.0)).isEmpty())
        assertEquals(listOf("warning", "air", "ac_unit", "masks"), cityWarnings(w(-27.0, 66, 18.0), air(85.0)).map { it.icon })
        assertEquals(listOf("sunny"), cityWarnings(w(32.0, 0)).map { it.icon })
    }

    @Test fun demoCommentsAndHomeArea() = runTest {
        val b = DemoBackend(null)
        b.init()
        assertEquals(3, b.comments("demo-8").size)
        assertEquals(3, b.feed().first { it.id == "demo-8" }.comments)
        try { b.addComment("demo-8", "гость"); fail() } catch (e: AppException) { assertEquals("KGP_AUTH", e.code) }
        b.signInDemo()
        b.completeProfile("тест", true)
        b.addComment("demo-8", "  Сегодня   мусора стало больше  ")
        val mine = b.comments("demo-8").last()
        assertEquals("Сегодня мусора стало больше", mine.text)
        assertTrue(mine.mine)
        assertEquals(4, b.complaint("demo-8")!!.comments)
        try { b.deleteComment(b.comments("demo-8").first().id); fail() } catch (e: AppException) { assertEquals("KGP_NOT_ALLOWED", e.code) }
        b.deleteComment(mine.id)
        assertEquals(3, b.comments("demo-8").size)
        try { b.addComment("demo-8", "   "); fail() } catch (e: AppException) { assertEquals("KGP_COMMENT_LENGTH", e.code) }

        try { b.setHomeArea(HomeArea(55.0, 92.8, 500)); fail() } catch (e: AppException) { assertEquals("KGP_OUT_OF_CITY", e.code) }
        assertEquals(3000, b.setHomeArea(HomeArea(56.0, 92.8, 99_999)).home?.radius)
        assertNull(b.setHomeArea(null).home)
    }
}
