package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.messages
import io.lsdconsulting.lsd.mono.core.capture.withLabel
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType
import io.lsdconsulting.lsd.mono.core.model.MessageEventJson
import io.lsdconsulting.lsd.mono.core.model.ParticipantJson
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioJson
import io.lsdconsulting.lsd.mono.core.report.combineComponentGraphs
import io.lsdconsulting.lsd.mono.core.report.componentGraph
import io.lsdconsulting.lsd.mono.core.report.renderComponentSvg
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * Component graph edge rule (legacy filter, plus counts):
 * SYNCHRONOUS, ASYNCHRONOUS, BI_DIRECTIONAL, and LOST are included.
 * SYNCHRONOUS_RESPONSE is not an architecture edge. SHORT_INBOUND and
 * SHORT_OUTBOUND point at a phantom diagram edge, so they are excluded.
 * Same from→to collapses to one edge; [count] is the number of included messages.
 */
class ComponentGraphTest {

    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun deterministicOutput() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
        System.clearProperty("lsd.mono.components.enabled")
    }

    @AfterEach
    fun clearGates() {
        listOf(
            "lsd.mono.report.outputDir",
            "lsd.mono.ids.deterministic",
            "lsd.mono.components.enabled",
        ).forEach { System.clearProperty(it) }
    }

    @Test
    fun `duplicate messages collapse to one edge with a count`() {
        val participants =
            listOf(
                Participant("Alpha", "a"),
                Participant("Beta", "b", type = ParticipantType.ACTOR),
            )
        val events =
            listOf(
                Message("1", "a", "b", "one", MessageType.SYNCHRONOUS),
                Message("2", "a", "b", "two", MessageType.SYNCHRONOUS),
                Message("3", "a", "b", "three", MessageType.SYNCHRONOUS),
            )
        val graph = componentGraph(events, participants)
        assertEquals(listOf("a", "b"), graph.nodes.map { it.id })
        assertEquals(listOf("Alpha", "Beta"), graph.nodes.map { it.name })
        assertEquals("ACTOR", graph.nodes[1].type)
        assertEquals(1, graph.edges.size)
        assertEquals("a", graph.edges[0].from)
        assertEquals("b", graph.edges[0].to)
        assertEquals(listOf("SYNCHRONOUS"), graph.edges[0].types)
        assertEquals(3, graph.edges[0].count)
    }

    @Test
    fun `report json keeps lost edges and drops responses and short arrows`() {
        val report =
            ReportJson(
                title = "t",
                generatedAt = "x",
                generator = "g",
                status = "success",
                scenarios =
                    listOf(
                        ScenarioJson(
                            id = "s",
                            title = "only",
                            status = "success",
                            description = "",
                            facts = emptyList(),
                            participants = listOf(ParticipantJson("a", "A"), ParticipantJson("b", "B")),
                            events =
                                listOf(
                                    MessageEventJson("1", "a", "b", "call", "SYNCHRONOUS"),
                                    MessageEventJson("2", "a", "b", "again", "SYNCHRONOUS"),
                                    MessageEventJson("3", "b", "a", "ok", "SYNCHRONOUS_RESPONSE"),
                                    MessageEventJson("4", "a", "b", "gone", "LOST"),
                                    MessageEventJson("5", "", "a", "in", "SHORT_INBOUND"),
                                    MessageEventJson("6", "a", "", "out", "SHORT_OUTBOUND"),
                                ),
                        ),
                    ),
            )
        val graph = componentGraph(report)
        assertEquals(listOf("a", "b"), graph.nodes.map { it.id })
        assertEquals(1, graph.edges.size)
        assertEquals(3, graph.edges[0].count)
        assertEquals(listOf("SYNCHRONOUS", "LOST"), graph.edges[0].types)
        assertEquals("a" to "b", graph.edges[0].from to graph.edges[0].to)
    }

    @Test
    fun `a response only scenario has no edges`() {
        val graph =
            componentGraph(
                listOf(Message("1", "b", "a", "ok", MessageType.SYNCHRONOUS_RESPONSE)),
            )
        assertTrue(graph.nodes.isEmpty())
        assertTrue(graph.edges.isEmpty())
    }

    @Test
    fun `combined graph unions scenarios and sums counts`() {
        val participants = listOf(Participant("A", "a"), Participant("B", "b"), Participant("C", "c"))
        val first =
            componentGraph(
                listOf(
                    Message("1", "a", "b", "one", MessageType.SYNCHRONOUS),
                    Message("2", "a", "b", "two", MessageType.SYNCHRONOUS),
                ),
                participants,
            )
        val second =
            componentGraph(
                listOf(
                    Message("3", "a", "b", "gone", MessageType.LOST),
                    Message("4", "b", "c", "later", MessageType.ASYNCHRONOUS),
                ),
                participants,
            )
        val combined = combineComponentGraphs(listOf(first, second))
        assertEquals(listOf("a", "b", "c"), combined.nodes.map { it.id })
        assertEquals(2, combined.edges.size)
        assertEquals(3, combined.edges[0].count)
        assertEquals(listOf("SYNCHRONOUS", "LOST"), combined.edges[0].types)
        assertEquals("b" to "c", combined.edges[1].from to combined.edges[1].to)
        assertEquals(listOf("ASYNCHRONOUS"), combined.edges[1].types)
        assertEquals(1, combined.edges[1].count)
    }

    @Test
    fun `edge type is a text label and a marker not colour alone`() {
        val lost = componentGraph(listOf(Message("1", "a", "b", "gone", MessageType.LOST)))
        val lostSvg = renderComponentSvg(lost, "lost")
        assertTrue(lostSvg.contains("lost x1"), lostSvg)
        assertTrue(lostSvg.contains("mk-lost"), lostSvg)
        assertTrue(lostSvg.contains("M2 2 L10 10"), lostSvg)

        val bi = componentGraph(listOf(Message("1", "a", "b", "both", MessageType.BI_DIRECTIONAL)))
        val biSvg = renderComponentSvg(bi, "bi")
        assertTrue(biSvg.contains("bi x1"), biSvg)
        assertTrue(biSvg.contains("marker-start=\"url(#mk-bi)\""), biSvg)
        assertTrue(biSvg.contains("marker-end=\"url(#mk-bi)\""), biSvg)
    }

    @Test
    fun `report json omits the graph unless components are enabled`() {
        val lsd = LsdContext()
        lsd.message("A", "B", "hi")
        lsd.completeScenario("quiet")
        lsd.completeReport("Off")
        val report = tempDir.resolve("Off-report.json").readText()
        assertFalse(report.contains(""""components""""), report)
        assertTrue(report.contains(""""label": "hi""""), report)
    }

    @Test
    fun `enabled property writes per-scenario and combined graphs`() {
        System.setProperty("lsd.mono.components.enabled", "true")
        val lsd = LsdContext()
        lsd.capture("A" messages "B" withLabel "one")
        lsd.capture("A" messages "B" withLabel "two")
        lsd.message("A", "B", "dropped", MessageType.LOST)
        lsd.response("B", "A", "ack")
        lsd.completeScenario("first")
        lsd.message("B", "C", "later", MessageType.ASYNCHRONOUS)
        lsd.completeScenario("second")
        lsd.completeReport("Graph")

        val report = tempDir.resolve("Graph-report.json").readText()
        assertTrue(report.contains(""""components""""), report)
        assertTrue(report.contains(""""count": 3"""), report)
        assertTrue(report.contains("SYNCHRONOUS_RESPONSE"), "sequence events still record the response")

        lsd.completeComponentsReport("Combined Component Diagram")
        val doc = tempDir.resolve("components.json").readText()
        assertTrue(doc.contains(""""title": "Combined Component Diagram""""), doc)
        assertTrue(doc.contains(""""title": "first""""), doc)
        assertTrue(doc.contains(""""title": "second""""), doc)
        assertTrue(doc.contains(""""count": 3"""), doc)
        assertTrue(doc.contains(""""count": 1"""), doc)
        assertTrue(doc.contains("ASYNCHRONOUS"), doc)
        assertFalse(doc.contains("SYNCHRONOUS_RESPONSE"), doc)

        val html = tempDir.resolve("components-report.html").readText()
        assertTrue(html.contains("<svg"), html)
        assertTrue(html.contains("sync, lost x3"), html)
        assertTrue(html.contains("async x1"), html)
        assertTrue(html.contains("mk-mixed"), html)
        assertFalse(html.contains("deferred"), html)
    }
}
