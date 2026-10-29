package io.github.lsdconsulting.lsd.mono.report.html

import io.github.lsdconsulting.lsd.mono.report.model.AccuracyJson
import io.github.lsdconsulting.lsd.mono.report.model.AttributeValueJson
import io.github.lsdconsulting.lsd.mono.report.model.ClockOrderingJson
import io.github.lsdconsulting.lsd.mono.report.model.DataValueJson
import io.github.lsdconsulting.lsd.mono.report.model.DelayEventJson
import io.github.lsdconsulting.lsd.mono.report.model.DividerEventJson
import io.github.lsdconsulting.lsd.mono.report.model.GeneratorJson
import io.github.lsdconsulting.lsd.mono.report.model.KnownMessageOrigin
import io.github.lsdconsulting.lsd.mono.report.model.KnownWarningKind
import io.github.lsdconsulting.lsd.mono.report.model.LifelineEventJson
import io.github.lsdconsulting.lsd.mono.report.model.LifelineKindJson
import io.github.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.github.lsdconsulting.lsd.mono.report.model.NoteEventJson
import io.github.lsdconsulting.lsd.mono.report.model.NotePlacementJson
import io.github.lsdconsulting.lsd.mono.report.model.PairAccuracyJson
import io.github.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportSchema
import io.github.lsdconsulting.lsd.mono.report.model.ScenarioErrorJson
import io.github.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.github.lsdconsulting.lsd.mono.report.model.SectionEventJson
import io.github.lsdconsulting.lsd.mono.report.model.SpacerEventJson
import io.github.lsdconsulting.lsd.mono.report.model.StatusJson
import io.github.lsdconsulting.lsd.mono.report.model.TraceJson
import io.github.lsdconsulting.lsd.mono.report.model.WarningJson
import io.github.lsdconsulting.lsd.mono.report.model.testing.Json
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import io.github.lsdconsulting.lsd.mono.report.model.testing.assertValidJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The report as JSON text ([ReportWriter.toJson]) and the diagram page's copy of it ([forShell]). */
class ReportTextTest {
    private val call =
        MessageEventJson
            .builder(id = "m1", from = "client", to = "api", label = "POST /orders", type = "synchronous")
            .color("red")
            .durationMs(12.3456)
            .data(DataValueJson.from(mapOf("method" to "POST", "path" to "/orders", "body" to mapOf("sku" to "SOCK-1"))))
            .startedAt("2026-10-21T08:00:00Z")
            .seq(1)
            .callId("c1")
            .causedBy("m0")
            .trace(TraceJson("t1", "s1", "p1"))
            .source("api-service")
            .capturedAt("2026-10-21T08:00:00.001Z")
            .status("201")
            .timing("measured")
            .pairing("call_id")
            .order("capture")
            .parentId("m0")
            .build()
    private val reply =
        MessageEventJson
            .builder(id = "m2", from = "api", to = "client", label = "201", type = "synchronous_response")
            .callId("c1")
            .replyTo("m1")
            .data(DataValueJson.from(mapOf("status" to 201)))
            .build()
    private val scenario =
        ScenarioJson
            .builder(id = "s1", title = "Place an order", status = StatusJson.ERROR)
            .description("Given a basket")
            .fact("orderId", "o-1")
            .metric("Messages", "2")
            .participant(
                ParticipantJson
                    .builder("client", "Client")
                    .type("actor")
                    .displayName("C")
                    .color("blue")
                    .build(),
            ).participant(ParticipantJson.builder("api", "Api").build())
            .events(
                listOf(
                    SectionEventJson.builder("se1", "Checkout").build(),
                    LifelineEventJson.builder(LifelineKindJson.ACTIVATE, "l1", "api").color("green").build(),
                    call,
                    reply,
                    NoteEventJson
                        .builder("n1", "a note")
                        .over("api")
                        .placement(NotePlacementJson.RIGHT)
                        .startedAt("2026-10-21T08:00:01Z")
                        .build(),
                    DelayEventJson.builder("d1").label("later").build(),
                    SpacerEventJson.builder("sp1").heightPx(40).build(),
                    DividerEventJson.builder("dv1", "then").build(),
                    LifelineEventJson.builder(LifelineKindJson.DEACTIVATE, "l2", "api").build(),
                ),
            ).error(ScenarioErrorJson.builder("AssertionError", "expected 2").stack("at Test.kt:1").build())
            .accuracy(AccuracyJson.MEASURED)
            .measuredRatio(0.5)
            .pairedRatio(1.0)
            .sources(listOf("local", "api-service"))
            .wallClockMs(20.0)
            .clockOrdering(ClockOrderingJson.SAME_SOURCE)
            .clockOrderedCount(1)
            .warning(WarningJson(KnownWarningKind.LONGER_THAN_PARENT, "too long"))
            .reorderedByClock(listOf("m2"))
            .pairAccuracy(listOf(PairAccuracyJson("client", "api", AccuracyJson.MEASURED)))
            .build()
    private val report =
        ReportJson
            .builder(title = "Orders", generatedAt = "2026-10-21T08:00:00Z", generator = GeneratorJson("test", "1.0"), status = StatusJson.ERROR)
            .scenario(scenario)
            .build()

    @Test
    fun `every field of every event kind is written, and absent ones are left out`() {
        val json = ReportWriter.toJson(report)
        assertValidJson(json)
        val compact = json.replace(Regex("\\s*\n\\s*"), "").replace("\": ", "\":")
        assertTrue(compact.startsWith("""{"schemaVersion":"${ReportSchema.VERSION}","title":"Orders""""), compact.take(80))
        listOf(
            """"options":{"metricsEnabled":true,"labelMaxChars":200,"usagePing":true,"source":"api"}""",
            """"error":{"headline":"AssertionError","message":"expected 2","stack":"at Test.kt:1"}""",
            """{"id":"client","name":"Client","type":"actor","displayName":"C","color":"blue"}""",
            """{"id":"api","name":"Api","type":"participant"}""",
            """{"kind":"section","id":"se1","title":"Checkout"}""",
            """{"kind":"activate","id":"l1","participantId":"api","color":"green"}""",
            """"durationMs":12.346""",
            """"trace":{"traceId":"t1","spanId":"s1","parentSpanId":"p1"}""",
            """"source":"api-service","startedAt":"2026-10-21T08:00:00Z","capturedAt":"2026-10-21T08:00:00.001Z","status":"201","timing":"measured","pairing":"call_id","order":"capture","parentId":"m0"}""",
            """"callId":"c1","replyTo":"m1"""",
            """{"kind":"note","id":"n1","text":"a note","over":"api","placement":"right","startedAt":"2026-10-21T08:00:01Z"}""",
            """{"kind":"delay","id":"d1","label":"later"}""",
            """{"kind":"spacer","id":"sp1","heightPx":40}""",
            """{"kind":"divider","id":"dv1","label":"then"}""",
            """{"kind":"deactivate","id":"l2","participantId":"api"}""",
            """"accuracy":"measured","measuredRatio":0.5,"pairedRatio":1,"sources":["local","api-service"],"wallClockMs":20,"clockOrdering":"same_source","clockOrderedCount":1""",
            """"warnings":[{"kind":"longer_than_parent","message":"too long"}]""",
            """"reorderedByClock":["m2"]""",
            """"pairAccuracy":[{"from":"client","to":"api","accuracy":"measured"}]""",
        ).forEach { assertTrue(compact.contains(it), "$it in $compact") }
        assertFalse(compact.contains("payloadId"), "the report file keeps every payload")
    }

    @Test
    fun `a message's attributes and origin are written as the schema has them`() {
        val imported =
            call
                .toBuilder()
                .trace(TraceJson("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", "53995c3f42cd8ad8"))
                .attributes(
                    mapOf(
                        "http.request.method" to AttributeValueJson.of("POST"),
                        "http.response.status_code" to AttributeValueJson.of(201),
                        "lsd.retry" to AttributeValueJson.of(false),
                        "lsd.cost" to AttributeValueJson.of(0.25),
                        "lsd.big" to AttributeValueJson.of(1.0e10),
                        "lsd.tags" to AttributeValueJson.ofStrings(listOf("a", "b")),
                        "lsd.flags" to AttributeValueJson.ofBooleans(listOf(true)),
                        "lsd.sizes" to AttributeValueJson.ofLongs(listOf(1, 2)),
                        "lsd.ratios" to AttributeValueJson.ofDoubles(listOf(0.5)),
                    ),
                ).origin(KnownMessageOrigin.IMPORTED)
                .build()
        val json = ReportWriter.toJson(withScenario(scenario.toBuilder().events(listOf(imported, reply)).build()))
        ReportSchemas.assertValid(ReportSchemas.Document.REPORT, json, "a report with attributes and an origin")
        val compact = json.replace(Regex("\\s*\n\\s*"), "").replace("\": ", "\":")
        listOf(
            """"trace":{"traceId":"4bf92f3577b34da6a3ce929d0e0e4736","spanId":"00f067aa0ba902b7","parentSpanId":"53995c3f42cd8ad8"}""",
            """"parentId":"m0","attributes":{"http.request.method":"POST","http.response.status_code":201,"lsd.retry":false,"lsd.cost":0.25,"lsd.big":10000000000,"lsd.tags":["a","b"],"lsd.flags":[true],"lsd.sizes":[1,2],"lsd.ratios":[0.5]},"origin":"imported"}""",
            // A captured message with no attributes has neither field.
            """{"kind":"message","id":"m2","from":"api","to":"client","label":"201","type":"synchronous_response","data":{"status":201},"callId":"c1","replyTo":"m1"}""",
        ).forEach { assertTrue(compact.contains(it), "$it in $compact") }
    }

    @Test
    fun `a scenario without a timing summary leaves it out`() {
        val json = ReportWriter.toJson(
            withScenario(
                scenario
                    .toBuilder()
                    .accuracy(null)
                    .measuredRatio(null)
                    .pairedRatio(null)
                    .sources(null)
                    .wallClockMs(null)
                    .clockOrdering(null)
                    .clockOrderedCount(null)
                    .warnings(emptyList())
                    .reorderedByClock(emptyList())
                    .pairAccuracy(emptyList())
                    .error(null)
                    .build(),
            ),
        )
        listOf("accuracy", "sources", "clockOrdering", "\"error\": {").forEach { assertFalse(json.contains(it), "$it in $json") }
    }

    @Test
    fun `the page's copy keeps method, path and status and moves the rest to the payload script`() {
        val shell = report.forShell()
        val events = shell.report.scenarios
            .single()
            .events
        val light = events.filterIsInstance<MessageEventJson>()
        assertEquals(DataValueJson.from(mapOf("method" to "POST", "path" to "/orders")), light[0].data)
        assertEquals(DataValueJson.from(mapOf("status" to 201)), light[1].data, "a summary alone stays on the message")
        assertEquals(setOf("s1/m1"), shell.payloads.keys)

        fun payloadIds(json: String) =
            (Json.parse(json) as JsonObject).objects("scenarios").flatMap { it.objects("events") }.mapNotNull { it.string("payloadId") }
        assertEquals(listOf("s1/m1"), payloadIds(shell.toJson()), "the page's copy keys the call's payload")
        assertEquals(emptyList<String>(), payloadIds(report.toJson()), "payloadId is page-only, never in the report file")
        val script = shellPayloadScript(shell.payloads)
        assertTrue(script.startsWith("window.__LSD_PAYLOAD_TEXT__="), script)
        assertTrue(script.contains("\\\"sku\\\":\\\"SOCK-1\\\""), script)
    }

    @Test
    fun `data that is not a map moves to the payload script whole`() {
        val text = withScenario(scenario.toBuilder().events(listOf(call.toBuilder().data(DataValueJson.of("plain text body")).build())).build())
        val shell = text.forShell()
        val message = shell.report.scenarios
            .single()
            .events
            .single() as MessageEventJson
        assertNull(message.data)
        assertEquals(DataValueJson.of("plain text body"), shell.payloads["s1/m1"])
    }

    private fun withScenario(changed: ScenarioJson): ReportJson = report.toBuilder().scenarios(listOf(changed)).build()
}
