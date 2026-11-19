package ru.sfu.kgp.map

/**
 * Map styles for MapLibre Native — the same "Енисей-поп" style as the site (web/src/map/vectorStyle.ts):
 * paper land, ink road casings, sun-yellow highways, Yenisei blue water, Russian names. Vector tiles of OpenFreeMap
 * stay sharp at any zoom on any screen density. Raster and snapshot styles are the fallbacks of the same chain.
 */
const val VECTOR_TILEJSON = "https://tiles.openfreemap.org/planet"
private const val GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"
const val VECTOR_ATTR = "OpenFreeMap © OpenMapTiles · данные © участники OpenStreetMap"

private data class Pal(
    val land: String, val residential: String, val park: String, val wood: String, val water: String, val waterLine: String,
    val building: String, val buildingLine: String, val casing: String, val road: String, val roadMinor: String, val major: String,
    val rail: String, val label: String, val labelSoft: String, val halo: String, val boundary: String,
)

private val LIGHT = Pal(
    "#f1ebdd", "#ebe3d2", "#d3eba0", "#c4e08e", "#9dbbff", "#6f93f5", "#e0d6c2", "#c9bda5", "#2a2824",
    "#ffffff", "#fbf8f1", "#ffd23f", "#5c574d", "#141414", "#4a4740", "#f8f4ea", "#8b6cff",
)
private val DARK = Pal(
    "#17161c", "#1c1b22", "#1f2b18", "#22311a", "#1b2a63", "#3554c9", "#26252e", "#33323d", "#000000",
    "#3b3a46", "#2c2b34", "#7d64ff", "#6b6878", "#efe9dc", "#b8b2a6", "#141318", "#c7f25c",
)

private const val NAME = """["coalesce",["get","name:ru"],["get","name"]]"""
private fun z(vararg p: Pair<Number, Number>) = """["interpolate",["exponential",1.5],["zoom"],${p.joinToString(",") { "${it.first},${it.second}" }}]"""
private fun cls(vararg c: String) = """["match",["get","class"],[${c.joinToString(",") { "\"$it\"" }}],true,false]"""

fun backgroundColor(dark: Boolean): String = if (dark) DARK.land else LIGHT.land

fun vectorStyleJson(dark: Boolean): String {
    val p = if (dark) DARK else LIGHT
    val major = cls("motorway", "trunk", "primary")
    val mid = cls("secondary", "tertiary")
    val minor = cls("minor", "service", "track")
    return """{"version":8,"name":"kgp","glyphs":"$GLYPHS",
"sources":{"omt":{"type":"vector","url":"$VECTOR_TILEJSON"}},
"layers":[
{"id":"land","type":"background","paint":{"background-color":"${p.land}"}},
{"id":"residential","type":"fill","source":"omt","source-layer":"landuse","filter":${cls("residential", "suburb", "neighbourhood")},"paint":{"fill-color":"${p.residential}"}},
{"id":"park","type":"fill","source":"omt","source-layer":"park","paint":{"fill-color":"${p.park}"}},
{"id":"wood","type":"fill","source":"omt","source-layer":"landcover","filter":${cls("wood", "grass", "farmland")},"paint":{"fill-color":["match",["get","class"],"wood","${p.wood}","${p.park}"],"fill-opacity":0.85}},
{"id":"water","type":"fill","source":"omt","source-layer":"water","paint":{"fill-color":"${p.water}"}},
{"id":"waterway","type":"line","source":"omt","source-layer":"waterway","paint":{"line-color":"${p.waterLine}","line-width":${z(10 to 0.6, 16 to 3)}}},
{"id":"building","type":"fill","source":"omt","source-layer":"building","minzoom":14,"paint":{"fill-color":"${p.building}","fill-outline-color":"${p.buildingLine}"}},
{"id":"building-ink","type":"line","source":"omt","source-layer":"building","minzoom":16,"paint":{"line-color":"${p.buildingLine}","line-width":1}},
{"id":"road-minor","type":"line","source":"omt","source-layer":"transportation","minzoom":13,"filter":$minor,"layout":{"line-cap":"round","line-join":"round"},"paint":{"line-color":"${p.roadMinor}","line-width":${z(13 to 0.6, 17 to 7, 20 to 18)}}},
{"id":"road-casing","type":"line","source":"omt","source-layer":"transportation","filter":["any",$major,$mid],"layout":{"line-cap":"round","line-join":"round"},"paint":{"line-color":"${p.casing}","line-width":${z(8 to 0.8, 12 to 3, 16 to 14, 20 to 38)}}},
{"id":"road","type":"line","source":"omt","source-layer":"transportation","filter":$mid,"layout":{"line-cap":"round","line-join":"round"},"paint":{"line-color":"${p.road}","line-width":${z(8 to 0.4, 12 to 1.8, 16 to 10, 20 to 32)}}},
{"id":"road-major","type":"line","source":"omt","source-layer":"transportation","filter":$major,"layout":{"line-cap":"round","line-join":"round"},"paint":{"line-color":"${p.major}","line-width":${z(8 to 0.5, 12 to 2, 16 to 11, 20 to 34)}}},
{"id":"rail","type":"line","source":"omt","source-layer":"transportation","filter":["==",["get","class"],"rail"],"paint":{"line-color":"${p.rail}","line-width":${z(11 to 0.6, 17 to 2.5)},"line-dasharray":[3,2]}},
{"id":"boundary","type":"line","source":"omt","source-layer":"boundary","filter":["<=",["get","admin_level"],8],"paint":{"line-color":"${p.boundary}","line-width":1.4,"line-dasharray":[4,3],"line-opacity":0.6}},
{"id":"water-name","type":"symbol","source":"omt","source-layer":"water_name","layout":{"text-field":$NAME,"text-font":["Noto Sans Italic"],"text-size":13,"symbol-placement":"line","text-letter-spacing":0.2},"paint":{"text-color":"${p.waterLine}","text-halo-color":"${p.halo}","text-halo-width":1.4}},
{"id":"road-name","type":"symbol","source":"omt","source-layer":"transportation_name","minzoom":14,"layout":{"text-field":$NAME,"text-font":["Noto Sans Regular"],"text-size":${z(14 to 10, 18 to 14)},"symbol-placement":"line","text-max-angle":30},"paint":{"text-color":"${p.labelSoft}","text-halo-color":"${p.halo}","text-halo-width":1.6}},
{"id":"poi","type":"symbol","source":"omt","source-layer":"poi","minzoom":16,"filter":["<=",["get","rank"],18],"layout":{"text-field":$NAME,"text-font":["Noto Sans Regular"],"text-size":11,"text-max-width":8},"paint":{"text-color":"${p.labelSoft}","text-halo-color":"${p.halo}","text-halo-width":1.4}},
{"id":"place-minor","type":"symbol","source":"omt","source-layer":"place","minzoom":12,"filter":${cls("suburb", "neighbourhood", "quarter", "village", "hamlet")},"layout":{"text-field":$NAME,"text-font":["Noto Sans Bold"],"text-size":${z(12 to 11, 16 to 15)},"text-transform":"uppercase","text-letter-spacing":0.12,"text-max-width":9},"paint":{"text-color":"${p.labelSoft}","text-halo-color":"${p.halo}","text-halo-width":2}},
{"id":"place-city","type":"symbol","source":"omt","source-layer":"place","filter":${cls("city", "town")},"layout":{"text-field":$NAME,"text-font":["Noto Sans Bold"],"text-size":${z(8 to 13, 13 to 22)},"text-transform":"uppercase","text-letter-spacing":0.18},"paint":{"text-color":"${p.label}","text-halo-color":"${p.halo}","text-halo-width":2.4}}
]}"""
}

/** Raster fallback: the first working server of the osm.org → osm.de → osm.fr chain (256-px tiles). */
fun rasterStyleJson(src: TileSourceDef, dark: Boolean): String {
    val tpl = src.urls.first() + "{z}/{x}/{y}.png"
    return """{"version":8,"sources":{"r":{"type":"raster","tiles":["$tpl"],"tileSize":256,"maxzoom":${src.maxZoom}}},
"layers":[{"id":"bg","type":"background","paint":{"background-color":"${backgroundColor(dark)}"}},{"id":"r","type":"raster","source":"r","paint":{"raster-brightness-max":${if (dark) 0.75 else 1}}}]}"""
}

/** Last resort: the built-in snapshot of Krasnoyarsk from the app assets. */
fun snapshotStyleJson(dark: Boolean): String {
    val src = SNAPSHOTS.mapIndexed { i, s ->
        """"s$i":{"type":"image","url":"asset://${s.asset}","coordinates":[[${s.west},${s.north}],[${s.east},${s.north}],[${s.east},${s.south}],[${s.west},${s.south}]]}"""
    }.joinToString(",")
    val layers = SNAPSHOTS.indices.joinToString(",") { """{"id":"s$it","type":"raster","source":"s$it"}""" }
    return """{"version":8,"sources":{$src},"layers":[{"id":"bg","type":"background","paint":{"background-color":"${backgroundColor(dark)}"}},$layers]}"""
}
