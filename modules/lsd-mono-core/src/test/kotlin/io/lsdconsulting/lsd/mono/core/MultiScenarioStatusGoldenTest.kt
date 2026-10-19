package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import kotlin.io.path.readText

/**
 * Locks the multi-scenario status contract: per-scenario `success` / `warn` / `error`
 * and the report-level rollup (worst of ERROR > WARN > SUCCESS).
 * `generatedAt` and `generator` are checked, then scrubbed; everything else must match the
 * golden byte-for-byte, so the golden does not change with the clock or the project version.
 */
@LsdTestConfig(deterministicIds = true)
class MultiScenarioStatusGoldenTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `three scenarios lock success warn and error with error rollup`() {
        val lsd = LsdContext()
        lsd.completeScenario("checkout happy path", "placed", Status.SUCCESS)
        lsd.completeScenario("payment declined", "card rejected", Status.WARN)
        lsd.completeScenario("inventory outage", "timeout", Status.ERROR)
        lsd.completeReport("Status mix")
        lsd.createIndex()

        val json = tempDir.resolve(ReportWriter.reportFileStem("Status mix") + "-report.json").readText()
        val generatedAt = GENERATED_AT.find(json)?.groupValues?.get(1) ?: error("no generatedAt in $json")
        val written = Instant.parse(generatedAt)
        assertTrue(generatedAt.endsWith("Z"), "generatedAt should be a UTC instant: $generatedAt")
        assertTrue(Duration.between(written, Instant.now()).abs() < Duration.ofMinutes(5), generatedAt)
        val projectVersion = System.getProperty("lsd.mono.test.projectVersion") ?: error("Gradle sets the project version")
        assertTrue(json.contains(""""generator": "lsd-mono-core $projectVersion""""), json)

        val scrubbed =
            GENERATOR.replace(
                GENERATED_AT.replace(json, """"generatedAt": "SCRUBBED""""),
                """"generator": "SCRUBBED"""",
            )
        val golden =
            javaClass
                .getResource("/golden/multi-scenario-status.json")
                ?.readText()
                ?: error("missing golden/multi-scenario-status.json")
        assertEquals(golden, scrubbed)

        assertEquals(1, count(scrubbed, """"status": "success""""))
        assertEquals(1, count(scrubbed, """"status": "warn""""))
        // report rollup + the error scenario
        assertEquals(2, count(scrubbed, """"status": "error""""))

        val index = tempDir.resolve("index.html").readText()
        val manifest = index.substringAfter("window.__LSD_INDEX__=").substringBefore(";</script>").replace(Regex("\\s+"), "")
        assertTrue(manifest.contains(""""status":"error","href""""), "index should use the error rollup")
        assertTrue(manifest.contains(""""counts":{"success":1,"warn":1,"error":1}"""), "index should count the three scenarios")
    }

    private fun count(text: String, needle: String): Int = Regex(Regex.escape(needle)).findAll(text).count()

    companion object {
        private val GENERATED_AT = Regex(""""generatedAt": "([^"]*)"""")
        private val GENERATOR = Regex(""""generator": "[^"]*"""")
    }
}
