package io.lsdconsulting.lsd.mono.example.adapter

import io.lsdconsulting.lsd.mono.report.html.ReportWriter
import io.lsdconsulting.lsd.mono.report.html.ReportWriterSettings
import io.lsdconsulting.lsd.mono.report.model.DividerEventJson
import io.lsdconsulting.lsd.mono.report.model.FactJson
import io.lsdconsulting.lsd.mono.report.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.lsdconsulting.lsd.mono.report.model.MetricJson
import io.lsdconsulting.lsd.mono.report.model.NoteEventJson
import io.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.lsdconsulting.lsd.mono.report.model.ReportJson
import io.lsdconsulting.lsd.mono.report.model.ReportOptionsJson
import io.lsdconsulting.lsd.mono.report.model.ReportSchema
import io.lsdconsulting.lsd.mono.report.model.ReportSource
import io.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.lsdconsulting.lsd.mono.report.model.ScenarioTimingJson
import io.lsdconsulting.lsd.mono.report.model.SectionEventJson
import io.lsdconsulting.lsd.mono.report.model.testing.ReportCorpus
import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Instant
import kotlin.io.path.readText

/**
 * An adapter outside lsd-mono-core: it builds a report from lsd-mono-report-model alone and writes
 * it with lsd-mono-report-html. This package is outside the writer's, so the test sees only the two
 * modules' public API, and core is not on this module's classpath at all.
 */
class AdapterReportTest {
    @Test
    fun `lsd-mono-core is not on the classpath`() {
        assertThrows(ClassNotFoundException::class.java) { Class.forName("io.lsdconsulting.lsd.mono.core.LsdContext") }
    }

    @Test
    fun `a report built from the model alone is the shared minimal report, byte for byte`(
        @TempDir dir: Path,
    ) {
        val written = writer().writeReport(minimal(), dir.toFile())
        assertEquals(ReportCorpus.read("reports/minimal.json"), written.reportJson.readText())
        assertEquals(ReportCorpus.read("reports/minimal.json"), ReportWriter.toJson(minimal()))
    }

    @Test
    fun `an adapter's report, its page and the index follow the schemas`(
        @TempDir dir: Path,
    ) {
        val writer = writer()
        val written = writer.writeReport(checkout(), dir.toFile())
        writer.writeIndex(dir.toFile())

        assertEquals(4, ReportSchemas.assertOutputValid(dir), "the JSON, page, data script and index")
        val page = written.diagramHtml.readText()
        assertTrue(page.contains("window.__LSD_REPORT__="), "the page carries the report")
        assertTrue(page.contains("\"schemaVersion\": \"${ReportSchema.VERSION}\""), "at the model's schema version")
        assertTrue(page.length > 100_000, "the page has the report UI bundled, ${page.length} characters")
        val index = dir.resolve("index.html").readText()
        assertTrue(index.contains("\"generator\": \"example-adapter 1.0\""), "the index names the adapter")
    }

    private fun writer() =
        ReportWriter(ReportWriterSettings(generator = "example-adapter 1.0", generatedAt = Instant.parse(GENERATED_AT), usagePing = false))

    /** What lsd-mono-core writes for one empty scenario, built here without it. */
    private fun minimal() =
        ReportJson(
            title = "Minimal",
            generatedAt = GENERATED_AT,
            generator = "lsd-mono-core (conformance)",
            status = "success",
            options = ReportOptionsJson(usagePing = false),
            scenarios =
                listOf(
                    ScenarioJson(
                        id = "1",
                        title = "Minimal",
                        status = "success",
                        description = "",
                        facts = emptyList(),
                        metrics = listOf(MetricJson("Messages", "0")),
                        timing = structureOnly(),
                    ),
                ),
        )

    /** A report as an adapter for another framework might build it: two services and an exchange. */
    private fun checkout() =
        ReportJson(
            title = "Checkout",
            generatedAt = GENERATED_AT,
            generator = "example-adapter 1.0",
            status = "error",
            options = ReportOptionsJson(usagePing = false, source = ReportSource.API),
            scenarios =
                listOf(
                    ScenarioJson(
                        id = "checkout-1",
                        title = "Place an order",
                        status = "success",
                        description = "The shop places an order with the payments service.",
                        facts = listOf(FactJson("orderId", "A-17")),
                        participants =
                            listOf(
                                ParticipantJson("shop", "Shop", type = "ACTOR"),
                                ParticipantJson("payments", "Payments", type = "CONTROL", colour = "#3b82f6"),
                            ),
                        events =
                            listOf(
                                SectionEventJson("s1", "Pay"),
                                MessageEventJson("m1", "shop", "payments", "POST /payments", "SYNCHRONOUS", data = mapOf("amount" to 12.5)),
                                LifelineEventJson(LifelineEventJson.ACTIVATE, "a1", "payments"),
                                NoteEventJson("n1", "checks the card", over = "payments"),
                                LifelineEventJson(LifelineEventJson.DEACTIVATE, "a2", "payments"),
                                MessageEventJson("m2", "payments", "shop", "201 Created", "SYNCHRONOUS_RESPONSE", status = "201"),
                                DividerEventJson("d1", "done"),
                            ),
                        timing = structureOnly(),
                    ),
                    ScenarioJson(
                        id = "checkout-2",
                        title = "Card declined",
                        status = "error",
                        description = "",
                        facts = emptyList(),
                    ),
                ),
        )

    private fun structureOnly() =
        ScenarioTimingJson(
            accuracy = "STRUCTURE_ONLY",
            measuredCoverage = null,
            pairingCoverage = null,
            sources = emptyList(),
            wallClockMs = null,
            clockOrdering = "SAME_SOURCE",
            clockOrdered = 0,
            warnings = emptyList(),
            reorderedByClock = emptyList(),
        )

    private companion object {
        const val GENERATED_AT = "2026-01-01T12:00:00Z"
    }
}
