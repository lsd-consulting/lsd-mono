package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.time.Instant
import kotlin.concurrent.thread

class CaptureBlockTest {
    @BeforeEach
    fun deterministicIds() {
        System.setProperty(LsdProperties.DETERMINISTIC_IDS, "true")
    }

    @AfterEach
    fun clearIds() {
        System.clearProperty(LsdProperties.DETERMINISTIC_IDS)
    }

    private fun scenario() = LsdContext().beginScenario(bindCurrentThread = false)

    private fun LsdScenario.events(): List<SequenceEvent> = close().second

    private fun LsdScenario.labels(): List<String> = events().map { (it as Message).label }

    @Test
    fun `a block captures the same events as the verbs`() {
        val body = mapOf("sku" to "SOCK-1")
        val at = Instant.parse("2026-01-01T00:00:00Z")
        val viaBlock =
            scenario().apply {
                capture {
                    "Customer" calls "Orders" label "POST /orders" data body took 412 colour "#f00" at at
                    activate("Orders")
                    "Orders" sends "Events" label "order.paid"
                    note("idempotent", on = "Orders")
                    "Orders" repliesTo "Customer" label "201 Created"
                    deactivate("Orders")
                }
            }
        val viaVerbs =
            scenario().apply {
                message("Customer", "Orders", "POST /orders", body, durationMs = 412, colour = "#f00", at = at)
                activate("Orders")
                async("Orders", "Events", "order.paid")
                note("idempotent", on = "Orders")
                response("Orders", "Customer", "201 Created")
                deactivate("Orders")
            }

        assertEquals(viaVerbs.events().toString(), viaBlock.events().toString())
    }

    @Test
    fun `another thread's events never land inside a block`() {
        val scenario = scenario()
        scenario.capture {
            "A" calls "B" label "first"
            thread { scenario.message("X", "Y", "other thread") }.join()
            "B" repliesTo "A" label "second"
        }

        assertEquals(listOf("other thread", "first", "second"), scenario.labels())
    }

    @Test
    fun `the block keeps the scenario it started in`() {
        val lsd = LsdContext()
        val first = lsd.beginScenario()
        val second = lsd.beginScenario(bindCurrentThread = false)
        lsd.capture {
            second.bind().use {
                lsd.message("A", "B", "direct, on the rebound thread")
                "A" calls "B" label "in the block"
            }
        }

        assertEquals(listOf("in the block"), first.labels())
        assertEquals(listOf("direct, on the rebound thread"), second.labels())
    }

    @Test
    fun `a block that throws keeps what it captured and rethrows`() {
        val scenario = scenario()
        val error =
            assertThrows<IllegalStateException> {
                scenario.capture {
                    "A" calls "B" label "before"
                    error("boom")
                }
            }

        assertEquals("boom", error.message)
        assertEquals(listOf("before"), scenario.labels())
    }

    @Test
    fun `the receiver cannot be used after the block`() {
        lateinit var escaped: CaptureBlock
        scenario().capture { escaped = this }

        assertThrows<IllegalStateException> { escaped.activate("A") }
        assertThrows<IllegalStateException> { with(escaped) { "A" calls "B" } }
        assertThrows<IllegalStateException> { escaped.addFact("late") }
    }

    @Test
    fun `message data is copied when its line runs`() {
        val body = mutableMapOf("status" to "new")
        val scenario = scenario()
        scenario.capture {
            "A" calls "B" label "request" data body
            body["status"] = "changed"
            response("B", "A", "response", data = body)
            body["status"] = "after the block"
        }

        assertEquals(listOf("{status=new}", "{status=changed}"), scenario.events().map { (it as Message).data.toString() })
    }

    @Test
    fun `lsd {} captures into the shared context's current scenario`() {
        val scenario = LsdContext.instance.beginScenario(key = "capture-block-test-shorthand")
        try {
            lsd { "A" calls "B" label "shorthand" }
            assertEquals(listOf("shorthand"), scenario.labels())
        } finally {
            scenario.discard()
        }
    }
}
