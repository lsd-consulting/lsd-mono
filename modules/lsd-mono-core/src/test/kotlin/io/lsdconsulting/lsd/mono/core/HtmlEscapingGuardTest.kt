package io.lsdconsulting.lsd.mono.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.extension
import kotlin.io.path.invariantSeparatorsPathString
import kotlin.io.path.isRegularFile
import kotlin.io.path.readText

/**
 * Keeps HTML escaping in one place (#28, #30). Every module's main Kotlin is scanned:
 *
 * - Only `html/Html.kt` writes escaping entities or replaces markup characters.
 * - A string template that contains markup only interpolates values that are escaped or are
 *   markup already built safely: `Html.text(...)`, `Html.attribute(...)`, `jsonString(...)`,
 *   a value or function whose name ends in `Html`, or a `.size`. Anything else is listed in
 *   [ALLOWED] with the reason it is safe.
 */
class HtmlEscapingGuardTest {
    @Test
    fun `only Html escapes markup characters`() {
        val findings =
            mainSources().flatMap { (path, source) ->
                if (path.endsWith("/html/Html.kt")) return@flatMap emptyList()
                source.lines().mapIndexedNotNull { index, line ->
                    val code = line.substringBefore("//")
                    when {
                        ESCAPING_ENTITY.containsMatchIn(code) -> "$path:${index + 1}: escaping entity; use Html.text or Html.attribute"
                        MARKUP_REPLACE.containsMatchIn(code) -> "$path:${index + 1}: hand-rolled escaping; use Html.text or Html.attribute"
                        else -> null
                    }
                }
            }
        assertEquals(emptyList<String>(), findings)
    }

    @Test
    fun `markup templates interpolate only escaped values`() {
        val findings =
            mainSources().flatMap { (path, source) ->
                if (path.endsWith("/html/Html.kt")) return@flatMap emptyList()
                Templates(source).all().filter { MARKUP.containsMatchIn(it.text) }.flatMap { template ->
                    template.expressions
                        .filterNot { expression -> SAFE.any { it.matches(expression) } }
                        .filterNot { expression -> ALLOWED.any { path.endsWith(it.file) && it.expression == expression } }
                        .map { "$path:${template.line}: \${$it} in markup is not escaped; wrap it in Html.text or Html.attribute" }
                }
            }
        assertEquals(emptyList<String>(), findings)
    }

    @Test
    fun `the scanner sees templates, interpolations and markup`() {
        val source =
            "val a = \"<b>\${Html.text(x)}</b>\" + '\"' // \"<i>\$ignored\"\n" +
                "val b = \"\"\"\n  <p>\$name \${f(\"}\")}</p>\n\"\"\""
        val markup = Templates(source).all().filter { MARKUP.containsMatchIn(it.text) }
        assertEquals(listOf(listOf("Html.text(x)"), listOf("name", "f(\"}\")")), markup.map { it.expressions })
        assertEquals(listOf(1, 2), markup.map { it.line })
        assertTrue(mainSources().any { it.first.endsWith("/report/ReportWriter.kt") }, "the scan found no sources")
    }

    private class Allowed(
        val file: String,
        val expression: String,
        @Suppress("unused") val reason: String,
    )

    private class Template(val text: String, val expressions: List<String>, val line: Int)

    /** A small Kotlin lexer: string templates (with `${}` nesting), char literals and comments. */
    private class Templates(private val src: String) {
        private val found = mutableListOf<Template>()

        fun all(): List<Template> {
            code(0, nested = false)
            return found
        }

        private fun code(from: Int, nested: Boolean): Int {
            var p = from
            var depth = 0
            while (p < src.length) {
                val c = src[p]
                when {
                    src.startsWith("//", p) -> p = src.indexOf('\n', p).let { if (it < 0) src.length else it }
                    src.startsWith("/*", p) -> p = src.indexOf("*/", p + 2).let { if (it < 0) src.length else it + 2 }
                    c == '\'' -> p = src.indexOf('\'', p + if (src.getOrNull(p + 1) == '\\') 3 else 2) + 1
                    c == '"' -> p = string(p)
                    c == '{' -> {
                        depth++
                        p++
                    }
                    c == '}' -> {
                        if (nested && depth == 0) return p
                        depth--
                        p++
                    }
                    else -> p++
                }
            }
            return p
        }

        private fun string(start: Int): Int {
            val raw = src.startsWith("\"\"\"", start)
            var p = start + if (raw) 3 else 1
            val text = StringBuilder()
            val expressions = mutableListOf<String>()
            while (p < src.length) {
                val c = src[p]
                when {
                    raw && src.startsWith("\"\"\"", p) -> {
                        p += 3
                        while (src.getOrNull(p) == '"') p++
                        break
                    }
                    !raw && c == '"' -> {
                        p++
                        break
                    }
                    !raw && c == '\\' -> {
                        text.append(src, p, minOf(p + 2, src.length))
                        p += 2
                    }
                    c == '$' && src.getOrNull(p + 1) == '{' -> {
                        val end = code(p + 2, nested = true)
                        expressions += src.substring(p + 2, end).trim()
                        text.append('\u0000')
                        p = end + 1
                    }
                    c == '$' && src.getOrNull(p + 1)?.let { it.isLetter() || it == '_' } == true -> {
                        var q = p + 1
                        while (q < src.length && (src[q].isLetterOrDigit() || src[q] == '_')) q++
                        expressions += src.substring(p + 1, q)
                        text.append('\u0000')
                        p = q
                    }
                    else -> {
                        text.append(c)
                        p++
                    }
                }
            }
            found += Template(text.toString(), expressions, src.substring(0, start).count { it == '\n' } + 1)
            return p
        }
    }

    private companion object {
        val MAIN_SOURCE = Regex("""modules/[^/]+/src/main/.*""")
        val MARKUP = Regex("""<[A-Za-z/!]""")
        val ESCAPING_ENTITY = Regex("""&(lt|gt|amp|quot|apos|#0*39|#x0*27);""")
        val MARKUP_REPLACE = Regex("""\.replace\(\s*(['"])(<|>|&|\\"|\\'|"|')\1""")
        val SAFE =
            listOf(
                Regex("""Html\.(text|attribute)\(.*\)""", RegexOption.DOT_MATCHES_ALL),
                Regex("""jsonString\(.*\)""", RegexOption.DOT_MATCHES_ALL),
                Regex("""[\w.]*Html(\(.*\))?""", RegexOption.DOT_MATCHES_ALL),
                Regex("""[\w.]+\.size"""),
            )
        val ALLOWED =
            listOf(
                Allowed("report/ReportWriter.kt", "src", "a script statement whose only value is written by jsonString"),
                Allowed("report/ReportWriter.kt", "report.toJson().trim()", "JSON whose strings are written by jsonString, which escapes <, > and &"),
            )

        /** (path relative to the repository, text) for every module's `src/main` Kotlin. */
        fun mainSources(): List<Pair<String, String>> {
            var root = Path.of("").toAbsolutePath()
            while (!root.resolve("settings.gradle.kts").exists()) root = root.parent
            return Files.walk(root.resolve("modules")).use { paths ->
                paths
                    .filter { it.isRegularFile() && it.extension == "kt" }
                    .map { root.relativize(it).invariantSeparatorsPathString }
                    .filter { MAIN_SOURCE.matches(it) }
                    .sorted()
                    .map { it to root.resolve(it).readText() }
                    .toList()
            }
        }
    }
}
