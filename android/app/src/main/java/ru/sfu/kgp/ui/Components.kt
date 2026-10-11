package ru.sfu.kgp.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.SubcomposeAsyncImage
import ru.sfu.kgp.domain.Category
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.Status
import ru.sfu.kgp.domain.fmtDate
import ru.sfu.kgp.ui.theme.LocalKgp
import ru.sfu.kgp.ui.theme.SymbolsFill
import ru.sfu.kgp.ui.theme.SymbolsOutline
import ru.sfu.kgp.ui.theme.parseHex
import ru.sfu.kgp.ui.theme.status

/** Material Symbols glyph through font ligatures — the same icons as on the site. Decorative for TalkBack. */
@Composable
fun Sym(name: String, modifier: Modifier = Modifier, size: TextUnit = 22.sp, color: Color = Color.Unspecified, fill: Boolean = false) {
    Text(
        name,
        modifier = modifier.clearAndSetSemantics { },
        fontFamily = if (fill) SymbolsFill else SymbolsOutline,
        fontSize = size,
        lineHeight = size,
        color = if (color == Color.Unspecified) LocalKgp.current.fg else color,
        maxLines = 1,
    )
}

enum class BtnKind { PRIMARY, ACCENT, TONAL, OUTLINE, TEXT, ON, DANGER }

@Composable
fun KBtn(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: BtnKind = BtnKind.PRIMARY,
    icon: String? = null,
    iconFill: Boolean = false,
    enabled: Boolean = true,
) {
    val k = LocalKgp.current
    val (bg, fg) = when (kind) {
        BtnKind.PRIMARY, BtnKind.ON -> k.primary to k.onPrimary
        BtnKind.ACCENT -> k.accent to k.onAccent
        BtnKind.TONAL -> k.primarySoft to k.primary
        BtnKind.OUTLINE -> Color.Transparent to k.fg
        BtnKind.TEXT -> Color.Transparent to k.primary
        BtnKind.DANGER -> k.bad to k.surface
    }
    Row(
        modifier
            .heightIn(min = 48.dp)
            .alpha(if (enabled) 1f else 0.45f)
            .clip(RoundedCornerShape(24.dp))
            .background(bg)
            .then(if (kind == BtnKind.OUTLINE) Modifier.border(1.dp, k.line, RoundedCornerShape(24.dp)) else Modifier)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = if (kind == BtnKind.TEXT) 12.dp else 22.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Sym(icon, size = 20.sp, color = fg, fill = iconFill)
            Spacer(Modifier.width(8.dp))
        }
        Text(text, color = fg, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center)
    }
}

@Composable
fun IconBtn(icon: String, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, tonal: Boolean = false, onDark: Boolean = false) {
    val k = LocalKgp.current
    Box(
        modifier
            .size(48.dp)
            .clip(CircleShape)
            .background(if (onDark) Color(0x61000000) else if (tonal) k.surface else Color.Transparent)
            .clickable(onClickLabel = label, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Sym(icon, color = if (onDark) Color.White else k.fg) }
}

@Composable
fun KChip(text: String, on: Boolean, onClick: () -> Unit, icon: String? = null, raised: Boolean = false) {
    val k = LocalKgp.current
    Row(
        Modifier
            .heightIn(min = 40.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (on) k.primarySoft else k.surface)
            .then(if (!on && !raised) Modifier.border(1.dp, k.line, RoundedCornerShape(10.dp)) else Modifier)
            .clickable(role = Role.Checkbox, onClick = onClick)
            .semantics { selected = on }
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Sym(icon, size = 18.sp, color = if (on) k.primary else k.fg)
            Spacer(Modifier.width(6.dp))
        }
        Text(text, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = if (on) k.primary else k.fg, maxLines = 1)
    }
}

@Composable
fun StatusChip(s: Status, modifier: Modifier = Modifier) {
    val k = LocalKgp.current
    val (bg, fg) = k.status(s)
    Row(
        modifier.clip(RoundedCornerShape(13.dp)).background(bg).heightIn(min = 26.dp).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(fg))
        Spacer(Modifier.width(6.dp))
        Text(s.title, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
fun DemoTag() {
    val k = LocalKgp.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Sym("science", size = 14.sp, color = k.fg3)
        Text(" пример", fontSize = 11.sp, color = k.fg3)
    }
}

@Composable
fun TopBar(title: String, onBack: (() -> Unit)? = null, subtitle: String? = null, actions: @Composable RowScope.() -> Unit = {}) {
    val k = LocalKgp.current
    Row(
        Modifier.fillMaxWidth().background(k.bg).statusBarsPadding().heightIn(min = 64.dp).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) IconBtn("arrow_back", "Назад", onBack)
        Row(Modifier.weight(1f).padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.semantics { heading() }, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(" · $subtitle", fontSize = 13.sp, color = k.fg2)
        }
        actions()
    }
}

@Composable
fun SectionTitle(text: String) {
    Text(
        text.uppercase(),
        color = LocalKgp.current.fg2,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.8.sp,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp).semantics { heading() },
    )
}

@Composable
fun KCard(modifier: Modifier = Modifier, bg: Color? = null, border: Boolean = true, content: @Composable () -> Unit) {
    val k = LocalKgp.current
    Box(
        modifier.clip(RoundedCornerShape(16.dp)).background(bg ?: k.surface)
            .then(if (border) Modifier.border(BorderStroke(1.dp, k.line), RoundedCornerShape(16.dp)) else Modifier),
    ) { content() }
}

/** Category illustration instead of a photo (demo data has no photos), as in the prototype. */
@Composable
fun Illustration(cat: Category, iconSize: TextUnit = 34.sp, modifier: Modifier = Modifier) {
    val col = parseHex(cat.color)
    Box(
        modifier.fillMaxSize().background(Brush.linearGradient(listOf(col, col.copy(alpha = 0.8f), Color(0x55000000))))
            .semantics { contentDescription = "Иллюстрация категории ${cat.name}" },
        contentAlignment = Alignment.Center,
    ) { Sym(cat.icon, size = iconSize, color = Color.White.copy(alpha = 0.92f), fill = true) }
}

@Composable
fun PhotoOrIllustration(c: Complaint, cat: Category, index: Int = 0, iconSize: TextUnit = 34.sp) {
    val url = c.gallery.getOrNull(index)?.url.orEmpty()
    if (url.isEmpty()) Illustration(cat, iconSize)
    else SubcomposeAsyncImage(
        model = url,
        contentDescription = "Фото проблемы: ${c.title}",
        contentScale = ContentScale.Crop,
        modifier = Modifier.fillMaxSize(),
        loading = { Illustration(cat, iconSize) },
        error = { Illustration(cat, iconSize) },
    )
}

@Composable
fun Thumb(c: Complaint, cat: Category, size: Dp = 76.dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(12.dp)).background(LocalKgp.current.surface2)) { PhotoOrIllustration(c, cat) }
}

@Composable
fun ComplaintItem(c: Complaint, cat: Category, onClick: () -> Unit) {
    val k = LocalKgp.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(k.surface).border(1.dp, k.line, RoundedCornerShape(16.dp))
            .clickable(onClickLabel = "Открыть обращение", onClick = onClick).padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Thumb(c, cat)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                StatusChip(c.status)
                if (c.demo) DemoTag()
            }
            Text(c.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = k.fg, lineHeight = 19.sp)
            Meta(cat.icon, cat.name, "thumb_up", c.supports.toString())
            Meta("place", c.address, null, fmtDate(c.createdAt))
        }
    }
}

@Composable
private fun Meta(icon1: String, t1: String, icon2: String?, t2: String) {
    val k = LocalKgp.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Sym(icon1, size = 15.sp, color = k.fg2)
        Text(t1, fontSize = 12.sp, color = k.fg2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Spacer(Modifier.width(6.dp))
        if (icon2 != null) Sym(icon2, size = 15.sp, color = k.fg2)
        Text(t2, fontSize = 12.sp, color = k.fg2, maxLines = 1)
    }
}

@Composable
fun EmptyState(icon: String, text: String, action: (@Composable () -> Unit)? = null) {
    val k = LocalKgp.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Sym(icon, size = 48.sp, color = k.fg3)
        Spacer(Modifier.size(8.dp))
        Text(text, color = k.fg2, textAlign = TextAlign.Center)
        if (action != null) {
            Spacer(Modifier.size(12.dp))
            action()
        }
    }
}

@Composable
fun Banner(icon: String, text: String, warn: Boolean = false, action: (@Composable () -> Unit)? = null) {
    val k = LocalKgp.current
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .background(if (warn) k.warnSoft else k.infoSoft).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Sym(icon, color = if (warn) k.warn else k.info)
        Text(text, fontSize = 13.sp, color = k.fg, modifier = Modifier.weight(1f))
        action?.invoke()
    }
}

@Composable
fun ListGroup(content: @Composable () -> Unit) {
    val k = LocalKgp.current
    Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(k.surface).border(1.dp, k.line, RoundedCornerShape(16.dp))) {
        content()
    }
}

@Composable
fun ListRow(icon: String, title: String, subtitle: String? = null, trailing: String? = null, danger: Boolean = false, chevron: Boolean = false, switch: Boolean? = null, onClick: () -> Unit) {
    val k = LocalKgp.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp)
            .clickable(role = if (switch != null) Role.Switch else Role.Button, onClick = onClick)
            .then(if (switch != null) Modifier.semantics { selected = switch } else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Sym(icon, color = if (danger) k.bad else k.fg2)
        Column(Modifier.weight(1f)) {
            Text(title, color = if (danger) k.bad else k.fg)
            if (subtitle != null) Text(subtitle, fontSize = 13.sp, color = k.fg2)
        }
        if (trailing != null) Text(trailing, fontSize = 13.sp, color = k.fg2)
        if (switch != null) KSwitch(switch)
        if (chevron) Sym("chevron_right", color = k.fg2)
    }
}

@Composable
fun KSwitch(on: Boolean) {
    val k = LocalKgp.current
    Box(
        Modifier.width(52.dp).size(52.dp, 32.dp).clip(RoundedCornerShape(16.dp)).background(if (on) k.primary else k.surface3)
            .border(2.dp, if (on) k.primary else k.fg3, RoundedCornerShape(16.dp)).padding(4.dp),
        contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart,
    ) { Box(Modifier.size(20.dp).clip(CircleShape).background(if (on) k.onPrimary else k.fg3)) }
}

@Composable
fun Stat(value: String, label: String, modifier: Modifier = Modifier) {
    val k = LocalKgp.current
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(k.surface).border(1.dp, k.line, RoundedCornerShape(16.dp)).padding(12.dp).widthIn(min = 60.dp)) {
        Text(value, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = k.fg, lineHeight = 28.sp)
        Text(label, fontSize = 12.sp, color = k.fg2)
    }
}

val ScreenPadding = PaddingValues(bottom = 96.dp)
