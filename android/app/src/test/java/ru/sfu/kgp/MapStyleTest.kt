package ru.sfu.kgp

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.sfu.kgp.map.TILE_SOURCES
import ru.sfu.kgp.map.rasterStyleJson
import ru.sfu.kgp.map.snapshotStyleJson
import ru.sfu.kgp.map.vectorStyleJson

/** The map styles are hand-written JSON: they must parse and keep the layer set of the site's style. */
class MapStyleTest {
    private fun parse(s: String): JsonObject = Json.parseToJsonElement(s).jsonObject

    @Test fun vectorStylesAreValidJson() {
        for (dark in listOf(false, true)) {
            val st = parse(vectorStyleJson(dark))
            assertEquals(8, st["version"]!!.jsonPrimitive.content.toInt())
            val ids = st["layers"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content }
            assertEquals(19, ids.size)
            assertTrue(ids.containsAll(listOf("land", "water", "road-major", "place-city")))
            assertTrue(st["sources"]!!.jsonObject.containsKey("omt"))
        }
    }

    @Test fun fallbackStylesAreValidJson() {
        val r = parse(rasterStyleJson(TILE_SOURCES.first(), false))
        assertTrue(r["sources"]!!.jsonObject["r"]!!.jsonObject["tiles"]!!.jsonArray.first().jsonPrimitive.content.endsWith("{z}/{x}/{y}.png"))
        val s = parse(snapshotStyleJson(true))
        assertEquals(3, s["layers"]!!.jsonArray.size)
        assertTrue(s["sources"]!!.jsonObject["s0"]!!.jsonObject["url"]!!.jsonPrimitive.content.startsWith("asset://"))
    }
}
