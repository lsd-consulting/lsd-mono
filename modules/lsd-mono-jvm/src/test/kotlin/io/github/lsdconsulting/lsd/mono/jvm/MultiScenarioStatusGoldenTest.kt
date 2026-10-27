package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import io.github.lsdconsulting.lsd.mono.report.model.testing.Json
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
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
        val report = ReportJson(json)
        val generatedAt = report.root.string("generatedAt") ?: error("no generatedAt in $json")
        val written = Instant.parse(generatedAt)
        assertTrue(generatedAt.endsWith("Z"), "generatedAt should be a UTC instant: $generatedAt")
        assertTrue(Duration.between(written, Instant.now()).abs() < Duration.ofMinutes(5), generatedAt)
        val projectVersion = System.getProperty("lsd.mono.test.projectVersion") ?: error("Gradle sets the project version")
        assertEquals("lsd-mono-jvm $projectVersion", report.root["generator"], json)

        Conformance.assertProduced("reports/multi-scenario-status.json", json)

        assertEquals(listOf("success", "warn", "error"), report.scenarios.map { it.status })
        assertEquals("error", report.root["status"], "the report rolls up to error")

        val index = tempDir.resolve("index.html").readText()
        val indexJson = index.substringAfter("window.__LSD_INDEX__=").substringBefore(";</script>")
        Conformance.assertProduced("indexes/status-mix.json", indexJson + "\n", Conformance.INDEX_SCHEMA)
        val entry = (Json.parse(indexJson) as JsonObject).objects("reports").single()
        assertEquals("error", entry["status"], "index should use the error rollup")
        assertEquals(
            mapOf("success" to 1.0, "warn" to 1.0, "error" to 1.0),
            entry.obj("counts")?.toMap(),
            "index should count the three scenarios",
        )
    }
}
