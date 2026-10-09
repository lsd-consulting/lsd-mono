package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.PayloadSnapshot
import io.lsdconsulting.lsd.mono.core.capture.PayloadSnapshot.Limits
import io.lsdconsulting.lsd.mono.core.json.anyToJson
import io.lsdconsulting.lsd.mono.core.json.render
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.nio.ByteBuffer
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.util.Date
import java.util.Optional
import java.util.OptionalInt
import java.util.UUID

/** The awkward cases of message data (#27). Every result must also render as valid JSON. */
class PayloadSnapshotTest {
    private val snapshot = PayloadSnapshot(Limits())

    private fun snap(value: Any?, limits: Limits = Limits()): Any? =
        PayloadSnapshot(limits).snapshot(value).also { assertValidJson(anyToJson(it).render()) }

    private fun json(value: Any?): String = anyToJson(snapshot.snapshot(value)).render().also(::assertValidJson)

    enum class Colour { RED, GREEN }

    data class Address(val street: String, val postcode: String?)

    data class Customer(val name: String, val colour: Colour, val address: Address, val tags: List<String>)

    class Node(val name: String) {
        var next: Node? = null
    }

    class BadToString {
        override fun toString(): String = throw IllegalStateException("boom")
    }

    @Test
    fun `nulls stay null`() {
        assertEquals(null, snap(null))
        assertEquals(mapOf("a" to null), snap(mapOf("a" to null)))
        assertEquals(listOf(null, 1L), snap(listOf(null, 1)))
        assertEquals(mapOf("street" to "High St", "postcode" to null), snap(Address("High St", null)))
    }

    @Test
    fun `cycles become markers and shared references do not`() {
        val map = mutableMapOf<String, Any?>("name" to "loop")
        map["self"] = map
        assertEquals(mapOf("name" to "loop", "self" to "[lsd: cycle back to java.util.LinkedHashMap]"), snap(map))

        val list = mutableListOf<Any?>("a")
        list.add(list)
        assertEquals(listOf("a", "[lsd: cycle back to java.util.ArrayList]"), snap(list))

        val a = Node("a").also { it.next = Node("b").also { b -> b.next = it } }
        val nodes = snap(a) as Map<*, *>
        assertEquals("[lsd: cycle back to ${Node::class.java.name}]", (nodes["next"] as Map<*, *>)["next"])

        val shared = listOf(1, 2)
        assertEquals(mapOf("x" to listOf(1L, 2L), "y" to listOf(1L, 2L)), snap(mapOf("x" to shared, "y" to shared)))
    }

    @Test
    fun `deep nesting stops at the depth limit without a stack overflow`() {
        var deep: Any? = "bottom"
        repeat(100_000) { deep = listOf(deep) }
        var level = snap(deep)
        var depth = 0
        while (level is List<*>) {
            level = level.single()
            depth++
        }
        assertEquals(32, depth)
        assertEquals("[lsd: max depth 32 reached]", level)
        assertTrue(json(deep).contains("max depth 32 reached"))
    }

    @Test
    fun `large strings, collections, maps and totals are truncated with an indicator`() {
        val limits = Limits(maxStringLength = 10, maxItems = 3, maxTotalSize = 1_000)
        assertEquals("0123456789… [lsd: truncated 5 characters]", snap("012345678901234", limits))
        assertEquals(listOf(0L, 1L, 2L, "[lsd: 7 more items]"), snap((0 until 10).toList(), limits))
        assertEquals(listOf(0L, 1L, 2L, "[lsd: 7 more items]"), snap(IntArray(10) { it }, limits))
        assertEquals(listOf(0L, 1L, 2L, "[lsd: more items not read]"), snap(generateSequence(0) { it + 1 }.asIterable(), limits))
        assertEquals(
            mapOf("k0" to 0L, "k1" to 1L, "k2" to 2L, PayloadSnapshot.TRUNCATED_KEY to "7 more entries"),
            snap((0 until 10).associate { "k$it" to it }, limits),
        )

        val total = snap(List(50) { "x".repeat(100) }, Limits(maxTotalSize = 1_000)) as List<*>
        assertTrue(total.size < 50, "kept ${total.size}")
        assertEquals("[lsd: payload larger than 1000 characters, rest dropped]", total.last())
        assertEquals(1, total.count { it.toString().startsWith("[lsd:") })
        val totalMap = snap((0 until 50).associate { "k$it" to "x".repeat(100) }, Limits(maxTotalSize = 1_000)) as Map<*, *>
        assertEquals("payload larger than 1000 characters, rest dropped", totalMap[PayloadSnapshot.TRUNCATED_KEY])

        val huge = "y".repeat(5_000_000)
        val rendered = json(huge)
        assertTrue(rendered.length < 200_000, "rendered ${rendered.length}")
        assertTrue(rendered.contains("[lsd: truncated 4900000 characters]"))
    }

    @Test
    fun `bytes become text when they are UTF-8 text, otherwise marked base64`() {
        assertEquals("héllo {\"a\":1}\n", snap("héllo {\"a\":1}\n".toByteArray()))
        val binary = byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0, 1)
        assertEquals("[lsd: binary, 4 bytes] base64://4AAQ==", snap(binary))
        assertEquals("[lsd: binary, 2 bytes] base64:AAE=", snap(byteArrayOf(0, 1)))
        assertEquals("[lsd: binary, 4 bytes] base64:AAEC… [lsd: truncated]", snap(byteArrayOf(0, 1, 2, 3), Limits(maxStringLength = 4)))

        val buffer = ByteBuffer.wrap("buffered".toByteArray())
        buffer.get()
        assertEquals("uffered", snap(buffer))
        assertEquals(1, buffer.position())
    }

    @Test
    fun `optionals, java time, dates, enums and plain value types`() {
        assertEquals("x", snap(Optional.of("x")))
        assertEquals(null, snap(Optional.empty<String>()))
        assertEquals(5L, snap(OptionalInt.of(5)))
        assertEquals(null, snap(OptionalInt.empty()))
        assertEquals("2026-10-09T17:00:00Z", snap(Instant.parse("2026-10-09T17:00:00Z")))
        assertEquals("2026-10-09", snap(LocalDate.of(2026, 10, 9)))
        assertEquals("PT1M30S", snap(Duration.ofSeconds(90)))
        assertEquals("2026-10-09T17:00Z", snap(ZonedDateTime.of(2026, 10, 9, 17, 0, 0, 0, ZoneOffset.UTC)))
        assertEquals("2026-10-09T17:00:00Z", snap(Date.from(Instant.parse("2026-10-09T17:00:00Z"))))
        assertEquals("2026-10-09", snap(java.sql.Date.valueOf("2026-10-09")))
        assertEquals("RED", snap(Colour.RED))
        val uuid = UUID.fromString("00000000-0000-0000-0000-000000000001")
        assertEquals(uuid.toString(), snap(uuid))
        assertEquals(BigDecimal("1.50"), snap(BigDecimal("1.50")))
        assertEquals("NaN", snap(Double.NaN))
        assertEquals('c'.toString(), snap('c'))
        assertEquals(mapOf("first" to "a", "second" to 1L), snap("a" to 1))
        assertEquals(mapOf("exception" to "java.lang.IllegalStateException", "message" to "bad"), snap(IllegalStateException("bad")))
    }

    @Test
    fun `maps with non-string keys use the key text and keep colliding keys apart`() {
        assertEquals(mapOf("1" to "one", "2" to "two"), snap(mapOf(1 to "one", 2 to "two")))
        assertEquals(mapOf("RED" to 1L), snap(mapOf(Colour.RED to 1)))
        assertEquals(mapOf("null" to "nothing"), snap(mapOf(null to "nothing")))
        assertEquals(mapOf("1" to "int", "1 #2" to "string"), snap(linkedMapOf<Any, String>(1 to "int", "1" to "string")))
        assertEquals(
            mapOf("{street=High St, postcode=null}" to "home"),
            snap(mapOf(Address("High St", null) to "home")),
        )
    }

    @Test
    fun `kotlin data classes and java records become objects of their fields`() {
        assertEquals(
            mapOf(
                "name" to "Ada",
                "colour" to "GREEN",
                "address" to mapOf("street" to "High St", "postcode" to "AB1"),
                "tags" to listOf("vip"),
            ),
            snap(Customer("Ada", Colour.GREEN, Address("High St", "AB1"), listOf("vip"))),
        )
        assertEquals(mapOf("id" to "o-1", "quantity" to 2L, "tags" to listOf("gift")), snap(OrderRecord("o-1", 2, listOf("gift"))))
        assertTrue(json(OrderRecord("o-1", 2, listOf())).contains(""""quantity": 2"""))
    }

    @Test
    fun `failing toString, accessors, iterators and converters become markers`() {
        assertEquals("[lsd: toString() of ${BadToString::class.java.name} threw java.lang.IllegalStateException: boom]", snap(BadToString()))
        assertEquals(
            mapOf("name" to "n", "secret" to "[lsd: secret could not be read: java.lang.IllegalStateException: accessor failed]"),
            snap(FailingRecord("n", "s")),
        )
        val badList = object : AbstractList<Any>() {
            override val size = 2

            override fun get(index: Int): Any = throw UnsupportedOperationException("no items")
        }
        assertEquals(
            mapOf("ok" to 1L, "bad" to "[lsd: ${badList.javaClass.name} could not be read: java.lang.UnsupportedOperationException: no items]"),
            snap(mapOf("ok" to 1, "bad" to badList)),
        )
        val throwing = PayloadSnapshot(Limits()).register(Address::class.java) { throw IllegalArgumentException("nope") }
        assertEquals(
            mapOf("a" to "[lsd: ${Address::class.java.name} could not be read: java.lang.IllegalArgumentException: nope]"),
            throwing.snapshot(mapOf("a" to Address("s", null))),
        )
    }

    @Test
    fun `registered converters run first, later registrations win and results are snapshotted`() {
        val payloads = PayloadSnapshot(Limits())
            .register(Address::class.java) { "first" }
            .register(Address::class.java) { address -> mutableMapOf("line" to address.street, "at" to Instant.EPOCH) }
            .register(Colour::class.java) { it } // returns itself: no loop
        assertEquals(mapOf("line" to "High St", "at" to "1970-01-01T00:00:00Z"), payloads.snapshot(Address("High St", null)))
        assertEquals("RED", payloads.snapshot(Colour.RED))
        payloads.clearConverters()
        assertEquals(mapOf("street" to "High St", "postcode" to null), payloads.snapshot(Address("High St", null)))
    }

    @Test
    fun `json is valid and safe to embed in html`() {
        val hostile = mapOf(
            "html" to "</script><script>alert(1)</script><!-- & -->",
            "separators" to "a\u2028b\u2029c",
            "control" to "nul\u0000bell\u0007",
            "lone" to "high\uD800 low\uDC00 pair\uD83D\uDE00",
            "quote" to "\"\\",
        )
        val rendered = json(hostile)
        assertFalse(rendered.contains("<"), rendered)
        assertFalse(rendered.contains(">"), rendered)
        assertFalse(rendered.contains("\u2028"), rendered)
        assertFalse(rendered.contains("\u0000"), rendered)
        assertTrue(rendered.contains("high\\ufffd low\\ufffd pair\uD83D\uDE00"), rendered)
        assertTrue(rendered.contains("\\u003c/script\\u003e"), rendered)
    }

    @Test
    fun `snapshots are immutable and are not copied twice`() {
        val first = snapshot.snapshot(mapOf("a" to mutableListOf(1)))
        assertTrue(first === snapshot.snapshot(first))
        @Suppress("UNCHECKED_CAST")
        val list = (first as Map<String, Any?>)["a"] as List<Any?>
        assertFalse(list is MutableList<*> && runCatching { (list as MutableList<Any?>).add(2) }.isSuccess)
    }

    companion object {
        /** A strict JSON (RFC 8259) syntax check, enough to prove the output parses. */
        fun assertValidJson(text: String) {
            var i = 0

            fun fail(why: String): Nothing = throw AssertionError("invalid JSON at $i ($why): ${text.take(300)}")

            fun ws() {
                while (i < text.length && text[i] in " \t\r\n") i++
            }

            fun expect(c: Char) {
                if (i >= text.length || text[i] != c) fail("expected $c")
                i++
            }

            fun string() {
                expect('"')
                while (true) {
                    if (i >= text.length) fail("unterminated string")
                    val c = text[i++]
                    when {
                        c == '"' -> return
                        c == '\\' -> {
                            val e = text.getOrNull(i++) ?: fail("bad escape")
                            if (e == 'u') {
                                if (i + 4 > text.length || !text.substring(i, i + 4).all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) fail("bad \\u")
                                i += 4
                            } else if (e !in "\"\\/bfnrt") {
                                fail("bad escape $e")
                            }
                        }
                        c.code < 0x20 -> fail("raw control character")
                        c.isHighSurrogate() -> if (text.getOrNull(i)?.isLowSurrogate() == true) i++ else fail("lone surrogate")
                        c.isLowSurrogate() -> fail("lone surrogate")
                    }
                }
            }

            fun value() {
                ws()
                when (text.getOrNull(i)) {
                    '{' -> {
                        i++
                        ws()
                        if (text.getOrNull(i) == '}') {
                            i++
                            return
                        }
                        while (true) {
                            ws()
                            string()
                            ws()
                            expect(':')
                            value()
                            ws()
                            if (text.getOrNull(i) != ',') {
                                expect('}')
                                return
                            }
                            i++
                        }
                    }
                    '[' -> {
                        i++
                        ws()
                        if (text.getOrNull(i) == ']') {
                            i++
                            return
                        }
                        while (true) {
                            value()
                            ws()
                            if (text.getOrNull(i) != ',') {
                                expect(']')
                                return
                            }
                            i++
                        }
                    }
                    '"' -> string()
                    else -> {
                        val m = Regex("""-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null""").matchAt(text, i) ?: fail("bad value")
                        i += m.value.length
                    }
                }
            }
            value()
            ws()
            if (i != text.length) fail("trailing text")
        }
    }
}
