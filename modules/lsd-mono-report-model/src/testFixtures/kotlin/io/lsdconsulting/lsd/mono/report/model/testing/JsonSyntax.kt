package io.lsdconsulting.lsd.mono.report.model.testing

/** A strict JSON (RFC 8259) syntax check, enough to prove the output parses. */
public fun assertValidJson(text: String) {
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
