package ru.sfu.kgp.ui

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
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.style.TextDecoration
import ru.sfu.kgp.ui.theme.KgpColors
import ru.sfu.kgp.ui.theme.LightKgp
import ru.sfu.kgp.ui.theme.StickerInk
import ru.sfu.kgp.ui.theme.Unbounded
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

/** Sticker surface: hard offset shadow (drawn outside the bounds), ink outline, rounded shape. */
fun Modifier.sticker(k: KgpColors, bg: Color, radius: Dp = 16.dp, shadow: Dp = 4.dp, outline: Dp = 2.dp, shadowColor: Color = k.hard): Modifier {
    val shape = RoundedCornerShape(radius)
    return this
        .drawBehind {
            if (shadow > 0.dp) drawRoundRect(shadowColor, topLeft = Offset(shadow.toPx(), shadow.toPx()), size = size, cornerRadius = CornerRadius(radius.toPx()))
        }
        .clip(shape)
        .background(bg)
        .then(if (outline > 0.dp) Modifier.border(outline, k.ink, shape) else Modifier)
}

/** Pressed stickers sink into their shadow (like the site). */
@Composable
private fun pressOffset(source: MutableInteractionSource, depth: Dp): Dp {
    val pressed by source.collectIsPressedAsState()
    return if (pressed) depth else 0.dp
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
        BtnKind.PRIMARY -> (if (k.dark) k.lime else StickerInk) to (if (k.dark) StickerInk else k.onPrimary)
        BtnKind.ON -> k.violet to Color.White
        BtnKind.ACCENT -> k.orange to StickerInk
        BtnKind.TONAL -> k.lime to StickerInk
        BtnKind.OUTLINE -> k.surface to k.fg
        BtnKind.TEXT -> Color.Transparent to k.fg
        BtnKind.DANGER -> k.bad to Color.White
    }
    val src = remember { MutableInteractionSource() }
    val text3d = kind != BtnKind.TEXT && enabled
    val shadow = if (!text3d) 0.dp else if (kind == BtnKind.OUTLINE) 2.dp else 3.dp
    val sink = pressOffset(src, shadow)
    val shadowColor = if (kind == BtnKind.PRIMARY && !k.dark) k.lime else k.hard
    Row(
        modifier
            .heightIn(min = 48.dp)
            .alpha(if (enabled) 1f else 0.45f)
            .offset(sink, sink)
            .then(
                if (kind == BtnKind.TEXT) Modifier.clip(RoundedCornerShape(14.dp))
                else Modifier.sticker(k, bg, radius = 14.dp, shadow = shadow - sink, shadowColor = shadowColor),
            )
            .clickable(interactionSource = src, indication = LocalIndication.current, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = if (kind == BtnKind.TEXT) 12.dp else 20.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Sym(icon, size = 20.sp, color = fg, fill = iconFill)
            Spacer(Modifier.width(8.dp))
        }
        Text(
            text, color = fg, fontWeight = FontWeight.Bold, fontSize = 15.sp, textAlign = TextAlign.Center,
            textDecoration = if (kind == BtnKind.TEXT) TextDecoration.Underline else null,
        )
    }
}

@Composable
fun IconBtn(icon: String, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, tonal: Boolean = false, onDark: Boolean = false, on: Boolean = false) {
    val k = LocalKgp.current
    val bg = if (on) k.lime else if (onDark) Color(0xFFF3EEE3) else if (tonal) k.surface else Color.Transparent
    val raised = on || tonal || onDark
    Box(
        modifier
            .size(48.dp)
            .then(if (raised) Modifier.sticker(if (onDark) LightKgp else k, bg, radius = 14.dp, shadow = 3.dp) else Modifier.clip(RoundedCornerShape(14.dp)))
            .clickable(onClickLabel = label, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Sym(icon, color = if (on || onDark) StickerInk else k.fg, fill = on) }
}

@Composable
fun KChip(text: String, on: Boolean, onClick: () -> Unit, icon: String? = null, raised: Boolean = false) {
    val k = LocalKgp.current
    val fg = if (on) StickerInk else k.fg
    Row(
        Modifier
            .heightIn(min = 40.dp)
            .sticker(k, if (on) k.lime else k.surface, radius = 20.dp, shadow = if (raised) 2.dp else 0.dp)
            .clickable(role = Role.Checkbox, onClick = onClick)
            .semantics { selected = on }
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Sym(icon, size = 18.sp, color = fg)
            Spacer(Modifier.width(6.dp))
        }
        Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 1)
    }
}

@Composable
fun StatusChip(s: Status, modifier: Modifier = Modifier) {
    val k = LocalKgp.current
    val (bg, fg) = k.status(s)
    Row(
        modifier.clip(RoundedCornerShape(8.dp)).background(bg).border(2.dp, StickerInk, RoundedCornerShape(8.dp)).heightIn(min = 26.dp).padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(fg))
        Spacer(Modifier.width(6.dp))
        Text(s.title.uppercase(), color = fg, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.3.sp, maxLines = 1)
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
        Modifier.fillMaxWidth().background(k.bg).statusBarsPadding().heightIn(min = 66.dp).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) IconBtn("arrow_back", "Назад", onBack)
        Row(Modifier.weight(1f).padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = 19.sp, fontFamily = Unbounded, fontWeight = FontWeight.SemiBold, color = k.fg, modifier = Modifier.semantics { heading() }, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(" · $subtitle", fontSize = 13.sp, color = k.fg2)
        }
        actions()
    }
}

@Composable
fun SectionTitle(text: String) {
    val k = LocalKgp.current
    Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 10.dp).semantics { heading() }, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).rotate(45f).clip(RoundedCornerShape(3.dp)).background(k.orange).border(2.dp, k.ink, RoundedCornerShape(3.dp)))
        Spacer(Modifier.width(10.dp))
        Text(text.uppercase(), color = k.fg, fontSize = 12.sp, fontFamily = Unbounded, fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp)
    }
}

@Composable
fun KCard(modifier: Modifier = Modifier, bg: Color? = null, border: Boolean = true, content: @Composable () -> Unit) {
    val k = LocalKgp.current
    Box(modifier.sticker(k, bg ?: k.surface, shadow = if (border) 4.dp else 0.dp, outline = 2.dp)) { content() }
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
    val k = LocalKgp.current
    Box(Modifier.size(size).clip(RoundedCornerShape(12.dp)).background(k.surface2).border(2.dp, k.ink, RoundedCornerShape(12.dp))) { PhotoOrIllustration(c, cat) }
}

@Composable
fun ComplaintItem(c: Complaint, cat: Category, distance: String? = null, onClick: () -> Unit) {
    val k = LocalKgp.current
    val src = remember { MutableInteractionSource() }
    val sink = pressOffset(src, 3.dp)
    Row(
        Modifier.fillMaxWidth().offset(sink, sink).sticker(k, k.surface, shadow = 4.dp - sink)
            .clickable(interactionSource = src, indication = LocalIndication.current, onClickLabel = "Открыть обращение", onClick = onClick).padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Thumb(c, cat)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                StatusChip(c.status)
                if (c.demo) DemoTag()
            }
            Text(c.title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = k.fg, lineHeight = 19.sp)
            Meta(cat.icon, cat.name, "thumb_up", c.supports.toString())
            Meta("place", c.address, null, fmtDate(c.createdAt))
            if (c.comments > 0 || distance != null) Row(verticalAlignment = Alignment.CenterVertically) {
                if (c.comments > 0) {
                    Sym("forum", size = 15.sp, color = k.fg2)
                    Text(" ${c.comments}   ", fontSize = 12.sp, color = k.fg2)
                }
                if (distance != null) Text(
                    " $distance ", fontSize = 12.sp, color = StickerInk, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(k.lime).padding(horizontal = 4.dp),
                )
            }
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
        Box(Modifier.rotate(-6f).size(76.dp).sticker(k, k.sun, radius = 22.dp), contentAlignment = Alignment.Center) { Sym(icon, size = 34.sp, color = StickerInk) }
        Spacer(Modifier.size(14.dp))
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
        Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().sticker(k, if (warn) k.warnSoft else k.infoSoft, shadow = 0.dp, outline = 2.dp)
            .padding(horizontal = 12.dp, vertical = 10.dp),
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
    Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().sticker(k, k.surface)) { content() }
}

@Composable
fun ListRow(icon: String, title: String, subtitle: String? = null, trailing: String? = null, danger: Boolean = false, chevron: Boolean = false, switch: Boolean? = null, onClick: () -> Unit) {
    val k = LocalKgp.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp)
            .clickable(role = if (switch != null) Role.Switch else Role.Button, onClick = onClick)
            .then(if (switch != null) Modifier.semantics { selected = switch } else Modifier)
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(if (danger) k.badSoft else k.lime).border(2.dp, StickerInk, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Sym(icon, size = 19.sp, color = if (danger) k.bad else StickerInk)
        }
        Column(Modifier.weight(1f)) {
            Text(title, color = if (danger) k.bad else k.fg, fontWeight = FontWeight.SemiBold)
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
        Modifier.size(52.dp, 30.dp).clip(RoundedCornerShape(15.dp)).background(if (on) k.lime else k.surface3)
            .border(2.dp, if (on) StickerInk else k.ink, RoundedCornerShape(15.dp)).padding(3.dp),
        contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart,
    ) { Box(Modifier.size(20.dp).clip(RoundedCornerShape(6.dp)).background(if (on) StickerInk else k.fg)) }
}

@Composable
fun Stat(value: String, label: String, modifier: Modifier = Modifier) {
    val k = LocalKgp.current
    Column(modifier.sticker(k, k.surface).padding(12.dp).widthIn(min = 60.dp)) {
        Text(value, fontSize = 24.sp, fontFamily = Unbounded, fontWeight = FontWeight.SemiBold, color = k.fg, lineHeight = 28.sp)
        Text(label, fontSize = 12.sp, color = k.fg2, fontWeight = FontWeight.Medium)
    }
}

val ScreenPadding = PaddingValues(bottom = 96.dp)
