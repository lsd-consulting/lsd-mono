package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.messages
import io.lsdconsulting.lsd.mono.core.capture.noteOver
import io.lsdconsulting.lsd.mono.core.capture.withData
import io.lsdconsulting.lsd.mono.core.capture.withDurationMs
import io.lsdconsulting.lsd.mono.core.capture.withLabel
import io.lsdconsulting.lsd.mono.core.capture.withType
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.capture.lifeline
import io.lsdconsulting.lsd.mono.core.domain.Status
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText

class CaptureToJsonTest {

    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun deterministicOutput() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
    }

    @Test
    fun `multi-message scenario serialises to report-next json and is injected into the shell`() {
        val lsd = LsdContext()
        lsd.addParticipants(
            ACTOR.called("Customer", colour = "#38bdf8"),
            PARTICIPANT.called("Checkout API", id = "api"),
            DATABASE.called("Orders DB"),
        )
        lsd.addFact("orderId", "ord-1")
        lsd.capture(LifelineAction.ACTIVATE lifeline "api")
        lsd.capture(
            "Customer" messages "Checkout API" withLabel "POST /checkout" withData mapOf("cartId" to "cart-1"),
        )
        lsd.capture(
            "api" messages "Orders DB" withLabel "INSERT orders" withType MessageType.SYNCHRONOUS withDurationMs(12),
        )
        lsd.response("Orders DB", "Checkout API", "ok")
        lsd.message("Checkout API", "Customer", "201 Created", MessageType.ASYNCHRONOUS, mapOf("orderId" to "ord-1"))
        lsd.divider("done")
        lsd.capture(noteOver("Orders DB", "email queued"))
        lsd.deactivate("api")
        lsd.completeScenario("checkout happy path", "<p>ok</p>", Status.SUCCESS)

        val html = lsd.completeReport("Orders flow")
        lsd.createIndex()

        val json = tempDir.resolve("Orders-flow-report.json").readText()
        assertTrue(json.contains("\"title\": \"Orders flow\""))
        assertTrue(json.contains("\"key\": \"orderId\""))
        assertTrue(json.contains("\"value\": \"ord-1\""))
        assertTrue(json.contains("\"id\": \"customer\""))
        assertTrue(json.contains("\"type\": \"ACTOR\""))
        assertTrue(json.contains("\"colour\": \"#38bdf8\""))
        assertTrue(json.contains("\"id\": \"api\""))
        assertTrue(json.contains("\"name\": \"Checkout API\""))
        assertTrue(json.contains("\"id\": \"orders-db\""))
        assertTrue(json.contains("\"kind\": \"activate\""))
        assertTrue(json.contains("\"participantId\": \"api\""))
        assertTrue(json.contains("\"kind\": \"message\""))
        assertTrue(json.contains("\"label\": \"POST /checkout\""))
        assertTrue(json.contains("\"from\": \"customer\""))
        assertTrue(json.contains("\"to\": \"api\""))
        assertTrue(json.contains("\"type\": \"SYNCHRONOUS\""))
        assertTrue(json.contains("\"cartId\": \"cart-1\""))
        assertTrue(json.contains("\"label\": \"INSERT orders\""))
        assertTrue(json.contains("\"from\": \"api\""))
        assertTrue(json.contains("\"to\": \"orders-db\""))
        assertTrue(json.contains("\"durationMs\": 12"))
        assertTrue(json.contains("\"type\": \"SYNCHRONOUS_RESPONSE\""))
        assertTrue(json.contains("\"label\": \"ok\""))
        assertTrue(json.contains("\"type\": \"ASYNCHRONOUS\""))
        assertTrue(json.contains("\"label\": \"201 Created\""))
        assertTrue(json.contains("\"kind\": \"divider\""))
        assertTrue(json.contains("\"label\": \"done\""))
        assertTrue(json.contains("\"kind\": \"note\""))
        assertTrue(json.contains("\"text\": \"email queued\""))
        assertTrue(json.contains("\"over\": \"orders-db\""))
        assertTrue(json.contains("\"kind\": \"deactivate\""))
        assertTrue(json.contains("\"key\": \"Messages\""))
        assertTrue(json.contains("\"value\": \"4\""))
        assertTrue(json.contains("\"key\": \"Captured duration\""))
        assertTrue(json.contains("\\u003cp\\u003eok\\u003c/p\\u003e"))
        assertFalse(json.contains("</script>"))

        val diagram = tempDir.resolve("Orders-flow-diagram.html").readText()
        val injectedAt = diagram.indexOf("window.__LSD_REPORT__=")
        val sampleAt = diagram.indexOf("Checkout Service")
        assertTrue(injectedAt >= 0, "shell missing injection")
        assertTrue(sampleAt > injectedAt, "sample fallback should follow the injected report")
        assertTrue(diagram.contains("POST /checkout"))
        assertTrue(diagram.contains("const re=window.__LSD_REPORT__??"))

        val shared = tempDir.resolve("lsd-report-next.single.html").readText()
        assertTrue(shared.contains("Orders flow"))
        assertTrue(html.toFile().readText().contains("POST /checkout"))
        assertTrue(tempDir.resolve("report.json").readText().contains("\"kind\": \"message\""))
        assertTrue(tempDir.resolve("index.html").toFile().exists())
    }
}
