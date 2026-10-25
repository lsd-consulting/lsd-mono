package io.lsdconsulting.lsd.mono.http4k

import org.http4k.core.Body
import org.http4k.core.HttpMessage
import org.http4k.core.MemoryBody
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.StreamBody
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.io.SequenceInputStream

/** A message with the body it now carries, and that body as the inspector shows it. */
internal class Captured<T : HttpMessage>(
    val message: T,
    val data: Any?,
)

/**
 * Bodies as the inspector shows them, without taking them from the app. A body in memory is
 * read as it is. A stream is read only as far as [LIMIT]: when it ends sooner the app is handed
 * the same bytes in memory, and when it does not, the bytes read and the rest of the stream, so
 * nothing is lost either way. An event stream, a body known to be larger than [LIMIT] and a
 * compressed body are summarised rather than read.
 */
internal object Bodies {
    /** Bodies larger than this are not buffered or shown. */
    const val LIMIT: Int = 256 * 1024

    fun capture(request: Request): Captured<Request> = capture(request, request.body) { request.body(it) }

    fun capture(response: Response): Captured<Response> = capture(response, response.body) { response.body(it) }

    private fun <T : HttpMessage> capture(
        message: T,
        body: Body,
        rebuild: (Body) -> T,
    ): Captured<T> {
        val contentType = message.header("Content-Type")
        val encoding = message.header("Content-Encoding")?.takeUnless { it.isBlank() || it.equals("identity", ignoreCase = true) }
        if (body is MemoryBody) {
            val view = body.payload.duplicate()
            if (view.remaining() > LIMIT) return Captured(message, tooLarge(view.remaining().toLong()))
            return Captured(message, show(ByteArray(view.remaining()).also { view.get(it) }, encoding))
        }
        if (isEventStream(contentType)) return Captured(message, mapOf("stream" to contentType))
        val length = body.length
        if (length == 0L) return Captured(message, null)
        if (length != null && length > LIMIT) return Captured(message, tooLarge(length))
        val input = body.stream
        val head = ByteArrayOutputStreamWithBuffer()
        try {
            head.readFrom(input, LIMIT + 1)
        } catch (e: IOException) {
            // Hand the app what was read and then the same failure, as if it had read it itself.
            return Captured(rebuild(StreamBody(SequenceInputStream(head.input(), Failing(e)), length)), null)
        }
        if (head.size() > LIMIT) {
            return Captured(rebuild(StreamBody(SequenceInputStream(head.input(), input), length)), tooLarge(length))
        }
        input.close()
        val bytes = head.toByteArray()
        return Captured(rebuild(MemoryBody(bytes)), show(bytes, encoding))
    }

    private fun show(
        bytes: ByteArray,
        encoding: String?,
    ): Any? =
        when {
            bytes.isEmpty() -> null
            // A gzip (or other) encoded body is bytes nobody can read on the diagram.
            encoding != null -> mapOf("encoding" to encoding, "size" to bytes.size)
            // JSON as a structure the inspector can fold; anything else as text (or bytes).
            else -> JsonText.parse(bytes) ?: bytes
        }

    private fun tooLarge(size: Long?): Map<String, Any> =
        buildMap {
            put("notShown", "larger than ${LIMIT / 1024} KiB")
            size?.let { put("size", it) }
        }

    fun isEventStream(contentType: String?): Boolean = contentType?.contains("text/event-stream", ignoreCase = true) == true

    private class ByteArrayOutputStreamWithBuffer : java.io.ByteArrayOutputStream() {
        /** Read [input] until it ends or [max] bytes have been read. */
        fun readFrom(
            input: InputStream,
            max: Int,
        ) {
            val chunk = ByteArray(8192)
            while (count < max) {
                val n = input.read(chunk, 0, minOf(chunk.size, max - count))
                if (n < 0) return
                write(chunk, 0, n)
            }
        }

        fun input(): InputStream = ByteArrayInputStream(buf, 0, count)
    }

    private class Failing(
        private val failure: IOException,
    ) : InputStream() {
        override fun read(): Int = throw failure
    }
}
