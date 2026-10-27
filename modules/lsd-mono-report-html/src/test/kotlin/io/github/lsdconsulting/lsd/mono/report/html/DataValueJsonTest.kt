package io.github.lsdconsulting.lsd.mono.report.html

import io.github.lsdconsulting.lsd.mono.report.model.AttributeValueJson
import io.github.lsdconsulting.lsd.mono.report.model.DataValueJson
import io.github.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportJson
import io.github.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.github.lsdconsulting.lsd.mono.report.model.StatusJson
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportCorpus
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.math.BigInteger
import java.util.Collections
import java.util.IdentityHashMap

/**
 * A message's data as [DataValueJson] (#118) is written byte for byte as the `Any?` data was:
 * the same values give the same text as the writer's old conversion, and every report
 * lsd-mono-jvm writes in the shared test reports reads back into plain values and writes out
 * through [DataValueJson] unchanged.
 */
class DataValueJsonTest {
    @Test
    fun `plain values are written exactly as the Any data was`() {
        val loop = mutableMapOf<String, Any?>("name" to "a")
        loop["self"] = loop
        val values =
            listOf(
                null,
                "text",
                "</script> & \u2028 héllo ✓ \u0001",
                true,
                false,
                0,
                -7,
                Long.MAX_VALUE,
                12.toShort(),
                3.toByte(),
                BigInteger("123456789012345678901234567890"),
                BigDecimal("12.50"),
                BigDecimal("1E+3"),
                12.5,
                1.0E10,
                -0.0,
                Double.NaN,
                Double.NEGATIVE_INFINITY,
                1.5f,
                Float.NaN,
                emptyMap<String, Any>(),
                emptyList<Any>(),
                arrayOf<Any?>(1, "two", null),
                setOf("a", "b"),
                mapOf("method" to "POST", "path" to "/orders", "body" to mapOf("sku" to "SOCK-1", "qty" to 2, "tags" to listOf("x", 1.25, null))),
                mapOf(1 to "int key", null to "null key", "nested" to listOf(mapOf("deep" to listOf(emptyMap<String, Any>())))),
                StringBuilder("sb"),
                java.util.concurrent.atomic
                    .AtomicInteger(7),
                loop,
                mapOf("twice" to listOf(loop, loop)),
            )
        for (value in values) {
            val legacy = legacyAnyToJson(value)
            val typed = DataValueJson.from(value).toJsonValue()
            assertEquals(legacy.render(), typed.render(), "$value")
            assertEquals(legacy.renderCompact(), typed.renderCompact(), "$value")
        }
    }

    @Test
    fun `every report lsd-mono-jvm writes reads back and writes out byte for byte`() {
        val manifest = JsonReader(ReportCorpus.read("manifest.json")).read() as Map<*, *>
        val produced =
            (manifest["fixtures"] as List<*>)
                .map { it as Map<*, *> }
                .filter { it["source"] == "lsd-mono-jvm" && (it["file"] as String).endsWith(".json") }
                .map { it["file"] as String }
        assertTrue(produced.size >= 10, "$produced")
        for (file in produced) {
            val text = ReportCorpus.read(file)
            val written = DataValueJson.from(JsonReader(text).read()).toJsonValue().render() + "\n"
            assertEquals(text, written, file)
        }
    }

    @Test
    fun `a participant's attributes are written after its colour, and not when there are none`() {
        val participant =
            ParticipantJson
                .builder("orders", "Orders")
                .colour("blue")
                .attribute("service.name", "orders")
                .attribute("service.version", "2.4.1")
                .attribute("lsd.instances", 3)
                .attribute("lsd.external", false)
                .attribute("lsd.load", 0.75)
                .attribute("lsd.regions", AttributeValueJson.ofStrings(listOf("eu-west-2")))
                .build()
        val json = report(participant, ParticipantJson.builder("web", "Web").build())

        @Suppress("UNCHECKED_CAST")
        val scenario = ((JsonReader(json).read() as Map<String, Any?>)["scenarios"] as List<Map<String, Any?>>).single()

        @Suppress("UNCHECKED_CAST")
        val written = scenario["participants"] as List<Map<String, Any?>>
        assertEquals(listOf("colour", "attributes"), written[0].keys.toList().takeLast(2))
        assertEquals(
            listOf<Pair<String, Any?>>(
                "service.name" to "orders",
                "service.version" to "2.4.1",
                "lsd.instances" to 3L,
                "lsd.external" to false,
                "lsd.load" to BigDecimal("0.75"),
                "lsd.regions" to listOf("eu-west-2"),
            ),
            (written[0]["attributes"] as Map<*, *>).map { (key, value) -> key as String to value },
        )
        assertFalse("attributes" in written[1], "no attributes for a participant with none")
        assertEquals(emptyList<String>(), ReportSchemas.errors(ReportSchemas.Document.REPORT, json))
    }

    private fun report(vararg participants: ParticipantJson): String =
        ReportWriter.toJson(
            ReportJson
                .builder("Participants", "2026-01-01T12:00:00Z", "test", StatusJson.SUCCESS)
                .scenario(
                    participants
                        .fold(ScenarioJson.builder("s1", "One", StatusJson.SUCCESS)) { builder, participant -> builder.participant(participant) }
                        .build(),
                ).build(),
        )

    /** The writer's conversion of `Any?` data before #118, kept to compare against. */
    private fun legacyAnyToJson(value: Any?): JsonValue = legacy(value, Collections.newSetFromMap(IdentityHashMap()))

    private fun legacy(
        value: Any?,
        open: MutableSet<Any>,
    ): JsonValue =
        when (value) {
            null -> JsonNull
            is String -> JsonString(value)
            is Boolean -> JsonBool(value)
            is Long, is Int, is Short, is Byte, is BigInteger -> JsonNumber(value.toString())
            is BigDecimal -> JsonNumber(value.toString())
            is Double -> if (value.isFinite()) JsonNumber(value.toString()) else JsonString(value.toString())
            is Float -> if (value.isFinite()) JsonNumber(value.toString()) else JsonString(value.toString())
            is Map<*, *> -> legacyNested(value, open) { JsonObject(value.entries.map { (key, item) -> key.toString() to legacy(item, open) }) }
            is Iterable<*> -> legacyNested(value, open) { JsonArray(value.map { legacy(it, open) }) }
            is Array<*> -> legacyNested(value, open) { JsonArray(value.map { legacy(it, open) }) }
            else -> JsonString(value.toString())
        }

    private inline fun legacyNested(
        value: Any,
        open: MutableSet<Any>,
        write: () -> JsonValue,
    ): JsonValue {
        if (!open.add(value)) return JsonString(CYCLE)
        try {
            return write()
        } finally {
            open.remove(value)
        }
    }

    /**
     * Reads JSON into the plain values lsd-mono-jvm hands the model: maps in order, lists,
     * strings, booleans, null, and a number as a Long, a BigInteger or, with a fraction or an
     * exponent, a BigDecimal of its text.
     */
    private class JsonReader(
        private val text: String,
    ) {
        private var i = 0

        fun read(): Any? = value().also { ws() }.also { check(i == text.length) { "trailing text at $i" } }

        private fun ws() {
            while (i < text.length && text[i] in " \t\r\n") i++
        }

        private fun value(): Any? {
            ws()
            return when (val c = text[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c.isDigit()) num() else error("unexpected $c at $i")
            }
        }

        private fun literal(
            word: String,
            value: Any?,
        ): Any? {
            check(text.startsWith(word, i)) { "expected $word at $i" }
            i += word.length
            return value
        }

        private fun obj(): Map<String, Any?> {
            val out = linkedMapOf<String, Any?>()
            i++
            ws()
            if (text[i] == '}') return out.also { i++ }
            while (true) {
                ws()
                val key = str()
                ws()
                check(text[i++] == ':')
                out[key] = value()
                ws()
                if (text[i++] == '}') return out
            }
        }

        private fun arr(): List<Any?> {
            val out = mutableListOf<Any?>()
            i++
            ws()
            if (text[i] == ']') return out.also { i++ }
            while (true) {
                out.add(value())
                ws()
                if (text[i++] == ']') return out
            }
        }

        private fun str(): String {
            check(text[i++] == '"')
            val out = StringBuilder()
            while (true) {
                when (val c = text[i++]) {
                    '"' -> return out.toString()
                    '\\' ->
                        when (val e = text[i++]) {
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000c')
                            'u' -> out.append(text.substring(i, i + 4).toInt(16).toChar()).also { i += 4 }
                            else -> out.append(e)
                        }
                    else -> out.append(c)
                }
            }
        }

        private fun num(): Any {
            val start = i
            while (i < text.length && (text[i].isDigit() || text[i] in "+-.eE")) i++
            val literal = text.substring(start, i)
            return if (literal.any { it in ".eE" }) BigDecimal(literal) else literal.toLongOrNull() ?: BigInteger(literal)
        }
    }
}
