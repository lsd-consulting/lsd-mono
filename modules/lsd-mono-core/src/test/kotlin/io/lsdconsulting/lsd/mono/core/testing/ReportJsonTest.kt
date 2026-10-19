package io.lsdconsulting.lsd.mono.core.testing

import io.lsdconsulting.lsd.mono.core.LsdContext
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
