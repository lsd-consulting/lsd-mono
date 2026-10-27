package io.lsdconsulting.lsd.mono.ktor

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.math.BigInteger

class JsonTextTest {
    private fun parse(text: String) = JsonText.parse(text.toByteArray())

    @Test
    fun `objects and arrays become maps and lists in order`() {
        assertEquals(
            mapOf(
                "sku" to "lamp-01",
                "quantity" to 2L,
                "price" to BigDecimal("49.5"),
                "big" to BigDecimal("1e3"),
                "huge" to BigInteger("12345678901234567890"),
                "precise" to BigDecimal("0.1000000000000000000001"),
                "vast" to BigDecimal("1e999"),
                "tags" to listOf("a", true, false, null, -0L),
                "empty" to mapOf<String, Any?>(),
                "none" to listOf<Any?>(),
            ),
            parse(
                """ { "sku": "lamp-01", "quantity": 2, "price": 49.5, "big": 1e3, "huge": 12345678901234567890, "precise": 0.1000000000000000000001, "vast": 1e999, "tags": ["a", true, false, null, -0], "empty": {}, "none": [] } """,
            ),
        )
    }

    @Test
    fun `JSON is application json and any plus json type`() {
        listOf("application/json", "Application/JSON; charset=utf-8", "application/problem+json", "application/vnd.shop+json ;v=2")
            .forEach { assertTrue(JsonText.isJson(it), it) }
        listOf(null, "text/plain", "application/jsonl", "text/json-ish", "application/x-www-form-urlencoded")
            .forEach { assertFalse(JsonText.isJson(it), it) }
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
            "[\"\\u+123\"]",
            "[\"\\u-123\"]",
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
