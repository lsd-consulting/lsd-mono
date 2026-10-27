package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdConfig
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.report.reportWriter
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import io.github.lsdconsulting.lsd.mono.report.model.KnownReportSource
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

/**
 * `lsd.mono.report.usagePing` and the report's `source`: what the report page's usage ping
 * (report/src/lib/usage-ping.ts) reads. The page itself decides whether to send anything.
 */
@LsdTestConfig
class UsagePingOptionTest {
    @TempDir
    lateinit var tempDir: Path

    /** The report's options. */
    private fun write(source: String? = null): JsonObject {
        val lsd = LsdContext()
        lsd.message("A", "B", "hello")
        lsd.completeScenario("one")
        if (source == null) lsd.completeReport("Ping") else @OptIn(InternalLsdApi::class) lsd.completeReport("Ping", null, source)
        return ReportJson.read(tempDir.resolve(ReportFileNames.stem("Ping") + "-report.json")).options
    }

    @Test
    fun `reports allow the ping by default and record the API as their source`() {
        val options = write()
        assertEquals(true, options["usagePing"], options.source)
        assertEquals("api", options["source"], options.source)
    }

    @Test
    fun `usagePing false is written into the report, the diagram page and the index`() {
        System.setProperty(LsdProperties.USAGE_PING, "false")
        val options = write()
        assertEquals(false, options["usagePing"], options.source)
        val diagram = ReportJson.diagram(tempDir.resolve(ReportFileNames.stem("Ping") + "-diagram.html"))
        assertEquals(false, diagram.options["usagePing"], "the page decides from the report it carries")
        val manifest = ReportJson.index(reportWriter().writeIndex(tempDir.toFile()).parent)
        assertEquals(mapOf("usagePing" to false), manifest.obj("options")?.toMap(), manifest.source.take(300))
    }

    @Test
    fun `an unrecognised usagePing value keeps the default`() {
        System.setProperty(LsdProperties.USAGE_PING, "nope")
        assertEquals(true, LsdProperties.usagePing())
    }

    @Test
    fun `an integration records its own source, and an unknown one counts as the API`() {
        assertEquals("junit", write("junit")["source"])
        assertEquals("cucumber", write("cucumber")["source"])
        assertEquals("api", write("testng")["source"])
    }

    @Test
    fun `every source has its ping file in the repository, so a tagged release serves it`() {
        val ping = Path.of("../../ping")
        for (source in KnownReportSource.ALL) {
            val file = ping.resolve("source-$source.txt")
            assertTrue(Files.isRegularFile(file), "missing $file")
            assertEquals(1L, Files.size(file), "$file is one byte")
        }
    }
}
