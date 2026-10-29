package io.github.lsdconsulting.lsd.mono.example.adapter

import io.github.lsdconsulting.lsd.mono.report.html.ReportWriter
import io.github.lsdconsulting.lsd.mono.report.html.ReportWriterSettings
import io.github.lsdconsulting.lsd.mono.report.model.AccuracyJson
import io.github.lsdconsulting.lsd.mono.report.model.ClockOrderingJson
import io.github.lsdconsulting.lsd.mono.report.model.DataValueJson
import io.github.lsdconsulting.lsd.mono.report.model.DividerEventJson
import io.github.lsdconsulting.lsd.mono.report.model.KnownMessageOrigin
import io.github.lsdconsulting.lsd.mono.report.model.KnownMessageType
import io.github.lsdconsulting.lsd.mono.report.model.KnownParticipantType
import io.github.lsdconsulting.lsd.mono.report.model.KnownReportSource
import io.github.lsdconsulting.lsd.mono.report.model.LifelineEventJson
import io.github.lsdconsulting.lsd.mono.report.model.LifelineKindJson
import io.github.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.github.lsdconsulting.lsd.mono.report.model.NoteEventJson
import io.github.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportOptionsJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportSchema
import io.github.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.github.lsdconsulting.lsd.mono.report.model.SectionEventJson
import io.github.lsdconsulting.lsd.mono.report.model.StatusJson
import io.github.lsdconsulting.lsd.mono.report.model.TraceJson
import io.github.lsdconsulting.lsd.mono.report.model.testing.Json
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportCorpus
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Instant
import kotlin.io.path.readText

/**
 * An adapter outside lsd-mono-jvm: it builds a report from lsd-mono-report-model alone and writes
 * it with lsd-mono-report-html. This package is outside the writer's, so the test sees only the two
 * modules' public API, and core is not on this module's classpath at all.
 */
class AdapterReportTest {
    @Test
    fun `lsd-mono-jvm is not on the classpath`() {
        assertThrows(ClassNotFoundException::class.java) { Class.forName("io.github.lsdconsulting.lsd.mono.jvm.LsdContext") }
    }

    @Test
    fun `a report built from the model alone is the shared minimal report, byte for byte`(
        @TempDir dir: Path,
    ) {
        val written = writer().writeReport(minimal(), dir)
        assertEquals(ReportCorpus.read("reports/minimal.json"), written.reportJson.readText())
        assertEquals(ReportCorpus.read("reports/minimal.json"), ReportWriter.toJson(minimal()))
    }

    @Test
    fun `an adapter's report, its page and the index follow the schemas`(
        @TempDir dir: Path,
    ) {
        val writer = writer()
        val written = writer.writeReport(checkout(), dir)
        writer.writeIndex(dir)

        assertEquals(4, ReportSchemas.assertOutputValid(dir), "the JSON, page, data script and index")
        val page = written.diagramHtml.readText()
        val report = Json.parse(ReportSchemas.between(page, "window.__LSD_REPORT__=", ";</script>")) as JsonObject
        assertEquals(ReportSchema.VERSION, report.string("schemaVersion"), "the page carries the report, at the model's schema version")
        assertTrue(page.length > 100_000, "the page has the report UI bundled, ${page.length} characters")
        val index = Json.parse(ReportSchemas.between(dir.resolve("index.html").readText(), "window.__LSD_INDEX__=", ";</script>")) as JsonObject
        assertEquals("example-adapter 1.0", index.string("generator"), "the index names the adapter")
    }

    private fun writer() =
        ReportWriter(ReportWriterSettings(generator = "example-adapter 1.0", generatedAt = Instant.parse(GENERATED_AT), usagePing = false))

    /** What lsd-mono-jvm writes for one empty scenario, built here without it. */
    private fun minimal() =
        ReportJson
            .builder(title = "Minimal", generatedAt = GENERATED_AT, generator = "lsd-mono-jvm (conformance)", status = StatusJson.SUCCESS)
            .options(ReportOptionsJson.builder().usagePing(false).build())
            .scenario(
                ScenarioJson
                    .builder(id = "1", title = "Minimal", status = StatusJson.SUCCESS)
                    .metric("Messages", "0")
                    // The timing summary core writes when nothing was timed.
                    .accuracy(AccuracyJson.STRUCTURE_ONLY)
                    .sources(emptyList())
                    .clockOrdering(ClockOrderingJson.SAME_SOURCE)
                    .clockOrdered(0)
                    .build(),
            ).build()

    /** A report as an adapter for another framework might build it: two services and an exchange, one call imported from spans. */
    private fun checkout() =
        ReportJson
            .builder(title = "Checkout", generatedAt = GENERATED_AT, generator = "example-adapter 1.0", status = StatusJson.ERROR)
            .options(
                ReportOptionsJson
                    .builder()
                    .usagePing(false)
                    .source(KnownReportSource.API)
                    .build(),
            ).scenario(
                ScenarioJson
                    .builder(id = "checkout-1", title = "Place an order", status = StatusJson.SUCCESS)
                    .description("The shop places an order with the payments service.")
                    .fact("orderId", "A-17")
                    .participant(ParticipantJson.builder("shop", "Shop").type(KnownParticipantType.ACTOR).build())
                    .participant(
                        ParticipantJson
                            .builder("payments", "Payments")
                            .type("CONTROL")
                            .colour("#3b82f6")
                            .build(),
                    ).event(SectionEventJson.builder("s1", "Pay").build())
                    .event(
                        MessageEventJson
                            .builder("m1", "shop", "payments", "POST /payments", KnownMessageType.SYNCHRONOUS)
                            .data(DataValueJson.ofObject(mapOf("amount" to DataValueJson.of(12.5))))
                            .trace(TraceJson("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7"))
                            .attribute("http.request.method", "POST")
                            .attribute("http.route", "/payments")
                            .origin(KnownMessageOrigin.IMPORTED)
                            .build(),
                    ).event(LifelineEventJson.builder(LifelineKindJson.ACTIVATE, "a1", "payments").build())
                    .event(NoteEventJson.builder("n1", "checks the card").over("payments").build())
                    .event(LifelineEventJson.builder(LifelineKindJson.DEACTIVATE, "a2", "payments").build())
                    .event(
                        MessageEventJson
                            .builder("m2", "payments", "shop", "201 Created", KnownMessageType.SYNCHRONOUS_RESPONSE)
                            .status("201")
                            .attribute("http.response.status_code", 201)
                            .build(),
                    ).event(DividerEventJson.builder("d1", "done").build())
                    // The timing summary core writes when nothing was timed.
                    .accuracy(AccuracyJson.STRUCTURE_ONLY)
                    .sources(emptyList())
                    .clockOrdering(ClockOrderingJson.SAME_SOURCE)
                    .clockOrdered(0)
                    .build(),
            ).scenario(ScenarioJson.builder(id = "checkout-2", title = "Card declined", status = StatusJson.ERROR).build())
            .build()

    private companion object {
        const val GENERATED_AT = "2026-01-01T12:00:00Z"
    }
}
