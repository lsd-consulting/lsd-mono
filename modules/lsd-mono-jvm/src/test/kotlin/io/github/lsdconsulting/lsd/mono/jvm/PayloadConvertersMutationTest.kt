package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import tools.jackson.databind.json.JsonMapper
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.readText

/** Message data is copied when it is captured, so later changes by the test do not reach the report (#27). */
@LsdTestConfig
class PayloadConvertersMutationTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `mutating data after capture does not change the report`() {
        val lsd = LsdContext()
        val headers = mutableMapOf("x-request-id" to "req-1")
        val items = mutableListOf("socks")
        val body = mutableMapOf<String, Any?>("method" to "POST", "status" to 201, "headers" to headers, "items" to items)
        val text = StringBuilder("first")
        val bytes = "original".toByteArray()

        lsd.message("Client", "Api", "POST /orders", data = body)
        lsd.capture {
            "Api" calls "Db" label "INSERT" data text
            "Api" calls "Queue" label "publish" data bytes
        }

        body["status"] = 500
        headers["x-request-id"] = "req-2"
        items += "hats"
        text.setLength(0)
        text.append("second")
        "mutated!".toByteArray().copyInto(bytes)

        lsd.completeScenario("mutation")
        lsd.completeReport("Mutation")
        val json = tempDir.listDirectoryEntries("Mutation*-report.json").single().readText()

        // On the parsed data, not the text: "500" could be in a time such as ...:00.500Z.
        val messages = JsonMapper()
            .readTree(json)
            .get("scenarios")
            .get(0)
            .get("events")
            .filter { it.get("kind").asString() == "message" }
        val order = messages.single { it.get("label").asString() == "POST /orders" }.get("data")
        assertEquals(201, order.get("status").asInt(), "the status as captured, not the later 500")
        assertEquals("req-1", order.get("headers").get("x-request-id").asString())
        assertEquals(listOf("socks"), order.get("items").values().map { it.asString() })
        assertFalse(json.contains("req-2"), json)
        assertFalse(json.contains("hats"), json)
        assertEquals("first", messages.single { it.get("label").asString() == "INSERT" }.get("data").asString())
        assertFalse(json.contains("second"), json)
        assertEquals("original", messages.single { it.get("label").asString() == "publish" }.get("data").asString())
        assertFalse(json.contains("mutated"), json)
    }
}
