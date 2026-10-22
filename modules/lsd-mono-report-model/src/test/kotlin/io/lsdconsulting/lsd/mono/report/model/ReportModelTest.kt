package io.lsdconsulting.lsd.mono.report.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class ReportModelTest {
    @Test
    fun `a report needs only what the schema requires, and the rest has the page's defaults`() {
        val report =
            ReportJson(
                title = "Orders",
                generatedAt = "2026-10-21T08:00:00Z",
                generator = "my-adapter 1.0",
                status = StatusJson.SUCCESS,
                scenarios = emptyList(),
            )
        assertEquals(ReportOptionsJson(metricsEnabled = true, labelMaxWidth = 200, usagePing = true, source = "api"), report.options)
        val scenario = ScenarioJson(id = "s1", title = "Place an order", status = StatusJson.SUCCESS, description = "", facts = emptyList())
        assertEquals(emptyList<EventJson>(), scenario.events)
        assertNull(scenario.accuracy, "the page works the timing out")
        assertNull(scenario.sources)
        assertEquals("PARTICIPANT", ParticipantJson("a", "A").type)
        assertEquals(NotePlacementJson.OVER, NoteEventJson("n1", "hello").placement)
    }

    @Test
    fun `every event has an id and an optional start`() {
        val events: List<EventJson> =
            listOf(
                MessageEventJson(id = "m1", from = "a", to = "b", label = "hi", type = KnownMessageType.SYNCHRONOUS, startedAt = "2026-10-21T08:00:00Z"),
                NoteEventJson("n1", "note"),
                DelayEventJson("d1"),
                SpacerEventJson("sp1"),
                DividerEventJson("dv1", "then"),
                SectionEventJson("se1", "Checkout"),
                LifelineEventJson(LifelineKindJson.ACTIVATE, "l1", "a"),
            )
        assertEquals(listOf("m1", "n1", "d1", "sp1", "dv1", "se1", "l1"), events.map { it.id })
        assertEquals(listOf("2026-10-21T08:00:00Z"), events.mapNotNull { it.startedAt })
    }

    @Test
    fun `attribute values are OpenTelemetry's kinds, and never NaN or infinite`() {
        assertEquals("x", AttributeValueJson.of("x").value)
        assertEquals(true, AttributeValueJson.of(true).value)
        assertEquals(12L, AttributeValueJson.of(12L).value)
        assertEquals(AttributeValueJson.of(200L), AttributeValueJson.of(200), "an Int is kept as a Long")
        assertEquals(1.5, AttributeValueJson.of(1.5).value)
        assertEquals(listOf("a"), AttributeValueJson.ofStrings(listOf("a")).value)
        assertEquals(listOf(true), AttributeValueJson.ofBooleans(listOf(true)).value)
        assertEquals(listOf(1L), AttributeValueJson.ofLongs(listOf(1L)).value)
        assertEquals(listOf(0.5), AttributeValueJson.ofDoubles(listOf(0.5)).value)
        assertNotEquals(AttributeValueJson.of(1L), AttributeValueJson.of(1.0), "a whole number is not a double")
        assertEquals(AttributeValueJson.of("x").hashCode(), AttributeValueJson.of("x").hashCode())
        assertEquals("AttributeValueJson(x)", AttributeValueJson.of("x").toString())
        assertThrows(IllegalArgumentException::class.java) { AttributeValueJson.of(Double.NaN) }
        assertThrows(IllegalArgumentException::class.java) { AttributeValueJson.ofDoubles(listOf(1.0, Double.POSITIVE_INFINITY)) }
    }

    @Test
    fun `a trace is frozen at three ids, W3C or B3`() {
        val w3c = TraceJson("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", "53995c3f42cd8ad8")
        val b3 = TraceJson("a3ce929d0e0e4736", "00f067aa0ba902b7", null)
        assertEquals(listOf("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", "53995c3f42cd8ad8"), listOf(w3c.traceId, w3c.spanId, w3c.parentSpanId))
        assertEquals(16, b3.traceId.length, "a B3 64-bit trace id is kept as it is")
        assertNull(b3.parentSpanId)
    }

    @Test
    fun `the small values hold what they are given`() {
        assertEquals(listOf("k", "v"), FactJson("k", "v").let { listOf(it.key, it.value) })
        assertEquals(listOf("Messages", "2"), MetricJson("Messages", "2").let { listOf(it.key, it.value) })
        assertEquals(listOf("SKEW", "skew"), WarningJson(KnownWarningKind.SKEW, "skew").let { listOf(it.kind, it.message) })
        val pair = PairAccuracyJson("a", "b", AccuracyJson.MEASURED)
        assertEquals(listOf("a", "b", "MEASURED"), listOf(pair.from, pair.to, pair.accuracy.json))
        val error = ScenarioErrorJson("AssertionError", "expected 2", "at Test.kt:1")
        assertEquals(listOf("AssertionError", "expected 2", "at Test.kt:1"), listOf(error.headline, error.message, error.stack))
    }

    @Test
    fun `a message's attributes and origin are optional`() {
        val message = MessageEventJson(id = "m1", from = "a", to = "b", label = "hi", type = KnownMessageType.SYNCHRONOUS)
        assertEquals(emptyMap<String, AttributeValueJson>(), message.attributes)
        assertNull(message.origin, "no origin is captured")
        assertEquals(listOf("captured", "imported"), KnownMessageOrigin.ALL)
    }

    @Test
    fun `the schema version is a runtime value`() {
        assertEquals(true, Regex("""\d+\.\d+\.\d+""").matches(ReportSchema.VERSION))
        val field = ReportSchema::class.java.getField("VERSION")
        assertEquals(ReportSchema.VERSION, field.get(null))
    }
}
