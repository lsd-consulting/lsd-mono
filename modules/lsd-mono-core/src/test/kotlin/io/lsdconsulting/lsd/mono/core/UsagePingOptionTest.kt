package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.model.ReportSource
import io.lsdconsulting.lsd.mono.core.properties.LsdConfig
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import io.lsdconsulting.lsd.mono.core.report.reportWriter
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * `lsd.mono.report.usagePing` and the report's `source`: what the report page's usage ping
 * (report/src/lib/usage-ping.ts) reads. The page itself decides whether to send anything.
 */
@LsdTestConfig
class UsagePingOptionTest {
    @TempDir
    lateinit var tempDir: Path

    private fun write(source: String? = null): String {
        val lsd = LsdContext()
        lsd.message("A", "B", "hello")
        lsd.completeScenario("one")
        if (source == null) lsd.completeReport("Ping") else @OptIn(InternalLsdApi::class) lsd.completeReport("Ping", null, source)
        return tempDir.resolve(ReportWriter.reportFileStem("Ping") + "-report.json").readText()
    }

    @Test
    fun `reports allow the ping by default and record the API as their source`() {
        val json = write()
        assertTrue(json.contains(""""usagePing": true"""), json)
        assertTrue(json.contains(""""source": "api""""), json)
    }

    @Test
    fun `usagePing false is written into the report, the diagram page and the index`() {
        System.setProperty(LsdProperties.USAGE_PING, "false")
        val json = write()
        assertTrue(json.contains(""""usagePing": false"""), json)
        val diagram = tempDir.resolve(ReportWriter.reportFileStem("Ping") + "-diagram.html").readText()
        assertTrue(Regex(""""usagePing"\s*:\s*false""").containsMatchIn(diagram), "the page decides from the report it carries")
        val manifest = reportWriter().writeIndex(emptyList(), tempDir.toFile()).readText().substringAfter("window.__LSD_INDEX__=")
        assertTrue(Regex(""""options"\s*:\s*\{\s*"usagePing"\s*:\s*false\s*}""").containsMatchIn(manifest), manifest.take(300))
    }

    @Test
    fun `an unrecognised usagePing value keeps the default`() {
        System.setProperty(LsdProperties.USAGE_PING, "nope")
        assertEquals(true, LsdProperties.usagePing())
    }

    @Test
    fun `an integration records its own source, and an unknown one counts as the API`() {
        assertTrue(write("junit").contains(""""source": "junit""""))
        assertTrue(write("cucumber").contains(""""source": "cucumber""""))
        assertTrue(write("testng").contains(""""source": "api""""))
    }

    @Test
    fun `every source has its ping file in the repository, so a tagged release serves it`() {
        val ping = Path.of("../../ping")
        for (source in ReportSource.ALL) {
            val file = ping.resolve("source-$source.txt")
            assertTrue(Files.isRegularFile(file), "missing $file")
            assertEquals(1L, Files.size(file), "$file is one byte")
        }
    }
}
