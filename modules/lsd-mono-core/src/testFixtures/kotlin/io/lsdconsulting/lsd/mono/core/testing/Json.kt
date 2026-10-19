package io.lsdconsulting.lsd.mono.core.testing

/**
 * A small JSON reader for tests, so they look values up instead of matching the writer's text.
 * Objects keep the exact text they were read from ([JsonObject.source]).
 */
public object Json {
    /** [text] as maps ([JsonObject]), lists, strings, numbers (Double), booleans and null. */
    public fun parse(text: String): Any? {
        val reader = Reader(text)
        val value = reader.value()
        reader.skipSpace()
        require(reader.at == text.length) { "unexpected text at ${reader.at}: ${text.drop(reader.at).take(20)}" }
        return value
    }

    private class Reader(
        val text: String,
    ) {
        var at = 0

        fun skipSpace() {
            while (at < text.length && text[at].isWhitespace()) at++
        }

        fun value(): Any? {
            skipSpace()
            require(at < text.length) { "unexpected end of JSON" }
            return when (text[at]) {
                '{' -> obj()
                '[' -> array()
                '"' -> string()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> number()
            }
        }

        private fun obj(): JsonObject {
            val start = at
            at++
            val map = LinkedHashMap<String, Any?>()
            skipSpace()
            if (text[at] == '}') {
                at++
                return JsonObject(map, text.substring(start, at))
            }
            while (true) {
                skipSpace()
                val key = string()
                skipSpace()
                expect(':')
                map[key] = value()
                skipSpace()
                when (text[at++]) {
                    ',' -> continue
                    '}' -> return JsonObject(map, text.substring(start, at))
                    else -> error("expected , or } at ${at - 1}")
                }
            }
        }

        private fun array(): List<Any?> {
            at++
            val list = ArrayList<Any?>()
            skipSpace()
            if (text[at] == ']') {
                at++
                return list
            }
            while (true) {
                list.add(value())
                skipSpace()
                when (text[at++]) {
                    ',' -> continue
                    ']' -> return list
                    else -> error("expected , or ] at ${at - 1}")
                }
            }
        }

        private fun string(): String {
            expect('"')
            val out = StringBuilder()
            while (true) {
                val c = text[at++]
                when (c) {
                    '"' -> return out.toString()
                    '\\' -> {
                        when (val e = text[at++]) {
                            '"', '\\', '/' -> out.append(e)
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000c')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                out.append(text.substring(at, at + 4).toInt(16).toChar())
                                at += 4
                            }
                            else -> error("bad escape \\$e at ${at - 1}")
                        }
                    }
                    else -> out.append(c)
                }
            }
        }

        private fun number(): Double {
            val start = at
            while (at < text.length && (text[at].isDigit() || text[at] in "+-.eE")) at++
            return text.substring(start, at).toDoubleOrNull() ?: error("bad value at $start: ${text.drop(start).take(20)}")
        }

        private fun literal(
            word: String,
            value: Boolean?,
        ): Boolean? {
            require(text.startsWith(word, at)) { "bad value at $at: ${text.drop(at).take(20)}" }
            at += word.length
            return value
        }

        private fun expect(c: Char) {
            require(at < text.length && text[at] == c) { "expected $c at $at" }
            at++
        }
    }
}

/** A JSON object: its members in order, and the exact text it was read from. */
public class JsonObject(
    private val members: Map<String, Any?>,
    /** The object's text as written, from `{` to `}`. */
    public val source: String,
) : Map<String, Any?> by members {
    public fun string(key: String): String? = members[key] as String?

    public fun obj(key: String): JsonObject? = members[key] as JsonObject?

    @Suppress("UNCHECKED_CAST")
    public fun objects(key: String): List<JsonObject> = (members[key] as List<JsonObject>?).orEmpty()

    override fun toString(): String = source
}
