package ru.sfu.kgp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.DEFAULT_CATS
import ru.sfu.kgp.domain.Filter
import ru.sfu.kgp.domain.Krsk
import ru.sfu.kgp.domain.Period
import ru.sfu.kgp.domain.Status
import ru.sfu.kgp.domain.StatusFilter
import ru.sfu.kgp.domain.WeatherData
import ru.sfu.kgp.domain.Wmo
import ru.sfu.kgp.domain.appealText
import ru.sfu.kgp.domain.distM
import ru.sfu.kgp.domain.filterComplaints
import ru.sfu.kgp.domain.fmtDay
import ru.sfu.kgp.domain.iceRisk
import ru.sfu.kgp.domain.plural
import ru.sfu.kgp.domain.toAppException
import ru.sfu.kgp.map.TILE_SOURCES
import ru.sfu.kgp.map.isBlockedPixels
import java.io.IOException
import javax.imageio.ImageIO

/** Same rules as the site (web/tests/unit): appeal text, filters, ice risk, tile stub detection. */
class DomainTest {
    private val now = 1_793_000_000_000L
    private val road = DEFAULT_CATS.first { it.id == "road" }

    private fun c(id: String, status: Status, mine: Boolean = false, cat: String = "road", ago: Long = 1000, district: String = "Октябрьский район", title: String = "Яма на въезде во двор") =
        Complaint(id, false, title, cat, "Яма около 40 см.", 55.9952, 92.7965, "улица Борисова, 5", district, status, null, now - ago, now, emptyList(), "житель_1", mine, 12)

    @Test fun appealTextMatchesPrototype() {
        val x = c("x", Status.PUBLISHED)
        assertEquals(
            "Прошу принять меры по проблеме «Яма на въезде во двор».\n\n" +
                "Категория: Дороги и ямы.\n" +
                "Адрес: г. Красноярск, улица Борисова, 5 (Октябрьский район).\n" +
                "Координаты: 55.99520, 92.79650.\n" +
                "Дата обнаружения: ${fmtDay(x.createdAt)}.\n\n" +
                "Яма около 40 см.\n\n" +
                "Проблему подтвердили 13 жителей в приложении «Карта городских проблем».",
            appealText(x, road),
        )
        assertTrue(appealText(x.copy(district = ""), road).contains("(район не определён)"))
        assertTrue(appealText(x, road, "https://site/#/c/x").contains("Фото и подробности: https://site/#/c/x\n\n"))
    }

    @Test fun pluralForms() {
        assertEquals(listOf("житель", "жителя", "жителей", "жителей", "житель"), listOf(1, 3, 5, 11, 21).map { plural(it, "житель", "жителя", "жителей") })
    }

    @Test fun filters() {
        val list = listOf(
            c("pub", Status.PUBLISHED, ago = 1000),
            c("work", Status.WORK, cat = "snow", ago = 2000, title = "Наледь"),
            c("res", Status.RESOLVED, ago = 40L * 86_400_000, district = "Центральный район"),
            c("mod-other", Status.MODERATION),
            c("mod-mine", Status.MODERATION, mine = true, ago = 500),
            c("dup", Status.DUPLICATE),
            c("rej", Status.REJECTED),
        )
        fun ids(f: Filter, q: String = "", mod: Boolean = false) = filterComplaints(list, f, q, mod, { id -> DEFAULT_CATS.first { it.id == id }.name }, now).map { it.id }
        assertEquals(listOf("mod-mine", "pub", "work"), ids(Filter()))
        assertTrue("mod-other" in ids(Filter(), mod = true))
        assertEquals(listOf("res"), ids(Filter(status = StatusFilter.RESOLVED)))
        assertFalse("dup" in ids(Filter(status = StatusFilter.ALL)))
        assertEquals(listOf("work"), ids(Filter(cats = setOf("snow"))))
        assertEquals(listOf("work"), ids(Filter(), "наледь"))
        assertEquals(listOf("res"), ids(Filter(status = StatusFilter.ALL, district = "Центральный район")))
        assertFalse("res" in ids(Filter(status = StatusFilter.ALL, period = Period.MONTH)))
    }

    @Test fun cityAndDistance() {
        assertTrue(Krsk.inCity(56.0, 92.8))
        assertFalse(Krsk.inCity(55.5, 92.8))
        assertEquals(20, distM(56.0042, 92.7735, 56.0042 + 0.00018, 92.7735).toInt() + 0)
    }

    private fun w(t: Double, code: Int, precipitation: Double = 0.0, hourly: List<Double> = listOf(t)) = WeatherData(
        WeatherData.Current("2026-11-02T08:00", t, t, 80, code, 3.0, precipitation, 1),
        WeatherData.Hourly(hourly.map { "2026-11-02T08:00" }, hourly, hourly.map { code }),
        WeatherData.Daily(emptyList(), emptyList(), emptyList(), emptyList()),
    )

    @Test fun iceRiskRules() {
        assertNull(iceRisk(null))
        assertTrue(iceRisk(w(-8.0, 66))!!.startsWith("Ледяной дождь"))
        assertTrue(iceRisk(w(1.0, 61, 0.4))!!.contains("возможен гололёд"))
        assertTrue(iceRisk(w(-1.0, 3, 0.0, listOf(-1.0, 0.5, 2.0)))!!.contains("возможен гололёд"))
        assertNull(iceRisk(w(-2.0, 3, 0.0, listOf(-2.0, -3.0))))
        assertTrue(iceRisk(w(-15.0, 73))!!.startsWith("Снегопад"))
        assertNull(iceRisk(w(-20.0, 0)))
        assertEquals("Сильный снег", Wmo.text(75))
        assertEquals("clear_night", Wmo.icon(0, false))
    }

    @Test fun blockedTileIsRecognizedByPixels() {
        val img = ImageIO.read(javaClass.classLoader!!.getResourceAsStream("blocked_tile.png"))
        val px = IntArray(128 * 128) { i -> img.getRGB((i % 128) * img.width / 128, (i / 128) * img.height / 128) }
        assertTrue(isBlockedPixels(px))
        val normal = IntArray(128 * 128) { i -> if (i % 977 == 0) 0xFF282828.toInt() else 0xFFF2EFE9.toInt() }
        assertFalse(isBlockedPixels(normal))
        assertEquals(listOf("OSM", "OSMDE", "OSMFR"), TILE_SOURCES.map { it.id })
        assertTrue(TILE_SOURCES.none { it.urls.any { u -> "carto" in u } })
    }

    @Test fun errorsAreMappedToRussianMessages() {
        assertTrue(IOException("x").toAppException().offline)
        val e = RuntimeException("""{"code":"P0001","message":"KGP_RATE_LIMIT: Можно отправить не более 5 обращений в час"}""").toAppException()
        assertEquals("KGP_RATE_LIMIT", e.code)
        assertTrue(e.message!!.contains("не более 5 обращений в час"))
    }
}
