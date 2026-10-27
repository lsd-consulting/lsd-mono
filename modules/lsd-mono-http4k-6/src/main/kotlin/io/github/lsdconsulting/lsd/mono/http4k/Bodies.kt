package io.github.lsdconsulting.lsd.mono.http4k

import org.http4k.core.Body
import org.http4k.core.HttpMessage
import org.http4k.core.MemoryBody
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.StreamBody
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.SequenceInputStream
import java.util.concurrent.atomic.AtomicBoolean

/** A message with the body it now carries, and that body as the inspector shows it. */
internal class Captured<T : HttpMessage>(
    val message: T,
    val data: Any?,
)

/**
 * Bodies as the inspector shows them, without taking them from the app or holding them back.
 *
 * - A body in memory is read as it is.
 * - A stream of known length up to [LIMIT] is read (it is no more than it says), and the app is
 *   handed the same bytes in memory.
 * - A response stream of unknown length is passed on at once and copied as it is read, up to
 *   [LIMIT]: the reply is shown when the reader reaches its end or closes it ([capture] with a
 *   callback), so a stream that only ends once the caller reads it is never held up. One closed
 *   before its end is shown with a note of how far it was read.
 * - A request stream of unknown length is passed on unread and shown as a note, because the
 *   request is drawn before the app reads it.
 * - An event stream, a body known to be larger than [LIMIT] and a compressed body are
 *   summarised rather than read.
 */
internal object Bodies {
    /** Bodies larger than this are not buffered or shown. */
    const val LIMIT: Int = 256 * 1024

    /** The request as the app will see it, and its body as drawn. Never waits on the sender. */
    fun capture(request: Request): Captured<Request> {
        val body = request.body
        val summary = summary(request, body)
        if (summary != null) return Captured(request, summary.value)
        if (body.length == null) return Captured(request, unknownLength(request))
        return readKnown(request, body) { request.body(it) }
    }

    /**
     * The response to hand on, now; [shown] gets its body as drawn, now or (for a stream of
     * unknown length) once the reader has reached its end or closed it. [shown] is called at most
     * once, and exactly once unless the stream is never read to its end or closed.
     */
    fun capture(
        response: Response,
        shown: (Any?) -> Unit,
    ): Response {
        val once = Once(shown)
        return try {
            val body = response.body
            val summary = summary(response, body)
            when {
                summary != null -> response.also { once(summary.value) }
                body.length == null -> response.body(StreamBody(Tee(body.stream, response.header("Content-Type"), once), null))
                else -> readKnown(response, body) { response.body(it) }.also { once(it.data) }.message
            }
        } catch (e: VirtualMachineError) {
            throw e
        } catch (e: Throwable) {
            Calls.warnOnce(e)
            once(null)
            response
        }
    }

    private class Summary(
        val value: Any?,
    )

    /** What is shown without reading a stream: null when the body has to be read. */
    private fun summary(
        message: HttpMessage,
        body: Body,
    ): Summary? {
        val contentType = message.header("Content-Type")
        val encoding = encoding(message)
        if (body is MemoryBody) {
            val view = body.payload.duplicate()
            if (view.remaining() > LIMIT) return Summary(tooLarge(view.remaining().toLong()))
            return Summary(show(ByteArray(view.remaining()).also { view.get(it) }, encoding, contentType))
        }
        if (isEventStream(contentType)) return Summary(mapOf("stream" to contentType))
        val length = body.length
        return when {
            length == 0L -> Summary(null)
            length != null && length > LIMIT -> Summary(tooLarge(length))
            // A gzip (or other) encoded body is bytes nobody can read on the diagram: never read it.
            encoding != null -> Summary(
                buildMap {
                    put("encoding", encoding)
                    length?.let { put("size", it) }
                },
            )
            else -> null
        }
    }

    private fun <T : HttpMessage> readKnown(
        message: T,
        body: Body,
        rebuild: (Body) -> T,
    ): Captured<T> {
        val input = body.stream
        val head = Head()
        try {
            head.readFrom(input, LIMIT + 1)
        } catch (e: IOException) {
            // Hand the app what was read and then the same failure, as if it had read it itself.
            return Captured(rebuild(StreamBody(SequenceInputStream(head.input(), Failing(e)), body.length)), null)
        }
        if (head.size() > LIMIT) {
            // Longer than it said: hand on everything, show none of it.
            return Captured(rebuild(StreamBody(SequenceInputStream(head.input(), input), body.length)), tooLarge(body.length))
        }
        input.close()
        val bytes = head.toByteArray()
        return Captured(rebuild(MemoryBody(bytes)), show(bytes, null, message.header("Content-Type")))
    }

    private fun encoding(message: HttpMessage): String? =
        message.header("Content-Encoding")?.takeUnless { it.isBlank() || it.equals("identity", ignoreCase = true) }

    private fun unknownLength(message: HttpMessage): Map<String, Any> =
        buildMap {
            put("notShown", "a stream of unknown length, passed on unread")
            message.header("Content-Type")?.let { put("contentType", it) }
        }

    private fun show(
        bytes: ByteArray,
        encoding: String?,
        contentType: String?,
    ): Any? =
        when {
            bytes.isEmpty() -> null
            encoding != null -> mapOf("encoding" to encoding, "size" to bytes.size)
            // JSON as a structure the inspector can fold; anything else as text (or bytes).
            JsonText.isJson(contentType) -> JsonText.parse(bytes) ?: bytes
            else -> bytes
        }

    private fun tooLarge(size: Long?): Map<String, Any> =
        buildMap {
            put("notShown", "larger than ${LIMIT / 1024} KiB")
            size?.let { put("size", it) }
        }

    fun isEventStream(contentType: String?): Boolean = contentType?.contains("text/event-stream", ignoreCase = true) == true

    /** Calls [shown] the first time only. */
    private class Once(
        private val shown: (Any?) -> Unit,
    ) : (Any?) -> Unit {
        private val done = AtomicBoolean()

        override fun invoke(data: Any?) {
            if (done.compareAndSet(false, true)) Calls.guarded(Unit) { shown(data) }
        }
    }

    /**
     * The stream the reader gets: every byte as it comes, with the first [LIMIT] kept. At its end,
     * on close, or when it fails, what was kept is shown, once.
     */
    private class Tee(
        private val input: InputStream,
        private val contentType: String?,
        private val shown: (Any?) -> Unit,
    ) : InputStream() {
        private val kept = ByteArrayOutputStream()
        private var total = 0L

        private fun keep(
            bytes: ByteArray,
            off: Int,
            n: Int,
        ) {
            total += n
            val room = LIMIT - kept.size()
            if (room > 0) kept.write(bytes, off, minOf(room, n))
        }

        /**
         * Shows what was kept. A stream closed before its end is marked as such, with what was read
         * if it came to no more than [LIMIT], so a partial body is never taken for the whole one.
         */
        private fun finish(closedEarly: Boolean = false) =
            shown(
                Calls.guarded(null) {
                    when {
                        closedEarly -> closedAt()
                        total > LIMIT -> tooLarge(total)
                        else -> show(kept.toByteArray(), null, contentType)
                    }
                },
            )

        private fun closedAt(): Map<String, Any> =
            buildMap {
                put("note", "closed after $total bytes, not read to the end")
                if (total <= LIMIT) show(kept.toByteArray(), null, contentType)?.let { put("body", it) }
            }

        private inline fun <T> reading(block: () -> T): T =
            try {
                block()
            } catch (e: IOException) {
                finish()
                throw e
            }

        override fun read(): Int =
            reading {
                val b = input.read()
                if (b < 0) finish() else keep(byteArrayOf(b.toByte()), 0, 1)
                b
            }

        override fun read(
            b: ByteArray,
            off: Int,
            len: Int,
        ): Int =
            reading {
                val n = input.read(b, off, len)
                if (n < 0)
                    finish()
                else if (n > 0)
                    keep(b, off, n)
                n
            }

        override fun available(): Int = input.available()

        override fun close() {
            try {
                input.close()
            } finally {
                finish(closedEarly = true)
            }
        }
    }

    private class Head : ByteArrayOutputStream() {
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
