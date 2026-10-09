package io.lsdconsulting.lsd.mono.core.html

/**
 * The only HTML escapers for pages written from Kotlin (#28), one per context:
 *
 * - [text]: element text.
 * - [attribute]: a quoted attribute value (`attr="…"` or `attr='…'`).
 * - JSON inside `<script>` or a `.js` file is written by `jsonString` / `JsonValue.render()`,
 *   which escape `<`, `>`, `&`, U+2028, U+2029, control characters and lone surrogates.
 *
 * Both escapers also replace C0 control characters other than tab, line feed, form feed
 * and carriage return, and lone surrogates, with U+FFFD: the page is written as UTF-8,
 * where a lone surrogate cannot be encoded, and those controls are not allowed in HTML.
 * The report UI has the same escapers for markup it builds (`report/src/lib/escape.ts`).
 */
object Html {
    /** For element text. Escapes `&`, `<` and `>`. Null becomes empty. */
    @JvmStatic
    fun text(value: String?): String = escape(value, quotes = false)

    /** For a quoted attribute value. Escapes `&`, `<`, `>`, `"` and `'`. Null becomes empty. */
    @JvmStatic
    fun attribute(value: String?): String = escape(value, quotes = true)

    /** [value] with each lone surrogate replaced by U+FFFD, so it can be written as UTF-8. */
    @JvmStatic
    fun wellFormed(value: String): String {
        if (value.none { it.isSurrogate() }) return value
        return buildString(value.length) {
            for (i in value.indices) append(if (value[i].isSurrogate() && !paired(value, i)) '\uFFFD' else value[i])
        }
    }

    private fun escape(value: String?, quotes: Boolean): String {
        if (value.isNullOrEmpty()) return ""
        if (value.none { needsWork(it, quotes) }) return value
        return buildString(value.length + 16) {
            for (i in value.indices) {
                val c = value[i]
                when {
                    c == '&' -> append("&amp;")
                    c == '<' -> append("&lt;")
                    c == '>' -> append("&gt;")
                    quotes && c == '"' -> append("&quot;")
                    quotes && c == '\'' -> append("&#39;")
                    c.isSurrogate() && !paired(value, i) -> append('\uFFFD')
                    isDisallowedControl(c) -> append('\uFFFD')
                    else -> append(c)
                }
            }
        }
    }

    private fun needsWork(c: Char, quotes: Boolean): Boolean =
        c == '&' || c == '<' || c == '>' || (quotes && (c == '"' || c == '\'')) || c.isSurrogate() || isDisallowedControl(c)

    private fun isDisallowedControl(c: Char): Boolean =
        c.code < 0x20 && c != '\t' && c != '\n' && c != '\u000C' && c != '\r'

    private fun paired(value: String, i: Int): Boolean {
        val c = value[i]
        return if (c.isHighSurrogate())
            i + 1 < value.length && value[i + 1].isLowSurrogate()
        else
            i > 0 && value[i - 1].isHighSurrogate()
    }
}
