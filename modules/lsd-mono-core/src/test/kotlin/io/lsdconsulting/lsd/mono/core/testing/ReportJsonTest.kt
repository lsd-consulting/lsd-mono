package io.lsdconsulting.lsd.mono.core.testing

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.Timing
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/** [ReportJson] reads what the writer writes and finds scenarios by title, not by text position (#74). */
@LsdTestConfig(deterministicIds = true)
class ReportJsonTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `finds each scenario by title with its own messages and facts`() {
        val lsd = LsdContext()
        lsd.addFact("owner", "first")
        lsd.message("A", "B", "first call")
        lsd.completeScenario("first")
        lsd.addFact("owner", "second <b>")
        lsd.message("A", "B", "second \"call\"")
        lsd.completeScenario("second")
        val report = ReportJson.read(lsd.completeReport("Read back").reportJson)

        assertEquals(listOf("first", "second"), report.titles)
        val second = report.scenario("second")
        assertEquals(listOf("second \"call\""), second.labels)
        assertEquals(listOf("owner" to "second <b>"), second.facts)
        assertEquals("success", second.status)
        assertNull(second.error)
        assertTrue(second.json.startsWith("{") && second.json.endsWith("}"))
        assertFalse(second.json.contains("first call"), "the scenario's text is only its own")
        assertEquals(report.root.objects("scenarios")[1].source, second.json)
    }

    @Test
    fun `a missing or repeated title fails, naming the titles there are`() {
        val lsd = LsdContext()
        lsd.completeScenario("twice")
        lsd.completeScenario("twice")
        val report = ReportJson.read(lsd.completeReport("Twice").reportJson)
        assertTrue(assertThrows(IllegalStateException::class.java) { report.scenario("twice") }.message!!.contains("found 2"))
        assertTrue(assertThrows(IllegalStateException::class.java) { report.scenario("never") }.message!!.contains("[twice, twice]"))
        assertThrows(IllegalStateException::class.java) { ReportJson.single(tempDir, "nothing-*.json") }
    }

    @Test
    fun `finds a scenario's participants, messages, events and metrics by name (#109)`() {
        val lsd = LsdContext()
        lsd.message("Web", "Api", "GET /a", timing = Timing.tookMs(5.0))
        lsd.response("Api", "Web", "200")
        lsd.divider("then")
        lsd.message("Web", "Api", "GET /a again")
        lsd.completeScenario("parts")
        val report = ReportJson.read(lsd.completeReport("Parts").reportJson)
        val parts = report.scenario("parts")

        assertEquals(listOf("web", "api"), parts.participants.map { it["id"] })
        assertEquals("Api", parts.participant("api")["name"])
        assertEquals(listOf("GET /a", "200", "GET /a again"), parts.messages.map { it["label"] })
        assertEquals("web", parts.message("200")["to"])
        assertEquals(listOf("then"), parts.eventsOf("divider").map { it["label"] })
        assertEquals("3", parts.metric("Messages"))
        assertNull(parts.metric("Errors"))
        assertEquals(true, report.options["metricsEnabled"])
        val missing = assertThrows(IllegalStateException::class.java) { parts.message("GET /b") }.message!!
        assertTrue(missing.contains("found 0 in [GET /a, 200, GET /a again]"), missing)
        assertTrue(assertThrows(IllegalStateException::class.java) { parts.participant("db") }.message!!.contains("[web, api]"))
        assertEquals("{}", ReportJson("""{"scenarios": []}""").options.source, "no options: empty, not null")
    }

    @Test
    fun `parses every JSON value`() {
        val value = Json.parse("""{"a": [1, -2.5e1, true, false, null], "s": "\u0041\n\"\\/", "o": {}, "l": []}""") as JsonObject
        assertEquals(listOf(1.0, -25.0, true, false, null), value["a"])
        assertEquals("A\n\"\\/", value.string("s"))
        assertEquals("{}", value.obj("o")!!.source)
        assertEquals(emptyList<JsonObject>(), value.objects("l"))
        assertThrows(IllegalArgumentException::class.java) { Json.parse("""{"a": 1} x""") }
        assertThrows(IllegalStateException::class.java) { Json.parse("""{"a": 1 2}""") }
    }
}
