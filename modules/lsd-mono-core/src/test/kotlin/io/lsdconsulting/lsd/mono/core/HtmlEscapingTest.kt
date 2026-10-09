package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.PayloadSnapshotTest.Companion.assertValidJson
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.html.Html
import io.lsdconsulting.lsd.mono.core.json.jsonString
import io.lsdconsulting.lsd.mono.core.report.PopupContent
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name

/** One escaper per context (#28), and a whole hostile report proving nothing leaks. */
class HtmlEscapingTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
    }

    @AfterEach
    fun restore() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-mono")
    }

    @Test
    fun `text escapes ampersand and angle brackets only`() {
        assertEquals("&lt;a href=\"x\"&gt;Tom &amp; Jerry's&lt;/a&gt;", Html.text("<a href=\"x\">Tom & Jerry's</a>"))
        assertEquals("&lt;/script&gt;&lt;!--", Html.text("</script><!--"))
        assertEquals("&amp;amp;", Html.text("&amp;"))
        assertEquals("", Html.text(null))
        assertEquals("plain", Html.text("plain"))
    }

    @Test
    fun `attribute escapes quotes too`() {
        assertEquals("&quot;x&quot; onmouseover=&#39;y&#39; &lt;&amp;&gt;", Html.attribute("\"x\" onmouseover='y' <&>"))
        assertEquals("", Html.attribute(null))
    }

    @Test
    fun `both keep whitespace, U+2028 and pairs, and replace other controls and lone surrogates`() {
        val awkward = "a\u2028b\u2029c\t\n\r\u000C \u0000\u0001\u001f x\uD800y\uDC00z \uDC00\uD800 pair \uD83D\uDE00"
        val expected = "a\u2028b\u2029c\t\n\r\u000C \uFFFD\uFFFD\uFFFD x\uFFFDy\uFFFDz \uFFFD\uFFFD pair \uD83D\uDE00"
        assertEquals(expected, Html.text(awkward))
        assertEquals(expected, Html.attribute(awkward))
        assertTrue(utf8(Html.text(awkward).toByteArray()) != null)
        assertEquals("x\uFFFDy \uD83D\uDE00", Html.wellFormed("x\uDC00y \uD83D\uDE00"))
    }

    @Test
    fun `json for script escapes markup, separators, controls and lone surrogates`() {
        val json = jsonString("</script><!-- & \u2028\u2029 \u0000\u001f \"\\ \uD800 \uD83D\uDE00")
        assertEquals(
            "\"\\u003c/script\\u003e\\u003c!-- \\u0026 \\u2028\\u2029 \\u0000\\u001f \\\"\\\\ \\ufffd \uD83D\uDE00\"",
            json,
        )
        assertValidJson(json)
    }

    @Test
    fun `popup escapes its id, title and link text but keeps its HTML content`() {
        val html = PopupContent.popupHyperlink(id = "p\"1", popupTitle = "<b>t</b>", hyperlinkText = "a & b", popupContent = "<pre>x</pre>")
        assertTrue(html.contains("""<a href="#p&quot;1">a &amp; b</a>"""), html)
        assertTrue(html.contains("""<div id="p&quot;1" class="overlay""""), html)
        assertTrue(html.contains("<h2>&lt;b&gt;t&lt;/b&gt;</h2>"), html)
        assertTrue(html.contains("<pre>x</pre>"), html)
    }

    @Test
    fun `a hostile report leaks into none of the files written for it`() {
        val lsd = LsdContext()
        lsd.message(hostile("Client"), hostile("Api"), hostile("label"), data = mapOf(hostile("key") to hostile("value"), "method" to hostile("method")))
        lsd.response(hostile("Api"), hostile("Client"), hostile("response"), data = hostile("body"))
        lsd.note(hostile("note"), over = hostile("Api"))
        lsd.addFact(hostile("fact key"), hostile("fact value"))
        lsd.completeScenario(
            hostile("scenario"),
            hostile("description"),
            Status.ERROR,
            ScenarioError(hostile("headline"), hostile("message"), hostile("stack")),
        )
        lsd.completeReport(hostile("Report"))
        lsd.createIndex()

        val files = tempDir.listDirectoryEntries().filter { Files.isRegularFile(it) }
        assertEquals(
            setOf("report.html", "report.json", "diagram.html", "payloads.js", "index.html"),
            files.map { it.name.substringAfterLast('-') }.toSet(),
            files.map { it.name }.toString(),
        )
        for (file in files) {
            val text = utf8(Files.readAllBytes(file)) ?: error("${file.name} is not valid UTF-8")
            for (raw in listOf("<img src=x", "<svg onload", "</script><!--", "data-pwned=1>")) {
                assertFalse(text.contains(raw), "${file.name} contains raw $raw")
            }
            assertFalse(text.contains('\uD800'), "${file.name} contains a lone surrogate")
            if (!file.name.endsWith(".html") || file.name.endsWith("-diagram.html")) {
                assertFalse(text.contains('\u2028') || text.contains('\u2029'), "${file.name} has a raw line separator in script")
            }
        }

        val report = files.single { it.name.endsWith("-report.html") }.let(Files::readString)
        assertTrue(report.contains(escapedText("Report")), report)
        assertTrue(report.contains(escapedText("fact value")), report)
        assertTrue(report.contains(escapedText("message")), report)
        assertTrue(report.contains("<title>${escapedText("Report")}</title>"), report)

        val index = files.single { it.name == "index.html" }.let(Files::readString)
        assertTrue(index.contains(">${escapedText("Report")}</a>"), index)

        val diagram = files.single { it.name.endsWith("-diagram.html") }.let(Files::readString)
        val injected = diagram.substringAfter("<script>").substringBefore("</script>")
        assertTrue(injected.startsWith("window.__LSD_PAYLOADS_SRC__=") || injected.startsWith("window.__LSD_REPORT__="), injected.take(200))
        assertFalse(injected.contains('<'), "the injected report script contains '<'")
        assertTrue(injected.contains("\\u003cimg src=x onerror=alert(1)"), injected.take(500))
        assertValidJson(files.single { it.name.endsWith("-report.json") }.let(Files::readString))
    }

    private companion object {
        const val ATTACK = "\"'><img src=x onerror=alert(1) data-pwned=1></script><!--<svg onload=alert(2)>"

        fun hostile(tag: String) = "$tag$ATTACK\u2028\u0001\uD800"

        /** What [Html.text] must make of [hostile]: markup escaped, the control and lone surrogate replaced. */
        fun escapedText(tag: String) =
            "$tag\"'&gt;&lt;img src=x onerror=alert(1) data-pwned=1&gt;&lt;/script&gt;&lt;!--&lt;svg onload=alert(2)&gt;\u2028\uFFFD\uFFFD"

        fun utf8(bytes: ByteArray): String? =
            try {
                Charsets.UTF_8
                    .newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString()
            } catch (_: Exception) {
                null
            }
    }
}
