package io.lsdconsulting.lsd.mono.report.html

import java.math.BigDecimal
import java.math.BigInteger

internal sealed interface JsonValue {
    fun write(out: StringBuilder, indent: Int)
}

internal data class JsonObject(val fields: List<Pair<String, JsonValue>>) : JsonValue {
    override fun write(out: StringBuilder, indent: Int) {
        if (fields.isEmpty()) {
            out.append("{}")
            return
        }
        out.append("{\n")
        fields.forEachIndexed { index, (key, value) ->
            out.append(pad(indent + 1)).append(jsonString(key)).append(": ")
            value.write(out, indent + 1)
            if (index != fields.lastIndex) out.append(',')
            out.append('\n')
        }
        out.append(pad(indent)).append('}')
    }
}

internal data class JsonArray(val items: List<JsonValue>) : JsonValue {
    override fun write(out: StringBuilder, indent: Int) {
        if (items.isEmpty()) {
            out.append("[]")
            return
        }
        out.append("[\n")
        items.forEachIndexed { index, value ->
            out.append(pad(indent + 1))
            value.write(out, indent + 1)
            if (index != items.lastIndex) out.append(',')
            out.append('\n')
        }
        out.append(pad(indent)).append(']')
    }
}

internal data class JsonString(val value: String) : JsonValue {
    override fun write(out: StringBuilder, indent: Int) {
        out.append(jsonString(value))
    }
}

internal data class JsonNumber(val literal: String) : JsonValue {
    override fun write(out: StringBuilder, indent: Int) {
        out.append(literal)
    }
}

internal data class JsonBool(val value: Boolean) : JsonValue {
    override fun write(out: StringBuilder, indent: Int) {
        out.append(if (value) "true" else "false")
    }
}

internal data object JsonNull : JsonValue {
    override fun write(out: StringBuilder, indent: Int) {
        out.append("null")
    }
}

internal fun jsonString(value: String): String =
    buildString {
        append('"')
        for (i in value.indices) {
            val c = value[i]
            when (c) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                '<' -> append("\\u003c")
                '>' -> append("\\u003e")
                '&' -> append("\\u0026")
                '\u2028' -> append("\\u2028")
                '\u2029' -> append("\\u2029")
                else ->
                    if (c.isSurrogate() && !isPairedSurrogate(value, i)) {
                        // A lone surrogate is not valid UTF-8. Keep the JSON valid.
                        append("\\ufffd")
                    } else if (c.code < 0x20) {
                        append("\\u")
                        append(c.code.toString(16).padStart(4, '0'))
                    } else {
                        append(c)
                    }
            }
        }
        append('"')
    }

private fun isPairedSurrogate(value: String, i: Int): Boolean {
    val c = value[i]
    return if (c.isHighSurrogate())
        i + 1 < value.length && value[i + 1].isLowSurrogate()
    else
        i > 0 && value[i - 1].isHighSurrogate()
}

/**
 * A message's data as JSON. The model asks for JSON values: null, strings, booleans, numbers, maps
 * and lists (lsd-mono-core gives it the copies its payload converters make). Arrays are written as
 * lists, a non-finite number as its text, and anything else as its `toString()`, so this never
 * throws. A map or list that contains itself is written as [CYCLE] where it repeats, so it never
 * recurses forever.
 */
internal fun anyToJson(value: Any?): JsonValue = toJson(value, java.util.Collections.newSetFromMap(java.util.IdentityHashMap()))

/** Where a map or list repeats inside itself. */
internal const val CYCLE: String = "[lsd: cycle]"

private fun toJson(
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
        is Map<*, *> -> nested(value, open) { JsonObject(value.entries.map { (key, item) -> key.toString() to toJson(item, open) }) }
        is Iterable<*> -> nested(value, open) { JsonArray(value.map { toJson(it, open) }) }
        is Array<*> -> nested(value, open) { JsonArray(value.map { toJson(it, open) }) }
        else -> JsonString(value.toString())
    }

private inline fun nested(
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

private fun pad(indent: Int): String = "  ".repeat(indent)

internal fun JsonValue.render(): String =
    buildString { write(this, 0) }

/** The same JSON on one line, with no spaces: for text that is parsed, not read. */
internal fun JsonValue.renderCompact(): String =
    buildString { writeCompact(this@renderCompact) }

private fun StringBuilder.writeCompact(value: JsonValue) {
    when (value) {
        is JsonObject -> {
            append('{')
            value.fields.forEachIndexed { index, (key, item) ->
                if (index > 0) append(',')
                append(jsonString(key)).append(':')
                writeCompact(item)
            }
            append('}')
        }
        is JsonArray -> {
            append('[')
            value.items.forEachIndexed { index, item ->
                if (index > 0) append(',')
                writeCompact(item)
            }
            append(']')
        }
        else -> value.write(this, 0)
    }
}
