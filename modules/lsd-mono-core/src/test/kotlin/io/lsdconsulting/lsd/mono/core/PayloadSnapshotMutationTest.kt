package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.messages
import io.lsdconsulting.lsd.mono.core.capture.withData
import io.lsdconsulting.lsd.mono.core.capture.withLabel
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.readText

/** Message data is copied when it is captured, so later changes by the test do not reach the report (#27). */
class PayloadSnapshotMutationTest {

    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
    }

    @AfterEach
    fun restore() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-mono")
    }

    @Test
    fun `mutating data after capture does not change the report`() {
        val lsd = LsdContext()
        val headers = mutableMapOf("x-request-id" to "req-1")
        val items = mutableListOf("socks")
        val body = mutableMapOf<String, Any?>("method" to "POST", "status" to 201, "headers" to headers, "items" to items)
        val text = StringBuilder("first")
        val bytes = "original".toByteArray()

        lsd.message("Client", "Api", "POST /orders", data = body)
        lsd.capture("Api" messages "Db" withLabel "INSERT" withData text)
        lsd.capture("Api" messages "Queue" withLabel "publish" withData bytes)

        body["status"] = 500
        headers["x-request-id"] = "req-2"
        items += "hats"
        text.setLength(0)
        text.append("second")
        "mutated!".toByteArray().copyInto(bytes)

        lsd.completeScenario("mutation")
        lsd.completeReport("Mutation")
        val json = tempDir.listDirectoryEntries("Mutation*-report.json").single().readText()

        assertTrue(json.contains(""""status": 201"""), json)
        assertFalse(json.contains("500"), json)
        assertTrue(json.contains(""""x-request-id": "req-1""""), json)
        assertFalse(json.contains("req-2"), json)
        assertFalse(json.contains("hats"), json)
        assertTrue(json.contains(""""data": "first""""), json)
        assertFalse(json.contains("second"), json)
        assertTrue(json.contains(""""data": "original""""), json)
        assertFalse(json.contains("mutated"), json)
    }
}
