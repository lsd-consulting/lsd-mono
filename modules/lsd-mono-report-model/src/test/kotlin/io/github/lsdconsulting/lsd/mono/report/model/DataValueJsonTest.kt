package io.github.lsdconsulting.lsd.mono.report.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.math.BigDecimal
import java.math.BigInteger

/** A message's data as a JSON value (#118). */
class DataValueJsonTest {
    @Test
    fun `the factories make each kind of JSON value`() {
        assertEquals("x", (DataValueJson.of("x") as DataValueJson.StringValue).value)
        assertEquals(true, (DataValueJson.of(true) as DataValueJson.BooleanValue).value)
        assertEquals("12", number(DataValueJson.of(12L)))
        assertEquals("12", number(DataValueJson.of(12)))
        assertEquals("12.5", number(DataValueJson.of(12.5)))
        assertEquals("1.0E10", number(DataValueJson.of(1.0E10)), "a Double is written as Kotlin prints it")
        assertEquals("123456789012345678901234567890", number(DataValueJson.of(BigInteger("123456789012345678901234567890"))))
        assertEquals("12.50", number(DataValueJson.of(BigDecimal("12.50"))), "a BigDecimal keeps its scale")
        assertEquals(BigDecimal("12.50"), (DataValueJson.of(BigDecimal("12.50")) as DataValueJson.NumberValue).toBigDecimal())
        assertSame(DataValueJson.NullValue, DataValueJson.NULL)
        val list = DataValueJson.ofList(listOf(DataValueJson.of(1), DataValueJson.NULL)) as DataValueJson.ArrayValue
        assertEquals(listOf(DataValueJson.of(1), DataValueJson.NULL), list.items)
        val obj = DataValueJson.ofObject(linkedMapOf("b" to DataValueJson.of(1), "a" to DataValueJson.of(2))) as DataValueJson.ObjectValue
        assertEquals(listOf("b", "a"), obj.fields.keys.toList(), "an object keeps its fields' order")
        assertEquals(DataValueJson.of(2), obj["a"])
        assertThrows(IllegalArgumentException::class.java) { DataValueJson.of(Double.NaN) }
        assertThrows(IllegalArgumentException::class.java) { DataValueJson.of(Double.POSITIVE_INFINITY) }
    }

    @Test
    fun `values are equal by what they hold, and copy what they are given`() {
        assertEquals(DataValueJson.of("x"), DataValueJson.of("x"))
        assertEquals(DataValueJson.of("x").hashCode(), DataValueJson.of("x").hashCode())
        assertEquals(DataValueJson.of(true).hashCode(), DataValueJson.of(true).hashCode())
        assertEquals(DataValueJson.of(1L), DataValueJson.of(1))
        assertEquals(DataValueJson.of(1L).hashCode(), DataValueJson.of(1).hashCode())
        assertNotEquals(DataValueJson.of(1), DataValueJson.of(1.0), "1 and 1.0 are written apart")
        assertNotEquals(DataValueJson.of("1"), DataValueJson.of(1))
        assertNotEquals(DataValueJson.of(true), DataValueJson.of(false))
        assertEquals(DataValueJson.from(listOf(1, "a")), DataValueJson.from(listOf(1, "a")))
        assertEquals(DataValueJson.from(listOf(1)).hashCode(), DataValueJson.from(listOf(1)).hashCode())
        assertEquals(DataValueJson.from(mapOf("a" to 1)), DataValueJson.from(mapOf("a" to 1)))
        assertEquals(DataValueJson.from(mapOf("a" to 1)).hashCode(), DataValueJson.from(mapOf("a" to 1)).hashCode())
        val items = mutableListOf<DataValueJson>(DataValueJson.of(1))
        val fields = linkedMapOf<String, DataValueJson>("a" to DataValueJson.of(1))
        val list = DataValueJson.ofList(items) as DataValueJson.ArrayValue
        val obj = DataValueJson.ofObject(fields) as DataValueJson.ObjectValue
        items.add(DataValueJson.of(2))
        fields["b"] = DataValueJson.of(2)
        assertEquals(1, list.items.size)
        assertEquals(1, obj.fields.size)
        assertEquals(
            "ObjectValue({s=StringValue(x), b=BooleanValue(true), n=NumberValue(1), l=ArrayValue([NullValue])})",
            DataValueJson.from(mapOf("s" to "x", "b" to true, "n" to 1, "l" to listOf(null))).toString(),
        )
    }

    @Test
    fun `from reads plain values as the writer always has`() {
        assertSame(DataValueJson.NullValue, DataValueJson.from(null))
        val typed = DataValueJson.of(5)
        assertSame(typed, DataValueJson.from(typed), "a DataValueJson is taken as it is")
        assertEquals(DataValueJson.of(3), DataValueJson.from(3.toShort()))
        assertEquals(DataValueJson.of(3), DataValueJson.from(3.toByte()))
        assertEquals(DataValueJson.of(BigDecimal("1E+3")), DataValueJson.from(BigDecimal("1E+3")))
        assertEquals("1.5", number(DataValueJson.from(1.5f)))
        assertEquals(DataValueJson.of("NaN"), DataValueJson.from(Double.NaN), "JSON has no NaN: written as text")
        assertEquals(DataValueJson.of("Infinity"), DataValueJson.from(Float.POSITIVE_INFINITY))
        assertEquals(DataValueJson.of("sb"), DataValueJson.from(StringBuilder("sb")), "anything else is its toString()")
        assertEquals(DataValueJson.from(listOf(1, "two")), DataValueJson.from(arrayOf<Any>(1, "two")), "an array is a list")
        assertEquals(DataValueJson.from(listOf("a")), DataValueJson.from(setOf("a")), "any Iterable is a list")
        assertEquals(DataValueJson.from(mapOf("1" to "x", "null" to "y")), DataValueJson.from(mapOf(1 to "x", null to "y")), "keys are their toString()")
        val loop = mutableMapOf<String, Any?>("name" to "a")
        loop["self"] = loop
        val list = mutableListOf<Any?>(1)
        list.add(list)
        assertEquals(
            DataValueJson.from(
                mapOf(
                    "loop" to mapOf("name" to "a", "self" to "[lsd: cycle]"),
                    "list" to listOf(1, "[lsd: cycle]"),
                    "twice" to listOf(mapOf("name" to "a", "self" to "[lsd: cycle]"), mapOf("name" to "a", "self" to "[lsd: cycle]")),
                ),
            ),
            DataValueJson.from(mapOf("loop" to loop, "list" to list, "twice" to listOf(loop, loop))),
            "a map or list that contains itself is written once, then a marker",
        )
    }

    @Test
    fun `a message's data is a JSON value or none`() {
        val message = MessageEventJson.builder("m1", "a", "b", "hi", KnownMessageType.SYNCHRONOUS)
        val data = DataValueJson.from(mapOf("method" to "POST"))
        assertEquals(null, message.build().data)
        assertEquals(data, message.data(data).build().data)
        assertEquals(
            data,
            message
                .data(data)
                .build()
                .toBuilder()
                .build()
                .data,
        )
        assertSame(DataValueJson.NULL, message.data(DataValueJson.NULL).build().data, "JSON null is data, not none")
    }

    private fun number(value: DataValueJson): String = (value as DataValueJson.NumberValue).literal
}
