package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
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
 * and the report-level rollup (worst of ERROR > FAILURE > SUCCESS).
 * `generatedAt` and `generator` are checked, then scrubbed; everything else must match the
 * golden byte-for-byte, so the golden does not change with the clock or the project version.
 */
class MultiScenarioStatusGoldenTest {

    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun deterministicOutput() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
    }

    @Test
    fun `three scenarios lock success warn and error with error rollup`() {
        val lsd = LsdContext()
        lsd.completeScenario("checkout happy path", "placed", Status.SUCCESS)
        lsd.completeScenario("payment declined", "card rejected", Status.FAILURE)
        lsd.completeScenario("inventory outage", "timeout", Status.ERROR)
        lsd.completeReport("Status mix")
        lsd.createIndex()

        val json = tempDir.resolve("Status-mix-report.json").readText()
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
            javaClass.getResource("/golden/multi-scenario-status.json")
                ?.readText()
                ?: error("missing golden/multi-scenario-status.json")
        assertEquals(golden, scrubbed)

        assertEquals(1, count(scrubbed, """"status": "success""""))
        assertEquals(1, count(scrubbed, """"status": "warn""""))
        // report rollup + the error scenario
        assertEquals(2, count(scrubbed, """"status": "error""""))

        val index = tempDir.resolve("index.html").readText()
        assertTrue(index.contains("""class="error""""), "index should use the error rollup")
        assertTrue(index.contains(">error<"), "index status cell should say error")
    }

    private fun count(text: String, needle: String): Int = Regex(Regex.escape(needle)).findAll(text).count()

    companion object {
        private val GENERATED_AT = Regex(""""generatedAt": "([^"]*)"""")
        private val GENERATOR = Regex(""""generator": "[^"]*"""")
    }
}
