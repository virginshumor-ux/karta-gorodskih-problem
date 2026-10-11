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
    )
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
        "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day" +
        "&hourly=temperature_2m,weather_code,precipitation_probability" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FKrasnoyarsk&forecast_days=3&wind_speed_unit=ms"
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
