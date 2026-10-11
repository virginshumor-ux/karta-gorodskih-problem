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

/** Design tokens of the prototype (docs/handoff/prototype/src/style.css), light and dark. */
@Immutable
data class KgpColors(
    val bg: Color, val surface: Color, val surface2: Color, val surface3: Color,
    val fg: Color, val fg2: Color, val fg3: Color, val line: Color,
    val primary: Color, val primary2: Color, val onPrimary: Color, val primarySoft: Color,
    val accent: Color, val onAccent: Color, val accentSoft: Color,
    val ok: Color, val okSoft: Color, val warn: Color, val warnSoft: Color,
    val bad: Color, val badSoft: Color, val info: Color, val infoSoft: Color, val mutedSoft: Color,
    val scrim: Color, val dark: Boolean,
)

private fun c(hex: Long) = Color(0xFF000000 or hex)

val LightKgp = KgpColors(
    bg = c(0xf3f6f6), surface = c(0xffffff), surface2 = c(0xe9efef), surface3 = c(0xdde6e6),
    fg = c(0x10201f), fg2 = c(0x4a5b5a), fg3 = c(0x7a8a89), line = c(0xd3dddc),
    primary = c(0x0b5d66), primary2 = c(0x0f7a85), onPrimary = c(0xffffff), primarySoft = c(0xd6ecee),
    accent = c(0xe8611a), onAccent = c(0xffffff), accentSoft = c(0xfde4d4),
    ok = c(0x2e7d4f), okSoft = c(0xdcefe3), warn = c(0xb26a00), warnSoft = c(0xfbedd0),
    bad = c(0xb3261e), badSoft = c(0xf9dedc), info = c(0x2f5fa8), infoSoft = c(0xdde7f7), mutedSoft = c(0xe6e9ec),
    scrim = Color(0x73081818), dark = false,
)

val DarkKgp = KgpColors(
    bg = c(0x0d1716), surface = c(0x142120), surface2 = c(0x1b2b2a), surface3 = c(0x243736),
    fg = c(0xe4efee), fg2 = c(0xa9bbba), fg3 = c(0x7f9291), line = c(0x2b3f3e),
    primary = c(0x6fd0da), primary2 = c(0x8fdde5), onPrimary = c(0x00363b), primarySoft = c(0x16403f),
    accent = c(0xff8a4c), onAccent = c(0x3a1300), accentSoft = c(0x4a2412),
    ok = c(0x7fd3a0), okSoft = c(0x173826), warn = c(0xf2bd5c), warnSoft = c(0x3d2c08),
    bad = c(0xffb4ab), badSoft = c(0x4c1713), info = c(0xa9c7ff), infoSoft = c(0x1b2c4a), mutedSoft = c(0x263231),
    scrim = Color(0x8C000000), dark = true,
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

/** Status chip colours: background to foreground, same as .st-* classes. */
fun KgpColors.status(s: Status): Pair<Color, Color> = when (s) {
    Status.MODERATION -> mutedSoft to fg2
    Status.PUBLISHED -> infoSoft to info
    Status.SENT -> primarySoft to primary
    Status.WORK -> warnSoft to warn
    Status.RESOLVED_WAIT -> okSoft to ok
    Status.RESOLVED -> ok to surface
    Status.REJECTED -> badSoft to bad
    Status.DUPLICATE -> mutedSoft to fg3
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
