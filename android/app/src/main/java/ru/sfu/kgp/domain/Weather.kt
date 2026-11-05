package ru.sfu.kgp.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class WeatherData(
    val current: Current,
    val hourly: Hourly,
    val daily: Daily,
    @SerialName("_fetchedAt") val fetchedAt: Long? = null,
) {
    @Serializable
    data class Current(
        val time: String,
        @SerialName("temperature_2m") val temperature: Double,
        @SerialName("apparent_temperature") val apparent: Double,
        @SerialName("relative_humidity_2m") val humidity: Int,
        @SerialName("weather_code") val code: Int,
        @SerialName("wind_speed_10m") val wind: Double,
        val precipitation: Double,
        @SerialName("is_day") val isDay: Int,
        @SerialName("wind_direction_10m") val windDirection: Double? = null,
        @SerialName("wind_gusts_10m") val gusts: Double? = null,
        @SerialName("pressure_msl") val pressure: Double? = null,
        @SerialName("uv_index") val uv: Double? = null,
    )

    @Serializable
    data class Hourly(
        val time: List<String>,
        @SerialName("temperature_2m") val temperature: List<Double>,
        @SerialName("weather_code") val code: List<Int>,
        @SerialName("precipitation_probability") val precipitationProbability: List<Int?>? = null,
    )

    @Serializable
    data class Daily(
        val time: List<String>,
        @SerialName("weather_code") val code: List<Int>,
        @SerialName("temperature_2m_max") val max: List<Double>,
        @SerialName("temperature_2m_min") val min: List<Double>,
        val sunrise: List<String>? = null,
        val sunset: List<String>? = null,
        @SerialName("precipitation_probability_max") val precipitationMax: List<Int?>? = null,
    )
}

/** Open-Meteo air quality (CAMS): European AQI and the main pollutants, µg/m³. */
@Serializable
data class AirData(
    val current: Current,
    @SerialName("_fetchedAt") val fetchedAt: Long? = null,
) {
    @Serializable
    data class Current(
        val time: String,
        @SerialName("european_aqi") val aqi: Double,
        @SerialName("pm2_5") val pm25: Double? = null,
        val pm10: Double? = null,
        @SerialName("nitrogen_dioxide") val no2: Double? = null,
        @SerialName("sulphur_dioxide") val so2: Double? = null,
    )
}

data class AqiLevel(val key: String, val title: String, val advice: String, val color: Long)

/** European AQI bands (EEA) with advice in Russian — same as the site (web/src/domain/weather.ts). */
fun aqiLevel(eaqi: Double): AqiLevel = when {
    eaqi <= 20 -> AqiLevel("good", "Хорошее", "Воздух чистый — можно гулять и проветривать.", 0xFF2E9D5B)
    eaqi <= 40 -> AqiLevel("fair", "Удовлетворительное", "Качество воздуха приемлемое.", 0xFF8BB43A)
    eaqi <= 60 -> AqiLevel("moderate", "Умеренное", "Чувствительным людям стоит сократить долгие прогулки.", 0xFFE0A800)
    eaqi <= 80 -> AqiLevel("poor", "Плохое", "Возможен режим «чёрного неба»: закройте окна, ограничьте пребывание на улице.", 0xFFE8611A)
    eaqi <= 100 -> AqiLevel("verypoor", "Очень плохое", "Режим «чёрного неба»: оставайтесь в помещении, используйте очиститель воздуха.", 0xFFC62828)
    else -> AqiLevel("extreme", "Опасное", "Опасный уровень загрязнения: избегайте пребывания на улице.", 0xFF7B1FA2)
}

fun windDir(deg: Double?): String {
    if (deg == null) return ""
    val i = Math.round((((deg % 360) + 360) % 360) / 45.0).toInt() % 8
    return listOf("С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ")[i]
}

data class CityWarning(val icon: String, val bad: Boolean, val text: String)

/** All city-environment warnings: ice, snowfall, wind, frost, heat and air pollution. */
fun cityWarnings(w: WeatherData?, air: AirData? = null): List<CityWarning> = buildList {
    iceRisk(w)?.let { add(CityWarning("warning", false, it)) }
    if (w != null) {
        val c = w.current
        val gust = c.gusts ?: c.wind
        if (gust >= 15) add(CityWarning("air", true, "Сильный ветер, порывы до ${Math.round(gust)} м/с — опасайтесь падения веток и конструкций."))
        if (c.temperature <= -25) add(CityWarning("ac_unit", true, "Сильный мороз ${Math.round(c.temperature)}° — проверьте, работают ли остановки с подогревом и освещение."))
        if (c.temperature >= 30) add(CityWarning("sunny", false, "Жара ${Math.round(c.temperature)}° — сообщайте о неработающих фонтанах и питьевых точках."))
    }
    if (air != null) {
        val l = aqiLevel(air.current.aqi)
        if (l.key in setOf("poor", "verypoor", "extreme")) add(CityWarning("masks", true, "Качество воздуха: ${l.title.lowercase()}. ${l.advice}"))
    }
}

object Wmo {
    private val table: Map<Int, Triple<String, String, String>> = mapOf(
        0 to Triple("Ясно", "clear_day", "clear_night"),
        1 to Triple("Преимущественно ясно", "partly_cloudy_day", "partly_cloudy_night"),
        2 to Triple("Переменная облачность", "partly_cloudy_day", "partly_cloudy_night"),
        3 to Triple("Пасмурно", "cloud", "cloud"),
        45 to Triple("Туман", "foggy", "foggy"),
        48 to Triple("Изморозь, туман", "foggy", "foggy"),
        51 to Triple("Слабая морось", "rainy_light", "rainy_light"),
        53 to Triple("Морось", "rainy_light", "rainy_light"),
        55 to Triple("Сильная морось", "rainy", "rainy"),
        56 to Triple("Ледяная морось", "weather_mix", "weather_mix"),
        57 to Triple("Ледяная морось", "weather_mix", "weather_mix"),
        61 to Triple("Небольшой дождь", "rainy_light", "rainy_light"),
        63 to Triple("Дождь", "rainy", "rainy"),
        65 to Triple("Ливень", "rainy_heavy", "rainy_heavy"),
        66 to Triple("Ледяной дождь", "weather_mix", "weather_mix"),
        67 to Triple("Ледяной дождь", "weather_mix", "weather_mix"),
        71 to Triple("Небольшой снег", "weather_snowy", "weather_snowy"),
        73 to Triple("Снег", "weather_snowy", "weather_snowy"),
        75 to Triple("Сильный снег", "snowing_heavy", "snowing_heavy"),
        77 to Triple("Снежные зёрна", "weather_snowy", "weather_snowy"),
        80 to Triple("Ливневый дождь", "rainy", "rainy"),
        81 to Triple("Ливневый дождь", "rainy", "rainy"),
        82 to Triple("Сильный ливень", "rainy_heavy", "rainy_heavy"),
        85 to Triple("Снегопад", "weather_snowy", "weather_snowy"),
        86 to Triple("Сильный снегопад", "snowing_heavy", "snowing_heavy"),
        95 to Triple("Гроза", "thunderstorm", "thunderstorm"),
        96 to Triple("Гроза с градом", "thunderstorm", "thunderstorm"),
        99 to Triple("Гроза с градом", "thunderstorm", "thunderstorm"),
    )

    fun text(code: Int): String = table[code]?.first ?: "—"
    fun icon(code: Int, day: Boolean = true): String = table[code]?.let { if (day) it.second else it.third } ?: "cloud"

    const val URL = "https://api.open-meteo.com/v1/forecast?latitude=56.0153&longitude=92.8932" +
        "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,is_day,uv_index" +
        "&hourly=temperature_2m,weather_code,precipitation_probability" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max" +
        "&timezone=Asia%2FKrasnoyarsk&forecast_days=7&wind_speed_unit=ms"

    const val AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=56.0153&longitude=92.8932" +
        "&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,sulphur_dioxide&timezone=Asia%2FKrasnoyarsk"
}

/** City-environment warning (same rules as iceRisk() of the prototype). */
fun iceRisk(w: WeatherData?): String? {
    if (w == null) return null
    val t = w.current.temperature
    val code = w.current.code
    val next = w.hourly.temperature.take(24)
    val crosses = next.any { it > 0 } && next.any { it < 0 }
    return when {
        code in setOf(56, 57, 66, 67) -> "Ледяной дождь — высокий риск гололёда. Сообщайте о наледи на тротуарах."
        t <= 2 && t >= -4 && (w.current.precipitation > 0 || crosses) -> "Температура около нуля — возможен гололёд. Отметьте опасные участки на карте."
        code in setOf(71, 73, 75, 77, 85, 86) -> "Снегопад — проверьте, убраны ли тротуары и остановки рядом с вами."
        else -> null
    }
}
