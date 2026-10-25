package io.lsdconsulting.lsd.mono.http4k

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class JsonTextTest {
    private fun parse(text: String) = JsonText.parse(text.toByteArray())

    @Test
    fun `objects and arrays become maps and lists in order`() {
        assertEquals(
            mapOf(
                "sku" to "lamp-01",
                "quantity" to 2L,
                "price" to 49.5,
                "big" to 1.0e3,
                "huge" to 12345678901234567890.0,
                "tags" to listOf("a", true, false, null, -0L),
                "empty" to mapOf<String, Any?>(),
                "none" to listOf<Any?>(),
            ),
            parse(
                """ { "sku": "lamp-01", "quantity": 2, "price": 49.5, "big": 1e3, "huge": 12345678901234567890, "tags": ["a", true, false, null, -0], "empty": {}, "none": [] } """,
            ),
        )
    }

    @Test
    fun `escapes are read`() {
        assertEquals(listOf("q\" \\ / \b \u000C \n \r \t é"), parse("""["q\" \\ \/ \b \f \n \r \t \u00e9"]"""))
    }

    @Test
    fun `anything else is not JSON`() {
        listOf(
            "",
            "lamp-01",
            "42",
            "\"text\"",
            "{",
            "[1,",
            "[1 2]",
            "{\"a\" 1}",
            "{\"a\":1 \"b\":2}",
            "{a:1}",
            "[01]",
            "[1.]",
            "[tru]",
            "[\"\\x\"]",
            "[\"\\u12\"]",
            "[\"\\uzzzz\"]",
            "[\"line\nbreak\"]",
            "[\"open",
            "[] []",
            "[",
            "{\"a\":",
        ).forEach { assertNull(parse(it), it) }
        assertNull(JsonText.parse(byteArrayOf('['.code.toByte(), 0xC3.toByte(), ']'.code.toByte())))
        assertNull(parse("[".repeat(100) + "]".repeat(100)))
    }
}
