package io.github.lsdconsulting.lsd.mono.jvm.live

/**
 * Reads JSON the report writer wrote as raw text slices, so a live frame carries a scenario's
 * values exactly as the written report encodes them, and nothing is encoded twice. It reads well
 * formed JSON only (the writer's, or a server reply); it does not validate.
 */
internal object LiveJson {
    /** [text] without the whitespace outside strings. */
    fun compact(text: String): String {
        val out = StringBuilder(text.length)
        var inString = false
        var escaped = false
        for (c in text) {
            when {
                inString -> {
                    out.append(c)
                    when {
                        escaped -> escaped = false
                        c == '\\' -> escaped = true
                        c == '"' -> inString = false
                    }
                }
                c == '"' -> {
                    inString = true
                    out.append(c)
                }
                !c.isWhitespace() -> out.append(c)
            }
        }
        return out.toString()
    }

    /** A compact object's members, by key, each as its compact value text. Keys are plain names. */
    fun members(obj: String): Map<String, String> {
        val members = LinkedHashMap<String, String>()
        require(obj.startsWith('{')) { "not an object" }
        var i = 1
        while (i < obj.length && obj[i] != '}') {
            val keyEnd = end(obj, i)
            val key = obj.substring(i + 1, keyEnd - 1)
            val valueEnd = end(obj, keyEnd + 1)
            members[key] = obj.substring(keyEnd + 1, valueEnd)
            i = if (valueEnd < obj.length && obj[valueEnd] == ',') valueEnd + 1 else valueEnd
        }
        return members
    }

    /** A compact array's items, each as its compact value text. */
    fun items(array: String): List<String> {
        val items = ArrayList<String>()
        require(array.startsWith('[')) { "not an array" }
        var i = 1
        while (i < array.length && array[i] != ']') {
            val itemEnd = end(array, i)
            items.add(array.substring(i, itemEnd))
            i = if (itemEnd < array.length && array[itemEnd] == ',') itemEnd + 1 else itemEnd
        }
        return items
    }

    /** The index just after the value that starts at [start] in compact [text]. */
    private fun end(
        text: String,
        start: Int,
    ): Int {
        var i = start
        var depth = 0
        var inString = false
        var escaped = false
        while (i < text.length) {
            val c = text[i]
            if (inString) {
                when {
                    escaped -> escaped = false
                    c == '\\' -> escaped = true
                    c == '"' -> {
                        inString = false
                        if (depth == 0) return i + 1
                    }
                }
            } else {
                when (c) {
                    '"' -> inString = true
                    '{', '[' -> depth++
                    '}', ']' -> {
                        if (depth == 0) return i
                        depth--
                        if (depth == 0) return i + 1
                    }
                    ',' -> if (depth == 0) return i
                }
            }
            i++
        }
        return i
    }
}
