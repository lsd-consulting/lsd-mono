package io.github.lsdconsulting.lsd.mono.report.model

import java.math.BigDecimal
import java.math.BigInteger
import java.util.Collections
import java.util.IdentityHashMap

/**
 * A JSON value: a message's payload ([MessageEventJson.data]). It is one of [NullValue],
 * [StringValue], [BooleanValue], [NumberValue], [ArrayValue] or [ObjectValue], and the writer
 * writes each as that JSON value, so nothing but JSON can be written.
 *
 * Make one with [of] (a String, Boolean, whole number, finite Double, BigInteger or BigDecimal),
 * [ofList], [ofObject] or [NULL]; or, from plain values (null, strings, booleans, numbers, maps and
 * lists, as lsd-mono-jvm's payload converters make), with [from].
 */
@ExperimentalLsdReportModel
public sealed class DataValueJson {
    /** JSON `null`. */
    @ExperimentalLsdReportModel
    public object NullValue : DataValueJson() {
        override fun toString(): String = "NullValue"
    }

    /** A JSON string. */
    @ExperimentalLsdReportModel
    public class StringValue(
        public val value: String,
    ) : DataValueJson() {
        override fun equals(other: Any?): Boolean = other is StringValue && other.value == value

        override fun hashCode(): Int = value.hashCode()

        override fun toString(): String = "StringValue($value)"
    }

    /** A JSON boolean. */
    @ExperimentalLsdReportModel
    public class BooleanValue(
        public val value: Boolean,
    ) : DataValueJson() {
        override fun equals(other: Any?): Boolean = other is BooleanValue && other.value == value

        override fun hashCode(): Int = value.hashCode()

        override fun toString(): String = "BooleanValue($value)"
    }

    /**
     * A JSON number, kept as the text it is written as ([literal]), so a number is written as it
     * was given: `12`, `12.5`, `1.0E10`, or a BigDecimal's digits. Two numbers are equal when their
     * text is: `1` and `1.0` are not. Made with [of].
     */
    @ExperimentalLsdReportModel
    public class NumberValue internal constructor(
        /** The number as written: a JSON number. */
        public val literal: String,
    ) : DataValueJson() {
        /** The number, exactly. */
        public fun toBigDecimal(): BigDecimal = BigDecimal(literal)

        override fun equals(other: Any?): Boolean = other is NumberValue && other.literal == literal

        override fun hashCode(): Int = literal.hashCode()

        override fun toString(): String = "NumberValue($literal)"
    }

    /** A JSON array. */
    @ExperimentalLsdReportModel
    public class ArrayValue(
        items: List<DataValueJson>,
    ) : DataValueJson() {
        public val items: List<DataValueJson> = items.toList()

        override fun equals(other: Any?): Boolean = other is ArrayValue && other.items == items

        override fun hashCode(): Int = items.hashCode()

        override fun toString(): String = "ArrayValue($items)"
    }

    /** A JSON object. Its fields are written in their map's order. */
    @ExperimentalLsdReportModel
    public class ObjectValue(
        fields: Map<String, DataValueJson>,
    ) : DataValueJson() {
        public val fields: Map<String, DataValueJson> = Collections.unmodifiableMap(LinkedHashMap(fields))

        /** The field named [key], or null when there is none. */
        public operator fun get(key: String): DataValueJson? = fields[key]

        override fun equals(other: Any?): Boolean = other is ObjectValue && other.fields == fields

        override fun hashCode(): Int = fields.hashCode()

        override fun toString(): String = "ObjectValue($fields)"
    }

    public companion object {
        /** JSON `null`: [NullValue]. */
        @JvmField
        public val NULL: DataValueJson = NullValue

        @JvmStatic
        public fun of(value: String): DataValueJson = StringValue(value)

        @JvmStatic
        public fun of(value: Boolean): DataValueJson = BooleanValue(value)

        @JvmStatic
        public fun of(value: Long): DataValueJson = NumberValue(value.toString())

        @JvmStatic
        public fun of(value: Int): DataValueJson = NumberValue(value.toString())

        /** A finite number: JSON has no NaN or infinity. Written as Kotlin prints it (`12.5`, `1.0E10`). */
        @JvmStatic
        public fun of(value: Double): DataValueJson {
            require(value.isFinite()) { "A JSON number is finite, not $value" }
            return NumberValue(value.toString())
        }

        @JvmStatic
        public fun of(value: BigInteger): DataValueJson = NumberValue(value.toString())

        @JvmStatic
        public fun of(value: BigDecimal): DataValueJson = NumberValue(value.toString())

        @JvmStatic
        public fun ofList(values: List<DataValueJson>): DataValueJson = ArrayValue(values)

        @JvmStatic
        public fun ofObject(fields: Map<String, DataValueJson>): DataValueJson = ObjectValue(fields)

        /**
         * [value] as JSON, as lsd-mono has always written a payload: null, a String, Boolean or
         * Number as itself; a `Map` as an object (each key's `toString()`), an `Iterable` or an
         * array as an array; a [DataValueJson] as it is. A NaN or infinite number is written as its
         * text, and anything else as its `toString()`, so this never throws. A map or list that
         * contains itself is written as the text `[lsd: cycle]` where it repeats.
         */
        @JvmStatic
        public fun from(value: Any?): DataValueJson = convert(value, Collections.newSetFromMap(IdentityHashMap()))

        private const val CYCLE: String = "[lsd: cycle]"

        private fun convert(
            value: Any?,
            open: MutableSet<Any>,
        ): DataValueJson =
            when (value) {
                null -> NullValue
                is DataValueJson -> value
                is String -> StringValue(value)
                is Boolean -> BooleanValue(value)
                is Long, is Int, is Short, is Byte, is BigInteger, is BigDecimal -> NumberValue(value.toString())
                is Double -> if (value.isFinite()) NumberValue(value.toString()) else StringValue(value.toString())
                is Float -> if (value.isFinite()) NumberValue(value.toString()) else StringValue(value.toString())
                is Map<*, *> -> nested(value, open) { ObjectValue(value.entries.associate { (key, item) -> key.toString() to convert(item, open) }) }
                is Iterable<*> -> nested(value, open) { ArrayValue(value.map { convert(it, open) }) }
                is Array<*> -> nested(value, open) { ArrayValue(value.map { convert(it, open) }) }
                else -> StringValue(value.toString())
            }

        private inline fun nested(
            value: Any,
            open: MutableSet<Any>,
            convert: () -> DataValueJson,
        ): DataValueJson {
            if (!open.add(value)) return StringValue(CYCLE)
            try {
                return convert()
            } finally {
                open.remove(value)
            }
        }
    }
}
