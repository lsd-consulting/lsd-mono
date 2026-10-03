package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * Locks the multi-scenario status contract: per-scenario `success` / `warn` / `error`
 * and the report-level rollup (worst of ERROR > FAILURE > SUCCESS).
 * `generatedAt` is scrubbed; everything else must match the golden byte-for-byte.
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
        val scrubbed = GENERATED_AT.replace(json, """"generatedAt": "SCRUBBED"""")
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
        private val GENERATED_AT = Regex(""""generatedAt": "[^"]*"""")
    }
}
