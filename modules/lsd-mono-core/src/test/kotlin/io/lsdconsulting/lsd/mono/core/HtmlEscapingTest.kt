package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.report.model.testing.assertValidJson
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

/** A whole hostile report proving nothing leaks (#28). lsd-mono-report-html's HtmlTest tests each escaper. */
@LsdTestConfig
class HtmlEscapingTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `a hostile report leaks into none of the files written for it`() {
        val lsd = LsdContext()
        lsd.message(hostile("Client"), hostile("Api"), hostile("label"), data = mapOf(hostile("key") to hostile("value"), "method" to hostile("method")))
        lsd.response(hostile("Api"), hostile("Client"), hostile("response"), data = hostile("body"))
        lsd.note(hostile("note"), on = hostile("Api"))
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
            setOf("report.json", "report.js", "diagram.html", "payloads.js", "index.html"),
            files.map { it.name.substringAfterLast('-') }.toSet(),
            files.map { it.name }.toString(),
        )
        for (file in files) {
            val text = utf8(Files.readAllBytes(file)) ?: error("${file.name} is not valid UTF-8")
            for (raw in listOf("<img src=x", "<svg onload", "</script><!--", "data-pwned=1>")) {
                assertFalse(text.contains(raw), "${file.name} contains raw $raw")
            }
            assertFalse(text.contains('\uD800'), "${file.name} contains a lone surrogate")
            if (!file.name.endsWith(".html") || file.name.endsWith("-diagram.html") || file.name == "index.html") {
                assertFalse(text.contains('\u2028') || text.contains('\u2029'), "${file.name} has a raw line separator in script")
            }
        }

        val index = files.single { it.name == "index.html" }.let(Files::readString)
        assertTrue(index.contains("window.__LSD_INDEX__="), index.take(500))
        assertTrue(index.contains("<title>LSD reports</title>"), "the index page title is fixed, not a report's")

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

        /** What `Html.text` must make of [hostile]: markup escaped, the control and lone surrogate replaced. */
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
