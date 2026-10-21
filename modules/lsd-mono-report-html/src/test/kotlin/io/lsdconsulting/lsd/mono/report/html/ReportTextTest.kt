package io.lsdconsulting.lsd.mono.report.html

import io.lsdconsulting.lsd.mono.report.model.DelayEventJson
import io.lsdconsulting.lsd.mono.report.model.DividerEventJson
import io.lsdconsulting.lsd.mono.report.model.FactJson
import io.lsdconsulting.lsd.mono.report.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.lsdconsulting.lsd.mono.report.model.MetricJson
import io.lsdconsulting.lsd.mono.report.model.NoteEventJson
import io.lsdconsulting.lsd.mono.report.model.PairAccuracyJson
import io.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.lsdconsulting.lsd.mono.report.model.ReportJson
import io.lsdconsulting.lsd.mono.report.model.ReportSchema
import io.lsdconsulting.lsd.mono.report.model.ScenarioErrorJson
import io.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.lsdconsulting.lsd.mono.report.model.ScenarioTimingJson
import io.lsdconsulting.lsd.mono.report.model.SectionEventJson
import io.lsdconsulting.lsd.mono.report.model.SpacerEventJson
import io.lsdconsulting.lsd.mono.report.model.TraceJson
import io.lsdconsulting.lsd.mono.report.model.WarningJson
import io.lsdconsulting.lsd.mono.report.model.testing.assertValidJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The report as JSON text ([ReportWriter.toJson]) and the diagram page's copy of it ([forShell]). */
class ReportTextTest {
    private val call =
        MessageEventJson(
            id = "m1",
            from = "client",
            to = "api",
            label = "POST /orders",
            type = "SYNCHRONOUS",
            colour = "red",
            durationMs = 12.3456,
            data = mapOf("method" to "POST", "path" to "/orders", "body" to mapOf("sku" to "SOCK-1")),
            startedAt = "2026-10-21T08:00:00Z",
            seq = 1,
            callId = "c1",
            causedBy = "m0",
            trace = TraceJson("t1", "s1", "p1"),
            source = "api-service",
            capturedAt = "2026-10-21T08:00:00.001Z",
            status = "201",
            timing = "MEASURED",
            pairing = "CALL_ID",
            order = "CAPTURE",
            parentId = "m0",
        )
    private val reply =
        MessageEventJson(
            id = "m2",
            from = "api",
            to = "client",
            label = "201",
            type = "SYNCHRONOUS_RESPONSE",
            replyTo = "c1",
            replyOf = "m1",
            data = mapOf("status" to 201),
        )
    private val scenario =
        ScenarioJson(
            id = "s1",
            title = "Place an order",
            status = "error",
            description = "Given a basket",
            facts = listOf(FactJson("orderId", "o-1")),
            metrics = listOf(MetricJson("Messages", "2")),
            participants = listOf(ParticipantJson("client", "Client", "ACTOR", alias = "C", colour = "blue"), ParticipantJson("api", "Api")),
            events =
                listOf(
                    SectionEventJson("se1", "Checkout"),
                    LifelineEventJson(LifelineEventJson.ACTIVATE, "l1", "api", colour = "green"),
                    call,
                    reply,
                    NoteEventJson("n1", "a note", over = "api", placement = "right", startedAt = "2026-10-21T08:00:01Z"),
                    DelayEventJson("d1", "later"),
                    SpacerEventJson("sp1", 40),
                    DividerEventJson("dv1", "then"),
                    LifelineEventJson(LifelineEventJson.DEACTIVATE, "l2", "api"),
                ),
            error = ScenarioErrorJson("AssertionError", "expected 2", "at Test.kt:1"),
            timing =
                ScenarioTimingJson(
                    accuracy = "MEASURED",
                    measuredCoverage = 0.5,
                    pairingCoverage = 1.0,
                    sources = listOf("local", "api-service"),
                    wallClockMs = 20.0,
                    clockOrdering = "SAME_SOURCE",
                    clockOrdered = 1,
                    warnings = listOf(WarningJson("LONGER_THAN_PARENT", "too long")),
                    reorderedByClock = listOf("m2"),
                    pairAccuracy = listOf(PairAccuracyJson("client", "api", "MEASURED")),
                ),
        )
    private val report =
        ReportJson(title = "Orders", generatedAt = "2026-10-21T08:00:00Z", generator = "test 1.0", status = "error", scenarios = listOf(scenario))

    @Test
    fun `every field of every event kind is written, and absent ones are left out`() {
        val json = ReportWriter.toJson(report)
        assertValidJson(json)
        val compact = json.replace(Regex("\\s*\n\\s*"), "").replace("\": ", "\":")
        assertTrue(compact.startsWith("""{"schemaVersion":"${ReportSchema.VERSION}","title":"Orders""""), compact.take(80))
        listOf(
            """"options":{"metricsEnabled":true,"labelMaxWidth":200,"usagePing":true,"source":"api"}""",
            """"error":{"headline":"AssertionError","message":"expected 2","stack":"at Test.kt:1"}""",
            """{"id":"client","name":"Client","type":"ACTOR","alias":"C","colour":"blue"}""",
            """{"id":"api","name":"Api","type":"PARTICIPANT"}""",
            """{"kind":"section","id":"se1","title":"Checkout"}""",
            """{"kind":"activate","id":"l1","participantId":"api","colour":"green"}""",
            """"durationMs":12.346""",
            """"trace":{"traceId":"t1","spanId":"s1","parentSpanId":"p1"}""",
            """"source":"api-service","startedAt":"2026-10-21T08:00:00Z","capturedAt":"2026-10-21T08:00:00.001Z","status":"201","timing":"MEASURED","pairing":"CALL_ID","order":"CAPTURE","parentId":"m0"}""",
            """"replyTo":"c1"""",
            """"replyOf":"m1"""",
            """{"kind":"note","id":"n1","text":"a note","over":"api","placement":"right","startedAt":"2026-10-21T08:00:01Z"}""",
            """{"kind":"delay","id":"d1","label":"later"}""",
            """{"kind":"spacer","id":"sp1","heightPx":40}""",
            """{"kind":"divider","id":"dv1","label":"then"}""",
            """{"kind":"deactivate","id":"l2","participantId":"api"}""",
            """"accuracy":"MEASURED","measuredCoverage":0.5,"pairingCoverage":1,"sources":["local","api-service"],"wallClockMs":20,"clockOrdering":"SAME_SOURCE","clockOrdered":1""",
            """"warnings":[{"kind":"LONGER_THAN_PARENT","message":"too long"}]""",
            """"reorderedByClock":["m2"]""",
            """"pairAccuracy":[{"from":"client","to":"api","accuracy":"MEASURED"}]""",
        ).forEach { assertTrue(compact.contains(it), "$it in $compact") }
        assertFalse(compact.contains("payloadId"), "the report file keeps every payload")
    }

    @Test
    fun `a scenario without a timing summary leaves it out`() {
        val json = ReportWriter.toJson(report.copy(scenarios = listOf(scenario.copy(timing = null, error = null))))
        listOf("accuracy", "sources", "clockOrdering", "\"error\": {").forEach { assertFalse(json.contains(it), "$it in $json") }
    }

    @Test
    fun `the page's copy keeps method, path and status and moves the rest to the payload script`() {
        val shell = report.forShell()
        val events = shell.report.scenarios
            .single()
            .events
        val light = events.filterIsInstance<MessageEventJson>()
        assertEquals(mapOf("method" to "POST", "path" to "/orders"), light[0].data)
        assertEquals("s1/m1", light[0].payloadId)
        assertEquals(mapOf("status" to 201), light[1].data, "a summary alone stays on the message")
        assertNull(light[1].payloadId)
        assertEquals(setOf("s1/m1"), shell.payloads.keys)
        val script = shellPayloadScript(shell.payloads)
        assertTrue(script.startsWith("window.__LSD_PAYLOAD_TEXT__="), script)
        assertTrue(script.contains("\\\"sku\\\":\\\"SOCK-1\\\""), script)
    }

    @Test
    fun `data that is not a map moves to the payload script whole`() {
        val text = report.copy(scenarios = listOf(scenario.copy(events = listOf(call.copy(data = "plain text body")))))
        val shell = text.forShell()
        val message = shell.report.scenarios
            .single()
            .events
            .single() as MessageEventJson
        assertNull(message.data)
        assertEquals("plain text body", shell.payloads["s1/m1"])
    }
}
