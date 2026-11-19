package ru.sfu.kgp.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import ru.sfu.kgp.R
import ru.sfu.kgp.data.ThemeMode
import ru.sfu.kgp.domain.Status

/**
 * Design tokens v3 «Сибирский стикербук» — the same as web/src/styles/style.css: paper, ink outlines ([ink]),
 * hard offset shadows ([hard]), acid lime, road-cone orange, violet XP.
 */
@Immutable
data class KgpColors(
    val bg: Color, val surface: Color, val surface2: Color, val surface3: Color,
    val fg: Color, val fg2: Color, val fg3: Color, val line: Color,
    val primary: Color, val primary2: Color, val onPrimary: Color, val primarySoft: Color,
    val accent: Color, val onAccent: Color, val accentSoft: Color,
    val ok: Color, val okSoft: Color, val warn: Color, val warnSoft: Color,
    val bad: Color, val badSoft: Color, val info: Color, val infoSoft: Color, val mutedSoft: Color,
    val scrim: Color, val dark: Boolean,
    val ink: Color = Color(0xFF141414), val hard: Color = Color(0xFF141414),
    val lime: Color = Color(0xFFC6F24E), val orange: Color = Color(0xFFFF5A1F), val violet: Color = Color(0xFF8B6CFF),
    val sun: Color = Color(0xFFFFD23F), val pink: Color = Color(0xFFFF7EB6), val blue: Color = Color(0xFF3B5BFF),
)

/** Fixed sticker ink: text on lime / sun / orange stays black in both themes. */
val StickerInk = Color(0xFF141414)

private fun c(hex: Long) = Color(0xFF000000 or hex)

val LightKgp = KgpColors(
    bg = c(0xf3eee3), surface = c(0xfffdf8), surface2 = c(0xf1ebdf), surface3 = c(0xe4dccb),
    fg = c(0x141414), fg2 = c(0x4a4740), fg3 = c(0x777164), line = Color(0x24141414),
    primary = c(0x141414), primary2 = c(0x3b5bff), onPrimary = c(0xf3eee3), primarySoft = c(0xe5f8b9),
    accent = c(0xff5a1f), onAccent = c(0x141414), accentSoft = c(0xffe0d2),
    ok = c(0x138a52), okSoft = c(0xcdf3df), warn = c(0x9a5b00), warnSoft = c(0xffeeb0),
    bad = c(0xd92d20), badSoft = c(0xffd9d4), info = c(0x3b5bff), infoSoft = c(0xdfe5ff), mutedSoft = c(0xebe5d8),
    scrim = Color(0x73141414), dark = false,
)

val DarkKgp = KgpColors(
    bg = c(0x121117), surface = c(0x1c1b23), surface2 = c(0x24232c), surface3 = c(0x2f2e39),
    fg = c(0xf3eee3), fg2 = c(0xbdb6a8), fg3 = c(0x8f897d), line = Color(0x24F3EEE3),
    primary = c(0xc6f24e), primary2 = c(0x8b9cff), onPrimary = c(0x121117), primarySoft = c(0x2c3a10),
    accent = c(0xff6a33), onAccent = c(0x121117), accentSoft = c(0x46200f),
    ok = c(0x5fe0a2), okSoft = c(0x123526), warn = c(0xffd23f), warnSoft = c(0x3b2f07),
    bad = c(0xff8a80), badSoft = c(0x4a1714), info = c(0x8b9cff), infoSoft = c(0x1f2650), mutedSoft = c(0x2a2932),
    scrim = Color(0x99000000), dark = true,
    ink = c(0xe9e3d6), hard = Color(0xFF000000),
)

val LocalKgp = staticCompositionLocalOf { LightKgp }

val Golos = FontFamily(
    Font(R.font.golos_400, FontWeight.Normal),
    Font(R.font.golos_500, FontWeight.Medium),
    Font(R.font.golos_600, FontWeight.SemiBold),
    Font(R.font.golos_700, FontWeight.Bold),
)
val Unbounded = FontFamily(Font(R.font.unbounded_600, FontWeight.SemiBold))
val SymbolsOutline = FontFamily(Font(R.font.symbols_outline))
val SymbolsFill = FontFamily(Font(R.font.symbols_fill))

/** Status sticker colours (background to text), same as the .st-* classes of the site: ink text on pastel. */
fun KgpColors.status(s: Status): Pair<Color, Color> = when (s) {
    Status.MODERATION -> c(0xe7e2d6) to StickerInk
    Status.PUBLISHED -> c(0xc9d4ff) to StickerInk
    Status.SENT -> c(0xe2d8ff) to StickerInk
    Status.WORK -> sun to StickerInk
    Status.RESOLVED_WAIT -> c(0xb8f0cf) to StickerInk
    Status.RESOLVED -> lime to StickerInk
    Status.REJECTED -> c(0xffc4bd) to StickerInk
    Status.DUPLICATE -> c(0xe7e2d6) to c(0x5a554b)
}

fun parseHex(hex: String): Color = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color.Gray)

@Composable
fun KgpTheme(mode: ThemeMode, content: @Composable () -> Unit) {
    val dark = when (mode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val k = if (dark) DarkKgp else LightKgp
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = k.primary, onPrimary = k.onPrimary, primaryContainer = k.primarySoft, onPrimaryContainer = k.primary,
        secondary = k.accent, onSecondary = k.onAccent, background = k.bg, onBackground = k.fg,
        surface = k.surface, onSurface = k.fg, surfaceVariant = k.surface2, onSurfaceVariant = k.fg2,
        outline = k.line, error = k.bad, surfaceContainerHigh = k.surface, surfaceContainer = k.surface,
    )
    val base = TextStyle(fontFamily = Golos, color = k.fg)
    val typo = Typography(
        bodyLarge = base.copy(fontSize = 15.sp, lineHeight = 22.sp),
        bodyMedium = base.copy(fontSize = 15.sp, lineHeight = 22.sp),
        bodySmall = base.copy(fontSize = 13.sp, lineHeight = 18.sp),
        labelLarge = base.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
        labelMedium = base.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium),
        labelSmall = base.copy(fontSize = 12.sp),
        titleLarge = base.copy(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = base.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
        headlineSmall = base.copy(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp),
    )
    CompositionLocalProvider(LocalKgp provides k) {
        MaterialTheme(colorScheme = scheme, typography = typo, content = content)
    }
}
