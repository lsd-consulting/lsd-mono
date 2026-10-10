package io.lsdconsulting.lsd.mono.core.json

import io.lsdconsulting.lsd.mono.core.PayloadConverters
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
 * Any value as JSON. Captured data is already a copy made by [PayloadConverters] (or an immutable
 * scalar) and is used as is, so its truncation markers are kept; anything else is
 * snapshotted with the default limits first, so this never throws and never recurses forever.
 */
internal fun anyToJson(value: Any?): JsonValue =
    when (value) {
        null, is String, is Boolean, is Long, is BigInteger, is BigDecimal -> snapshotToJson(value)
        else -> snapshotToJson(PayloadConverters.default.snapshot(value))
    }

/** Converts the JSON-shaped values [PayloadConverters] copies data into. */
private fun snapshotToJson(value: Any?): JsonValue =
    when (value) {
        null -> JsonNull
        is String -> JsonString(value)
        is Boolean -> JsonBool(value)
        is Long, is Int, is BigInteger -> JsonNumber(value.toString())
        is BigDecimal -> JsonNumber(value.toString())
        is Double -> if (value.isFinite()) JsonNumber(value.toString()) else JsonString(value.toString())
        is Map<*, *> -> JsonObject(value.entries.map { (key, item) -> key.toString() to snapshotToJson(item) })
        is List<*> -> JsonArray(value.map { snapshotToJson(it) })
        else -> JsonString(value.toString())
    }

private fun pad(indent: Int): String = "  ".repeat(indent)

internal fun JsonValue.render(): String =
    buildString { write(this, 0) }
