package io.lsdconsulting.lsd.mono.report.model.testing

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/** [Json], the tests' JSON reader (#109). */
class JsonTest {
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
