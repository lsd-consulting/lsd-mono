package io.github.lsdconsulting.lsd.mono.http4k

import java.math.BigDecimal
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * A JSON body as maps and lists, so the inspector shows it as a structure (as the Spring Boot
 * starter's are) rather than as one escaped string. http4k has no JSON library of its own (the
 * app picks one), so this is a small strict reader: anything that is not a complete JSON object
 * or array in UTF-8 is left as it was.
 */
internal object JsonText {
    private const val MAX_DEPTH = 64

    /**
     * Whether a body of [contentType] is read as JSON: `application/json` and any `+json` type
     * (`application/problem+json`), parameters aside. The Spring Boot starter's rule.
     */
    fun isJson(contentType: String?): Boolean {
        val type = contentType?.substringBefore(';')?.trim()?.lowercase() ?: return false
        return type == "application/json" || type.endsWith("+json")
    }

    /** [bytes] as maps, lists, strings, numbers, booleans and nulls; null when they are not a JSON object or array. */
    fun parse(bytes: ByteArray): Any? {
        val text = utf8(bytes)?.trim() ?: return null
        if (text.isEmpty() || (text[0] != '{' && text[0] != '[')) return null
        return try {
            Reader(text).run {
                value(0).also {
                    skipSpace()
                    if (at < text.length) throw Invalid
                }
            }
        } catch (_: Invalid) {
            null
        }
    }

    private fun utf8(bytes: ByteArray): String? =
        try {
            Charsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        } catch (_: CharacterCodingException) {
            null
        }

    private object Invalid : RuntimeException() {
        private fun readResolve(): Any = Invalid

        override fun fillInStackTrace(): Throwable = this
    }

    private class Reader(
        val text: String,
    ) {
        var at = 0

        fun skipSpace() {
            while (at < text.length && text[at] in " \t\r\n") at++
        }

        private fun next(): Char = if (at < text.length) text[at++] else throw Invalid

        private fun expect(word: String) {
            if (!text.startsWith(word, at)) throw Invalid
            at += word.length
        }

        fun value(depth: Int): Any? {
            if (depth > MAX_DEPTH) throw Invalid
            skipSpace()
            if (at >= text.length) throw Invalid
            return when (text[at]) {
                '{' -> obj(depth)
                '[' -> array(depth)
                '"' -> string()
                't' -> true.also { expect("true") }
                'f' -> false.also { expect("false") }
                'n' -> null.also { expect("null") }
                else -> number()
            }
        }

        private fun obj(depth: Int): Map<String, Any?> {
            at++
            val map = LinkedHashMap<String, Any?>()
            skipSpace()
            if (at < text.length && text[at] == '}') return map.also { at++ }
            while (true) {
                skipSpace()
                if (at >= text.length || text[at] != '"') throw Invalid
                val key = string()
                skipSpace()
                if (next() != ':') throw Invalid
                map[key] = value(depth + 1)
                skipSpace()
                when (next()) {
                    ',' -> continue
                    '}' -> return map
                    else -> throw Invalid
                }
            }
        }

        private fun array(depth: Int): List<Any?> {
            at++
            val list = ArrayList<Any?>()
            skipSpace()
            if (at < text.length && text[at] == ']') return list.also { at++ }
            while (true) {
                list.add(value(depth + 1))
                skipSpace()
                when (next()) {
                    ',' -> continue
                    ']' -> return list
                    else -> throw Invalid
                }
            }
        }

        private fun string(): String {
            at++
            val out = StringBuilder()
            while (true) {
                when (val c = next()) {
                    '"' -> return out.toString()
                    '\\' ->
                        when (next()) {
                            '"' -> out.append('"')
                            '\\' -> out.append('\\')
                            '/' -> out.append('/')
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000C')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                if (at + 4 > text.length) throw Invalid
                                val hex = text.substring(at, at + 4)
                                if (!hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) throw Invalid
                                out.append(hex.toInt(16).toChar())
                                at += 4
                            }
                            else -> throw Invalid
                        }
                    else -> if (c < ' ') throw Invalid else out.append(c)
                }
            }
        }

        private fun number(): Number {
            val start = at
            while (at < text.length && text[at] in "+-0123456789.eE") at++
            val raw = text.substring(start, at)
            if (!grammar.matches(raw)) throw Invalid
            // Exactly as written: a Long when it fits, else BigInteger or BigDecimal (never rounded, never Infinity).
            if (raw.none { it in ".eE" }) return raw.toLongOrNull() ?: BigInteger(raw)
            return BigDecimal(raw)
        }
    }

    private val grammar = Regex("""-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?""")
}
