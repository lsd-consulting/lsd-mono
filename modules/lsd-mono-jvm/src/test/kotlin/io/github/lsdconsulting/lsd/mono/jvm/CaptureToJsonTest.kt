package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.ACTOR
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.DATABASE
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.PARTICIPANT
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText

@LsdTestConfig(deterministicIds = true)
class CaptureToJsonTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `multi-message scenario serialises to report json and is injected into the shell`() {
        val lsd = LsdContext()
        lsd.addParticipants(
            ACTOR.called("Customer", colour = "#38bdf8"),
            PARTICIPANT.called("Checkout API", id = "api"),
            DATABASE.called("Orders DB"),
        )
        lsd.addFact("orderId", "ord-1")
        lsd.activate("api")
        lsd.capture {
            "Customer" calls "Checkout API" label "POST /checkout" data mapOf("cartId" to "cart-1")
            "api" calls "Orders DB" label "INSERT orders" took 12
        }
        lsd.response("Orders DB", "Checkout API", "ok")
        lsd.async("Checkout API", "Customer", "201 Created", mapOf("orderId" to "ord-1"))
        lsd.divider("done")
        lsd.capture { note("email queued", on = "Orders DB") }
        lsd.deactivate("api")
        lsd.completeScenario("checkout happy path", "<p>ok</p>", Status.SUCCESS)

        val files = lsd.completeReport("Orders flow")
        lsd.createIndex()

        val report = ReportJson.single(tempDir, ReportFileNames.stem("Orders flow") + "-report.json")
        assertEquals("Orders flow", report.root["title"])
        val scenario = report.scenario("checkout happy path")
        assertEquals(listOf("orderId" to "ord-1"), scenario.facts)
        assertEquals(
            listOf(
                mapOf("id" to "customer", "name" to "Customer", "type" to "ACTOR", "colour" to "#38bdf8"),
                mapOf("id" to "api", "name" to "Checkout API", "type" to "PARTICIPANT"),
                mapOf("id" to "orders-db", "name" to "Orders DB", "type" to "DATABASE"),
            ),
            scenario.participants.map { it.toMap() },
        )
        // Every event, in order, each with its own fields (#109: not a value found anywhere in the file).
        assertEquals(
            listOf("activate", "message", "message", "message", "message", "divider", "note", "deactivate"),
            scenario.events.map { it["kind"] },
        )
        assertEquals("api", scenario.eventsOf("activate").single()["participantId"])
        assertEquals("api", scenario.eventsOf("deactivate").single()["participantId"])

        fun line(label: String) = scenario.message(label).let { listOf(it["from"], it["to"], it["type"]) }
        assertEquals(listOf("customer", "api", "SYNCHRONOUS"), line("POST /checkout"))
        assertEquals(mapOf("cartId" to "cart-1"), scenario.message("POST /checkout").obj("data")?.toMap())
        assertEquals(listOf("api", "orders-db", "SYNCHRONOUS"), line("INSERT orders"))
        assertEquals(12.0, scenario.message("INSERT orders")["durationMs"])
        assertEquals(listOf("orders-db", "api", "SYNCHRONOUS_RESPONSE"), line("ok"))
        assertEquals(listOf("api", "customer", "ASYNCHRONOUS"), line("201 Created"))
        assertEquals(mapOf("orderId" to "ord-1"), scenario.message("201 Created").obj("data")?.toMap())
        assertEquals("done", scenario.eventsOf("divider").single()["label"])
        val note = scenario.eventsOf("note").single()
        assertEquals(listOf("email queued", "orders-db"), listOf(note["text"], note["over"]))
        assertEquals(listOf("Messages" to "4", "Captured duration" to "12 ms"), scenario.metrics, "only the explicit 12 ms counts")
        assertEquals("<p>ok</p>", scenario.description)
        // The raw text is the point here: the description is escaped so it cannot close the shell's script.
        val json = report.text
        assertTrue(json.contains("\\u003cp\\u003eok\\u003c/p\\u003e"))
        assertFalse(json.contains("</script>"))

        val diagram = tempDir.resolve(ReportFileNames.stem("Orders flow") + "-diagram.html").readText()
        val injectedAt = diagram.indexOf("window.__LSD_REPORT__=")
        val sampleAt = diagram.indexOf("Checkout Service")
        assertTrue(injectedAt >= 0, "shell missing injection")
        assertTrue(sampleAt > injectedAt, "sample fallback should follow the injected report")
        assertTrue(diagram.contains("POST /checkout"))
        assertTrue(diagram.contains("window.__LSD_PAYLOADS_SRC__=\"${ReportFileNames.stem("Orders flow")}-payloads.js\""))
        assertTrue(diagram.contains("window.__LSD_REPORT__??"), "shell should fall back to sample data when the global is absent")
        assertFalse(diagram.contains("cart-1"), "message bodies stay out of the first paint")
        val payloads = tempDir.resolve(ReportFileNames.stem("Orders flow") + "-payloads.js").readText()
        // Each payload is its JSON text, parsed when the shell opens it (#63).
        assertTrue(payloads.startsWith("window.__LSD_PAYLOAD_TEXT__="), payloads)
        assertTrue(payloads.contains("""\"cartId\":\"cart-1\""""), payloads)

        assertEquals(ReportFileNames.stem("Orders flow") + "-report.json", files.reportJson.fileName.toString())
        assertFalse(tempDir.resolve(ReportFileNames.stem("Orders flow") + "-report.html").toFile().exists(), "no listing page")
        // No shared "latest" copies that another report would overwrite (#25).
        assertFalse(tempDir.resolve("report.json").toFile().exists())
        assertFalse(tempDir.resolve("lsd-report.single.html").toFile().exists())
        assertTrue(tempDir.resolve("index.html").toFile().exists())
    }
}
