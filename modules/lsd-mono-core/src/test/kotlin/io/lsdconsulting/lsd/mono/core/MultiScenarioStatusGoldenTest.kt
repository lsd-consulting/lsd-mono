package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import kotlin.io.path.readText

/**
 * Locks the multi-scenario status contract: per-scenario `success` / `warn` / `error`
 * and the report-level rollup (worst of ERROR > WARN > SUCCESS), with the index that lists it.
 * `generatedAt` and `generator` are checked, then set to the corpus's ([Conformance]); everything
 * else must match the shared test reports byte for byte.
 */
@LsdTestConfig(deterministicIds = true)
class MultiScenarioStatusGoldenTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `three scenarios lock success warn and error with error rollup`() {
        Conformance.produce()
        val lsd = LsdContext()
        lsd.completeScenario("checkout happy path", "placed", Status.SUCCESS)
        lsd.completeScenario("payment declined", "card rejected", Status.WARN)
        lsd.completeScenario("inventory outage", "timeout", Status.ERROR)
        lsd.completeReport("Status mix")
        lsd.createIndex()

        val json = tempDir.resolve(ReportFileNames.stem("Status mix") + "-report.json").readText()
        val generatedAt = GENERATED_AT.find(json)?.groupValues?.get(1) ?: error("no generatedAt in $json")
        val written = Instant.parse(generatedAt)
        assertTrue(generatedAt.endsWith("Z"), "generatedAt should be a UTC instant: $generatedAt")
        assertTrue(Duration.between(written, Instant.now()).abs() < Duration.ofMinutes(5), generatedAt)
        val projectVersion = System.getProperty("lsd.mono.test.projectVersion") ?: error("Gradle sets the project version")
        assertTrue(json.contains(""""generator": "lsd-mono-core $projectVersion""""), json)

        Conformance.assertProduced("reports/multi-scenario-status.json", json)

        assertEquals(1, count(json, """"status": "success""""))
        assertEquals(1, count(json, """"status": "warn""""))
        // report rollup + the error scenario
        assertEquals(2, count(json, """"status": "error""""))

        val index = tempDir.resolve("index.html").readText()
        val indexJson = index.substringAfter("window.__LSD_INDEX__=").substringBefore(";</script>")
        Conformance.assertProduced("indexes/status-mix.json", indexJson + "\n", Conformance.INDEX_SCHEMA)
        val manifest = indexJson.replace(Regex("\\s+"), "")
        assertTrue(manifest.contains(""""status":"error","href""""), "index should use the error rollup")
        assertTrue(manifest.contains(""""counts":{"success":1,"warn":1,"error":1}"""), "index should count the three scenarios")
    }

    private fun count(text: String, needle: String): Int = Regex(Regex.escape(needle)).findAll(text).count()

    companion object {
        private val GENERATED_AT = Regex(""""generatedAt": "([^"]*)"""")
    }
}
