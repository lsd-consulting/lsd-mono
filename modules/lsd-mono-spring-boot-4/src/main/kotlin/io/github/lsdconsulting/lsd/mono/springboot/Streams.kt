package io.github.lsdconsulting.lsd.mono.springboot

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

/** What a streamed body looks like in the inspector: a summary, never the stream itself. */
internal object Streams {
    /** How many server-sent events are shown; the rest are only counted. */
    const val EVENTS_SHOWN: Int = 5

    /** The longest field (an event's `data`, say) kept as it was; longer is cut short. */
    const val FIELD_LIMIT: Int = 4 * 1024

    fun isEventStream(contentType: String?): Boolean = contentType?.contains("text/event-stream", ignoreCase = true) == true

    fun isMultipart(contentType: String?): Boolean = contentType?.trimStart()?.startsWith("multipart/", ignoreCase = true) == true

    /** One part: `{name, filename, contentType, size}`, leaving out what it does not have. */
    fun part(
        name: String?,
        filename: String?,
        contentType: String?,
        size: Long,
    ): Map<String, Any> =
        buildMap {
            name?.let { put("name", it) }
            filename?.let { put("filename", it) }
            contentType?.let { put("contentType", it) }
            put("size", size)
        }

    fun parts(
        parts: List<Map<String, Any>>,
        truncated: Boolean,
    ): Map<String, Any> =
        buildMap {
            put("parts", parts)
            if (truncated) put("truncated", true)
        }
}

/**
 * Counts the server-sent events in a stream as its bytes go past, and keeps the first few
 * ([Streams.EVENTS_SHOWN]) with their `event`, `id` and `data` (JSON data as a tree). It holds no
 * more than one line of the stream, however long the stream runs. Safe to feed from any thread.
 */
internal class SseTap(
    private val shown: Int = Streams.EVENTS_SHOWN,
) {
    private val line = ByteArrayOutputStream()
    private var lineCut = false
    private var lastWasCr = false
    private var fields = linkedMapOf<String, String>()
    private val events = mutableListOf<Map<String, Any?>>()
    private var count = 0

    fun copy(
        bytes: ByteArray,
        offset: Int = 0,
        length: Int = bytes.size - offset,
    ) = synchronized(this) {
        for (i in offset until offset + length) {
            when (val b = bytes[i]) {
                '\r'.code.toByte() -> {
                    endLine()
                    lastWasCr = true
                    continue
                }
                '\n'.code.toByte() -> if (!lastWasCr) endLine()
                else ->
                    if (line.size() < Streams.FIELD_LIMIT) {
                        line.write(b.toInt())
                    } else {
                        lineCut = true
                    }
            }
            lastWasCr = false
        }
    }

    fun copy(buffer: org.springframework.core.io.buffer.DataBuffer) {
        buffer.readableByteBuffers().use { buffers ->
            for (view in buffers) {
                val chunk = ByteArray(view.remaining())
                view.get(chunk)
                copy(chunk)
            }
        }
    }

    /**
     * `{events: 12, first: [...], truncated: true}`: how many events went past, and the first few.
     * [cut] says the stream was only seen in part, so there were more.
     */
    fun summary(cut: Boolean = false): Map<String, Any> =
        synchronized(this) {
            buildMap {
                put("events", count)
                put("first", events.toList())
                if (cut || count > events.size) put("truncated", true)
            }
        }

    private fun endLine() {
        val text = line.toString(StandardCharsets.UTF_8)
        val cut = lineCut
        line.reset()
        lineCut = false
        if (text.isEmpty()) {
            dispatch()
            return
        }
        if (text.startsWith(":")) return
        if (count >= shown) {
            // Past the events shown only the lines that end events matter: remember there is one.
            fields["…"] = ""
            return
        }
        val colon = text.indexOf(':')
        val name = if (colon < 0) text else text.substring(0, colon)
        var value = if (colon < 0) "" else text.substring(colon + 1).removePrefix(" ")
        if (cut) value += "…"
        fields[name] = if (name == "data" && name in fields) fields[name] + "\n" + value else value
    }

    private fun dispatch() {
        if (fields.isEmpty()) return
        if (count < shown) {
            events +=
                buildMap {
                    fields["event"]?.let { put("event", it) }
                    fields["id"]?.let { put("id", it) }
                    fields["data"]?.let { put("data", data(it)) }
                }
        }
        count++
        fields = linkedMapOf()
    }

    private fun data(text: String): Any? {
        val trimmed = text.trimStart()
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            val parsed = Bodies.read(text.toByteArray(StandardCharsets.UTF_8), "application/json")
            if (parsed !is ByteArray) return parsed
        }
        return text
    }
}

/**
 * The parts of a multipart body (`{parts: [{name, filename, contentType, size}]}`), read from
 * its bytes; the contents of the parts are left out. Given only the head of a larger body, it
 * lists the parts that head holds and says it is truncated.
 */
internal object Multipart {
    fun summary(
        bytes: ByteArray,
        contentType: String,
        truncated: Boolean = false,
    ): Map<String, Any>? {
        val boundary = boundary(contentType) ?: return null
        val delimiter = "--$boundary".toByteArray(StandardCharsets.ISO_8859_1)
        val parts = mutableListOf<Map<String, Any>>()
        var at = indexOf(bytes, delimiter, 0)
        var cut = truncated
        while (at >= 0) {
            var start = at + delimiter.size
            if (start + 1 < bytes.size && bytes[start] == '-'.code.toByte() && bytes[start + 1] == '-'.code.toByte()) break
            start = skipLineEnd(bytes, start)
            val headersEnd = indexOf(bytes, HEADERS_END, start)
            if (headersEnd < 0) {
                cut = true
                break
            }
            val headers = String(bytes, start, headersEnd - start, StandardCharsets.UTF_8).split("\r\n")
            val bodyStart = headersEnd + HEADERS_END.size
            val next = indexOf(bytes, "\r\n".toByteArray() + delimiter, bodyStart)
            val disposition = header(headers, "content-disposition")
            val size = if (next < 0) bytes.size - bodyStart else next - bodyStart
            parts += Streams.part(param(disposition, "name"), param(disposition, "filename"), header(headers, "content-type"), size.toLong())
            if (next < 0) {
                cut = true
                break
            }
            at = next + 2
        }
        return Streams.parts(parts, cut)
    }

    private val HEADERS_END = "\r\n\r\n".toByteArray()

    private fun boundary(contentType: String): String? =
        contentType
            .split(';')
            .map { it.trim() }
            .firstOrNull { it.startsWith("boundary=", ignoreCase = true) }
            ?.substringAfter('=')
            ?.trim('"')
            ?.takeIf { it.isNotEmpty() }

    private fun header(
        lines: List<String>,
        name: String,
    ): String? =
        lines
            .firstOrNull { it.substringBefore(':').trim().equals(name, ignoreCase = true) }
            ?.substringAfter(':')
            ?.trim()

    private fun param(
        value: String?,
        name: String,
    ): String? =
        value
            ?.split(';')
            ?.map { it.trim() }
            ?.firstOrNull { it.substringBefore('=').trim().equals(name, ignoreCase = true) }
            ?.substringAfter('=')
            ?.trim()
            ?.trim('"')

    private fun skipLineEnd(
        bytes: ByteArray,
        from: Int,
    ): Int {
        var i = from
        if (i < bytes.size && bytes[i] == '\r'.code.toByte()) i++
        if (i < bytes.size && bytes[i] == '\n'.code.toByte()) i++
        return i
    }

    private fun indexOf(
        bytes: ByteArray,
        target: ByteArray,
        from: Int,
    ): Int {
        if (target.isEmpty()) return from
        outer@ for (i in from..bytes.size - target.size) {
            for (j in target.indices) if (bytes[i + j] != target[j]) continue@outer
            return i
        }
        return -1
    }
}
