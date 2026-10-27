package io.github.lsdconsulting.lsd.mono.report.html

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Direct tests for Json.kt (#25). */
class JsonTest {
    @Test
    fun `jsonString escapes quotes, control characters and script-breaking markup`() {
        assertEquals(""""a\"b\\c"""", jsonString("a\"b\\c"))
        assertEquals(""""\n\r\t\u0001"""", jsonString("\n\r\t\u0001"))
        assertEquals(""""\u003c/script\u003e \u0026"""", jsonString("</script> &"))
        assertEquals(""""\u2028\u2029"""", jsonString("\u2028\u2029"))
        assertEquals("\"héllo ✓\"", jsonString("héllo ✓"))
    }

    @Test
    fun `anyToJson maps JSON values, lists arrays and keeps non-finite numbers as strings`() {
        val json =
            anyToJson(
                mapOf(
                    "s" to "x",
                    "i" to 1,
                    "l" to 2L,
                    "d" to 1.5,
                    "nan" to Double.NaN,
                    "b" to true,
                    "n" to null,
                    "list" to listOf(1, "two"),
                    "arr" to arrayOf(3),
                    "other" to StringBuilder("sb"),
                ),
            ).render()
        listOf(
            """"s": "x"""",
            """"i": 1""",
            """"l": 2""",
            """"d": 1.5""",
            """"nan": "NaN"""",
            """"b": true""",
            """"n": null""",
            """"other": "sb"""",
        ).forEach { assertTrue(json.contains(it), "$it in $json") }
        assertTrue(Regex(""""list": \[\s*1,\s*"two"\s*]""").containsMatchIn(json), json)
        assertTrue(Regex(""""arr": \[\s*3\s*]""").containsMatchIn(json), json)
        assertEquals("{}", anyToJson(emptyMap<String, Any>()).render())
        assertEquals("[]", anyToJson(emptyList<Any>()).render())
    }

    @Test
    fun `anyToJson writes a map or list that contains itself once, then a marker`() {
        val loop = mutableMapOf<String, Any?>("name" to "a")
        loop["self"] = loop
        val list = mutableListOf<Any?>(1)
        list.add(list)
        val json = anyToJson(mapOf("loop" to loop, "list" to list, "twice" to listOf(loop, loop))).render()
        assertEquals(4, Regex(Regex.escape(CYCLE)).findAll(json).count(), json)
        assertTrue(json.contains(""""name": "a""""), json)
    }

    @Test
    fun `anyToJson writes other numbers and objects as text`() {
        assertEquals("1.5", anyToJson(1.5f).render())
        assertEquals("\"Infinity\"", anyToJson(Float.POSITIVE_INFINITY).render())
        assertEquals(
            "\"7\"",
            anyToJson(
                java.util.concurrent.atomic
                    .AtomicInteger(7),
            ).render(),
        )
    }
}
