package io.github.lsdconsulting.lsd.mono.ktor

import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.util.AttributeKey
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.ByteWriteChannel
import io.ktor.utils.io.readAvailable
import io.ktor.utils.io.writeFully
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException

/**
 * Bodies as the inspector shows them, without taking them from the app or holding them back.
 *
 * - A body in memory is read as it is.
 * - A stream of known length up to [LIMIT] is read (it is no more than it says), and the app is
 *   handed the same bytes.
 * - A response stream of unknown length is passed on at once and copied as it goes, up to
 *   [LIMIT]: the reply is shown when it ends or is closed, so a stream that only ends once the
 *   caller reads it is never held up. One closed before its end is shown with a note of how far
 *   it got.
 * - A request stream of unknown length is passed on unread and shown as a note, because the
 *   request is drawn before the app reads it.
 * - An event stream, a body known to be larger than [LIMIT] and a compressed body are
 *   summarised rather than read.
 */
internal object Bodies {
    /** Bodies larger than this are not buffered or shown. */
    const val LIMIT: Int = 256 * 1024

    /** What is shown without reading a body, or null when it has to be read. */
    class Summary(
        val value: Any?,
    )

    fun summary(
        contentType: String?,
        encoding: String?,
        length: Long?,
    ): Summary? =
        when {
            isEventStream(contentType) -> Summary(mapOf("stream" to contentType))
            length == 0L -> Summary(null)
            length != null && length > LIMIT -> Summary(tooLarge(length))
            // A gzip (or other) encoded body is bytes nobody can read on the diagram: never read it.
            encoding != null ->
                Summary(
                    buildMap {
                        put("encoding", encoding)
                        length?.let { put("size", it) }
                    },
                )
            else -> null
        }

    /**
     * The first [max] bytes [source] has (all of it, for a body no longer than it said), or the
     * failure that stopped it.
     */
    suspend fun readHead(
        source: ByteReadChannel,
        max: Int,
    ): Result<ByteArray> {
        val head = ByteArrayOutputStream()
        val chunk = ByteArray(8192)
        return try {
            while (head.size() < max) {
                val n = source.readAvailable(chunk, 0, minOf(chunk.size, max - head.size()))
                if (n < 0) break
                head.write(chunk, 0, n)
            }
            source.closedCause?.let { Result.failure(it) } ?: Result.success(head.toByteArray())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Result.failure(e)
        }
    }

    /**
     * The reply as the app hands it on, now, or null to keep [content]; [shown] gets its body as
     * drawn, now or (for a stream) once it has been written to its end or closed. [shown] is
     * called at most once, and exactly once unless the stream is never written.
     */
    fun respond(
        content: OutgoingContent,
        encoding: String?,
        shown: (Any?) -> Unit,
    ): OutgoingContent? {
        val once = Once(shown)
        return try {
            replace(content, encoding, once)
        } catch (e: VirtualMachineError) {
            throw e
        } catch (e: Throwable) {
            Calls.warnOnce(e)
            once(null)
            null
        }
    }

    private fun replace(
        content: OutgoingContent,
        encoding: String?,
        once: Once,
    ): OutgoingContent? {
        val contentType = content.contentType?.toString()
        when (content) {
            is OutgoingContent.ByteArrayContent -> {
                val bytes = content.bytes()
                once(if (bytes.size > LIMIT) tooLarge(bytes.size.toLong()) else show(bytes, encoding, contentType))
                return null
            }
            is OutgoingContent.ContentWrapper -> return replace(content.delegate(), encoding, once)?.let { content.copy(it) }
            is OutgoingContent.ReadChannelContent, is OutgoingContent.WriteChannelContent -> {
                val summary = summary(contentType, encoding, content.contentLength)
                if (summary == null) return TeeContent(content, Keeper(contentType, once))
                once(summary.value)
                return null
            }
            else -> {
                once(null)
                return null
            }
        }
    }

    fun encoding(headers: Headers): String? = encoding(headers[HttpHeaders.ContentEncoding])

    fun encoding(value: String?): String? = value?.takeUnless { it.isBlank() || it.equals("identity", ignoreCase = true) }

    fun unknownLength(contentType: String?): Map<String, Any> =
        buildMap {
            put("notShown", "a stream of unknown length, passed on unread")
            contentType?.let { put("contentType", it) }
        }

    fun show(
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

    fun tooLarge(size: Long?): Map<String, Any> =
        buildMap {
            put("notShown", "larger than ${LIMIT / 1024} KiB")
            size?.let { put("size", it) }
        }

    fun isEventStream(contentType: String?): Boolean = contentType?.contains("text/event-stream", ignoreCase = true) == true

    /** Calls [shown] the first time only. */
    class Once(
        private val shown: (Any?) -> Unit,
    ) : (Any?) -> Unit {
        private val done = AtomicBoolean()

        override fun invoke(data: Any?) {
            if (done.compareAndSet(false, true)) Calls.guarded(Unit) { shown(data) }
        }
    }

    /** Keeps the first [LIMIT] bytes that pass, and shows them, once, when the stream ends or is closed. */
    class Keeper(
        private val contentType: String?,
        private val shown: (Any?) -> Unit,
    ) {
        private val kept = ByteArrayOutputStream()
        private var total = 0L

        fun keep(
            bytes: ByteArray,
            n: Int,
        ) {
            total += n
            val room = LIMIT - kept.size()
            if (room > 0) kept.write(bytes, 0, minOf(room, n))
        }

        /**
         * Shows what was kept. A stream closed before its end is marked as such, with what passed
         * if it came to no more than [LIMIT], so a partial body is never taken for the whole one.
         */
        fun finish(closedEarly: Boolean) =
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

        /** Copies [source] to [sink] as it comes, flushing each chunk so nothing is held back. */
        suspend fun copy(
            source: ByteReadChannel,
            sink: ByteWriteChannel,
        ) {
            val chunk = ByteArray(8192)
            try {
                while (true) {
                    val n = source.readAvailable(chunk)
                    if (n < 0) break
                    keep(chunk, n)
                    sink.writeFully(chunk, 0, n)
                    sink.flush()
                }
                source.closedCause?.let { throw it }
            } catch (e: Throwable) {
                source.cancel(e)
                finish(closedEarly = true)
                throw e
            }
            finish(closedEarly = false)
        }
    }

    /** [original], written as it would be, with what passes kept for the diagram. */
    private class TeeContent(
        private val original: OutgoingContent,
        private val keeper: Keeper,
    ) : OutgoingContent.WriteChannelContent() {
        override val contentType: ContentType? get() = original.contentType
        override val contentLength: Long? get() = original.contentLength
        override val status: HttpStatusCode? get() = original.status
        override val headers: Headers get() = original.headers

        override fun <T : Any> getProperty(key: AttributeKey<T>): T? = original.getProperty(key)

        override fun <T : Any> setProperty(
            key: AttributeKey<T>,
            value: T?,
        ) = original.setProperty(key, value)

        override fun trailers(): Headers? = original.trailers()

        override suspend fun writeTo(channel: ByteWriteChannel) {
            when (original) {
                is ReadChannelContent -> keeper.copy(original.readFrom(), channel)
                else ->
                    coroutineScope {
                        val pipe = io.ktor.utils.io
                            .ByteChannel()
                        launch {
                            try {
                                (original as WriteChannelContent).writeTo(pipe)
                                pipe.flushAndClose()
                            } catch (e: Throwable) {
                                pipe.cancel(e)
                            }
                        }
                        keeper.copy(pipe, channel)
                    }
            }
        }
    }
}
