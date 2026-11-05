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

/** Design tokens v2 — the same as web/src/styles/style.css (:root and the dark theme). */
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
    bg = c(0xf2f5f6), surface = c(0xffffff), surface2 = c(0xeef3f4), surface3 = c(0xe1e9eb),
    fg = c(0x0e1c1d), fg2 = c(0x46585a), fg3 = c(0x66787a), line = c(0xdde5e6),
    primary = c(0x0a6670), primary2 = c(0x0f8792), onPrimary = c(0xffffff), primarySoft = c(0xdcf0f1),
    accent = c(0xf0611c), onAccent = c(0xffffff), accentSoft = c(0xfeebdd),
    ok = c(0x23804c), okSoft = c(0xdcf2e4), warn = c(0xa66200), warnSoft = c(0xfdf0d3),
    bad = c(0xb3261e), badSoft = c(0xfbe2df), info = c(0x285ca8), infoSoft = c(0xe1eafa), mutedSoft = c(0xe7ecee),
    scrim = Color(0x6B061416), dark = false,
)

val DarkKgp = KgpColors(
    bg = c(0x0a1213), surface = c(0x121c1e), surface2 = c(0x182527), surface3 = c(0x213235),
    fg = c(0xe6f0f0), fg2 = c(0xa9babb), fg3 = c(0x8b9d9e), line = c(0x223032),
    primary = c(0x64d2da), primary2 = c(0x8be0e6), onPrimary = c(0x00363b), primarySoft = c(0x143e40),
    accent = c(0xff8a4c), onAccent = c(0x3a1300), accentSoft = c(0x46230f),
    ok = c(0x7fd3a0), okSoft = c(0x153523), warn = c(0xf2bd5c), warnSoft = c(0x3a2a08),
    bad = c(0xffb4ab), badSoft = c(0x4a1612), info = c(0xa9c7ff), infoSoft = c(0x182a47), mutedSoft = c(0x223032),
    scrim = Color(0x99000000), dark = true,
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
