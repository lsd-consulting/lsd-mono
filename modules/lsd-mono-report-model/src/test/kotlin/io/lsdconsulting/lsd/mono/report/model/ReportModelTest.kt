package io.lsdconsulting.lsd.mono.report.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class ReportModelTest {
    @Test
    fun `a report needs only what the schema requires, and the rest has the page's defaults`() {
        val report =
            ReportJson(title = "Orders", generatedAt = "2026-10-21T08:00:00Z", generator = "my-adapter 1.0", status = "success", scenarios = emptyList())
        assertEquals(ReportOptionsJson(metricsEnabled = true, labelMaxWidth = 200, usagePing = true, source = "api"), report.options)
        val scenario = ScenarioJson(id = "s1", title = "Place an order", status = "success", description = "", facts = emptyList())
        assertEquals(emptyList<EventJson>(), scenario.events)
        assertNull(scenario.timing, "the page works the timing out")
        assertEquals("PARTICIPANT", ParticipantJson("a", "A").type)
        assertEquals("over", NoteEventJson("n1", "hello").placement)
    }

    @Test
    fun `every event has an id and an optional start`() {
        val events: List<EventJson> =
            listOf(
                MessageEventJson(id = "m1", from = "a", to = "b", label = "hi", type = "SYNCHRONOUS", startedAt = "2026-10-21T08:00:00Z"),
                NoteEventJson("n1", "note"),
                DelayEventJson("d1"),
                SpacerEventJson("sp1"),
                DividerEventJson("dv1", "then"),
                SectionEventJson("se1", "Checkout"),
                LifelineEventJson(LifelineEventJson.ACTIVATE, "l1", "a"),
            )
        assertEquals(listOf("m1", "n1", "d1", "sp1", "dv1", "se1", "l1"), events.map { it.id })
        assertEquals(listOf("2026-10-21T08:00:00Z"), events.mapNotNull { it.startedAt })
    }

    @Test
    fun `a lifeline event is an activate or a deactivate`() {
        assertEquals("deactivate", LifelineEventJson(LifelineEventJson.DEACTIVATE, "l2", "a").kind)
        assertThrows<IllegalArgumentException> { LifelineEventJson("pause", "l3", "a") }
    }

    @Test
    fun `the known sources and the schema version`() {
        assertEquals(listOf("junit", "cucumber", "api"), ReportSource.ALL)
        assertEquals(Regex("""\d+\.\d+\.\d+""").matches(ReportSchema.VERSION), true)
    }
}
