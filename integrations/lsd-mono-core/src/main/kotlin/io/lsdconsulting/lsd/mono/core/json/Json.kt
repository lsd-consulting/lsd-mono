package io.lsdconsulting.lsd.mono.core.json

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
        for (c in value) {
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
                    if (c.code < 0x20) {
                        append("\\u")
                        append(c.code.toString(16).padStart(4, '0'))
                    } else {
                        append(c)
                    }
            }
        }
        append('"')
    }

internal fun anyToJson(value: Any?): JsonValue =
    when (value) {
        null -> JsonNull
        is String -> JsonString(value)
        is Boolean -> JsonBool(value)
        is Byte -> JsonNumber(value.toString())
        is Short -> JsonNumber(value.toString())
        is Int -> JsonNumber(value.toString())
        is Long -> JsonNumber(value.toString())
        is Float -> numberOrString(value.toDouble(), value.toString())
        is Double -> numberOrString(value, value.toString())
        is Map<*, *> ->
            JsonObject(value.entries.map { (key, item) -> key.toString() to anyToJson(item) })
        is Iterable<*> -> JsonArray(value.map { anyToJson(it) })
        is Array<*> -> JsonArray(value.map { anyToJson(it) })
        else -> JsonString(value.toString())
    }

private fun numberOrString(value: Double, raw: String): JsonValue =
    if (value.isFinite()) JsonNumber(raw) else JsonString(raw)

private fun pad(indent: Int): String = "  ".repeat(indent)

internal fun JsonValue.render(): String =
    buildString { write(this, 0) }
