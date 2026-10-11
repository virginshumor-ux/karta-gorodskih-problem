package ru.sfu.kgp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Guards for files shared with the site: the privacy policy and the icon font subset. */
class ResourcesTest {
    private val app = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "src/main/AndroidManifest.xml").exists() }
    private val repo = app.parentFile!!.parentFile!!

    @Test fun privacyPolicyIsTheSameAsInDocs() {
        val docs = File(repo, "docs/privacy.md")
        if (!docs.exists()) return // the app module checked out alone
        assertEquals(docs.readText().replace("\r", ""), File(app, "src/main/assets/privacy.md").readText().replace("\r", ""))
    }

    @Test fun everyIconUsedIsInTheFontSubset() {
        val iconsTs = File(repo, "web/src/ui/icons.ts")
        if (!iconsTs.exists()) return
        val subset = Regex("\"([a-z_0-9]+)\"").findAll(iconsTs.readText().substringBefore("];")).map { it.groupValues[1] }.toSet()
        val used = mutableSetOf<String>()
        File(app, "src/main/java").walk().filter { it.extension == "kt" }.forEach { f ->
            val s = f.readText()
            Regex("""Sym\(\s*"([a-z_0-9]+)"""").findAll(s).forEach { used += it.groupValues[1] }
            Regex("""icon\s*=\s*"([a-z_0-9]+)"""").findAll(s).forEach { used += it.groupValues[1] }
            Regex("""(?:IconBtn|ListRow)\(\s*"([a-z_0-9]+)"""").findAll(s).forEach { used += it.groupValues[1] }
            Regex("""Banner\(\s*"([a-z_0-9]+)"""").findAll(s).forEach { used += it.groupValues[1] }
            Regex("""EmptyState\(\s*"([a-z_0-9]+)"""").findAll(s).forEach { used += it.groupValues[1] }
            Regex("""Triple\("[^"]*",\s*"([a-z_]+)",\s*"([a-z_]+)"\)""").findAll(s).forEach { used += it.groupValues[1]; used += it.groupValues[2] }
            Regex("""Slide\("([a-z_]+)"""").findAll(s).forEach { used += it.groupValues[1] }
            Regex("""Triple\(Routes\.[A-Z]+,\s*"([a-z_]+)"""").findAll(s).forEach { used += it.groupValues[1] }
        }
        ru.sfu.kgp.domain.DEFAULT_CATS.forEach { used += it.icon }
        val missing = used - subset
        assertTrue("icons missing from the font subset: $missing", missing.isEmpty())
    }
}
