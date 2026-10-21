package io.lsdconsulting.lsd.mono.example.adapter

import io.lsdconsulting.lsd.mono.report.html.ReportWriter
import io.lsdconsulting.lsd.mono.report.html.ReportWriterSettings
import io.lsdconsulting.lsd.mono.report.model.AccuracyJson
import io.lsdconsulting.lsd.mono.report.model.ClockOrderingJson
import io.lsdconsulting.lsd.mono.report.model.DividerEventJson
import io.lsdconsulting.lsd.mono.report.model.FactJson
import io.lsdconsulting.lsd.mono.report.model.KnownMessageType
import io.lsdconsulting.lsd.mono.report.model.KnownParticipantType
import io.lsdconsulting.lsd.mono.report.model.KnownReportSource
import io.lsdconsulting.lsd.mono.report.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.report.model.LifelineKindJson
import io.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.lsdconsulting.lsd.mono.report.model.MetricJson
import io.lsdconsulting.lsd.mono.report.model.NoteEventJson
import io.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.lsdconsulting.lsd.mono.report.model.ReportJson
import io.lsdconsulting.lsd.mono.report.model.ReportOptionsJson
import io.lsdconsulting.lsd.mono.report.model.ReportSchema
import io.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.lsdconsulting.lsd.mono.report.model.SectionEventJson
import io.lsdconsulting.lsd.mono.report.model.StatusJson
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
            status = StatusJson.SUCCESS,
            options = ReportOptionsJson(usagePing = false),
            scenarios =
                listOf(
                    ScenarioJson(
                        id = "1",
                        title = "Minimal",
                        status = StatusJson.SUCCESS,
                        description = "",
                        facts = emptyList(),
                        metrics = listOf(MetricJson("Messages", "0")),
                        // The timing summary core writes when nothing was timed.
                        accuracy = AccuracyJson.STRUCTURE_ONLY,
                        sources = emptyList(),
                        clockOrdering = ClockOrderingJson.SAME_SOURCE,
                        clockOrdered = 0,
                    ),
                ),
        )

    /** A report as an adapter for another framework might build it: two services and an exchange. */
    private fun checkout() =
        ReportJson(
            title = "Checkout",
            generatedAt = GENERATED_AT,
            generator = "example-adapter 1.0",
            status = StatusJson.ERROR,
            options = ReportOptionsJson(usagePing = false, source = KnownReportSource.API),
            scenarios =
                listOf(
                    ScenarioJson(
                        id = "checkout-1",
                        title = "Place an order",
                        status = StatusJson.SUCCESS,
                        description = "The shop places an order with the payments service.",
                        facts = listOf(FactJson("orderId", "A-17")),
                        participants =
                            listOf(
                                ParticipantJson("shop", "Shop", type = KnownParticipantType.ACTOR),
                                ParticipantJson("payments", "Payments", type = "CONTROL", colour = "#3b82f6"),
                            ),
                        events =
                            listOf(
                                SectionEventJson("s1", "Pay"),
                                MessageEventJson("m1", "shop", "payments", "POST /payments", KnownMessageType.SYNCHRONOUS, data = mapOf("amount" to 12.5)),
                                LifelineEventJson(LifelineKindJson.ACTIVATE, "a1", "payments"),
                                NoteEventJson("n1", "checks the card", over = "payments"),
                                LifelineEventJson(LifelineKindJson.DEACTIVATE, "a2", "payments"),
                                MessageEventJson("m2", "payments", "shop", "201 Created", KnownMessageType.SYNCHRONOUS_RESPONSE, status = "201"),
                                DividerEventJson("d1", "done"),
                            ),
                        // The timing summary core writes when nothing was timed.
                        accuracy = AccuracyJson.STRUCTURE_ONLY,
                        sources = emptyList(),
                        clockOrdering = ClockOrderingJson.SAME_SOURCE,
                        clockOrdered = 0,
                    ),
                    ScenarioJson(
                        id = "checkout-2",
                        title = "Card declined",
                        status = StatusJson.ERROR,
                        description = "",
                        facts = emptyList(),
                    ),
                ),
        )

    private companion object {
        const val GENERATED_AT = "2026-01-01T12:00:00Z"
    }
}
