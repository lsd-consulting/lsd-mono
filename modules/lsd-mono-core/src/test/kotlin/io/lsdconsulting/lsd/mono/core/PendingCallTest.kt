package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType.SYNCHRONOUS
import io.lsdconsulting.lsd.mono.core.domain.MessageType.SYNCHRONOUS_RESPONSE
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.IOException
import java.nio.file.Path
import java.time.Instant
import java.util.concurrent.CompletableFuture
import kotlin.concurrent.thread
import kotlin.io.path.readText

class PendingCallTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun output() {
        System.setProperty(LsdProperties.OUTPUT_DIR, tempDir.toString())
        System.setProperty(LsdProperties.DETERMINISTIC_IDS, "true")
    }

    @AfterEach
    fun clearProperties() {
        System.clearProperty(LsdProperties.OUTPUT_DIR)
        System.clearProperty(LsdProperties.DETERMINISTIC_IDS)
    }

    private fun LsdScenario.messages(): List<Message> = close().second.map { it as Message }

    // Participants are stored by id, a slug of the name.
    private fun Message.summary() = "$type $from>$to $label"

    @Test
    fun `a reply is drawn back from the callee with the time since the call`() {
        val scenario = LsdContext().beginScenario(bindCurrentThread = false)
        val call = scenario.call("Client", "Orders", "POST /orders", mapOf("sku" to "SOCK-1"))
        Thread.sleep(30)
        call.reply("201 Created", mapOf("id" to "ord-1"))

        val (request, response) = scenario.messages()
        assertEquals("SYNCHRONOUS client>orders POST /orders", request.summary())
        assertEquals("{sku=SOCK-1}", request.data.toString())
        assertEquals("SYNCHRONOUS_RESPONSE orders>client 201 Created", response.summary())
        assertEquals("{id=ord-1}", response.data.toString())
        assertTrue(response.durationMs!! >= 30, "measured ${response.durationMs} ms")
        assertEquals(null, request.durationMs)
    }

    @Test
    fun `with both timestamps the duration is the time between them`() {
        val sent = Instant.parse("2026-01-01T00:00:00Z")
        val scenario = LsdContext().beginScenario(bindCurrentThread = false)
        scenario.call("Client", "Orders", "GET /orders/1", at = sent).reply("200", at = sent.plusMillis(150))

        assertEquals(150L, scenario.messages().last().durationMs)
    }

    @Test
    fun `a reply from another thread lands in the scenario the call was made in`() {
        val lsd = LsdContext()
        val first = lsd.beginScenario()
        val call = lsd.call("Test", "Orders", "GET /orders")
        val second = lsd.beginScenario(bindCurrentThread = false)
        // Two scenarios are running and the replying thread is bound to neither.
        thread { call.reply("200 OK") }.join()
        second.message("Other", "Orders", "unrelated")

        assertEquals(listOf("SYNCHRONOUS", "SYNCHRONOUS_RESPONSE"), first.messages().map { it.type.name })
        assertEquals(listOf("unrelated"), second.messages().map { it.label })
    }

    @Test
    fun `an async client's callback can reply`() {
        val scenario = LsdContext().beginScenario(bindCurrentThread = false)
        val call = scenario.call("Test", "Orders", "GET /orders")
        CompletableFuture.supplyAsync { "200 OK" }.thenAccept { call.reply(it) }.join()

        assertEquals(listOf(SYNCHRONOUS, SYNCHRONOUS_RESPONSE), scenario.messages().map { it.type })
    }

    @Test
    fun `fail captures an error reply named after the exception`() {
        val scenario = LsdContext().beginScenario(bindCurrentThread = false)
        scenario.call("Test", "Orders", "GET /orders").fail(IOException("connection reset"))

        val response = scenario.messages().last()
        assertEquals("SYNCHRONOUS_RESPONSE orders>test IOException", response.summary())
        assertEquals("{exception=java.io.IOException, message=connection reset}", response.data.toString())
    }

    @Test
    fun `only the first reply counts`() {
        val scenario = LsdContext().beginScenario(bindCurrentThread = false)
        val call = scenario.call("Test", "Orders", "GET /orders")
        call.reply("200 OK")
        call.reply("200 again")
        call.fail(IllegalStateException("too late"))

        assertEquals(listOf("GET /orders", "200 OK"), scenario.messages().map { it.label })
    }

    @Test
    fun `a call still waiting at completion is given up, and its late reply is dropped`() {
        val lsd = LsdContext()
        val call = lsd.call("Test", "Orders", "GET /orders")
        lsd.completeScenario("first")
        call.reply("late")
        lsd.message("Test", "Orders", "next")
        lsd.completeScenario("second")
        lsd.completeReport("Calls")

        val json = tempDir.resolve(ReportWriter.reportFileStem("Calls") + "-report.json").readText()
        assertTrue(json.contains("\"label\": \"GET /orders\""), json)
        assertTrue(json.contains("\"label\": \"next\""), json)
        assertFalse(json.contains("\"label\": \"late\""), json)
    }

    @Test
    fun `in a capture block the reply keeps its place`() {
        val scenario = LsdContext().beginScenario(bindCurrentThread = false)
        lateinit var afterwards: PendingCall
        scenario.capture {
            val call = call("Web", "Orders", "POST /orders")
            "Orders" calls "Db" label "insert"
            call.reply("201")
            afterwards = call("Web", "Search", "reindex")
            note("still in the block", on = "Web")
        }
        scenario.message("Web", "Audit", "after the block")
        afterwards.reply("202")

        assertEquals(
            listOf("POST /orders", "insert", "201", "reindex", "after the block", "202"),
            scenario
                .close()
                .second
                .filterIsInstance<Message>()
                .map { it.label },
        )
    }
}
