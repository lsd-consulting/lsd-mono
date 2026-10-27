package io.lsdconsulting.lsd.mono.ktor

import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.ByteArrayContent
import io.ktor.http.content.OutgoingContent
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import io.ktor.util.AttributeKey
import io.ktor.utils.io.ByteChannel
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.ByteWriteChannel
import io.ktor.utils.io.readRemaining
import io.ktor.utils.io.writeFully
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.io.readByteArray
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

/** Bodies are shown without taking a byte from the app, or holding one back. */
class BodiesTest {
    private fun big(size: Int) = ByteArray(size) { (it % 251).toByte() }

    private val json = ContentType.Application.Json

    /** The reply handed on and what was shown for it, recorded every time it is. */
    private class Shown(
        content: OutgoingContent,
        encoding: String? = null,
    ) {
        val calls = mutableListOf<Any?>()
        val passed: OutgoingContent? = Bodies.respond(content, encoding) { calls += it }
        val data: Any? get() = calls.single()

        /** What the caller gets: every byte [passed] writes. */
        fun written(): ByteArray =
            runBlocking {
                val channel = ByteChannel()
                launch {
                    (passed as OutgoingContent.WriteChannelContent).writeTo(channel)
                    channel.flushAndClose()
                }
                channel.readRemaining().readByteArray()
            }
    }

    private class Streamed(
        private val bytes: ByteArray,
        override val contentType: ContentType? = null,
        override val contentLength: Long? = null,
    ) : OutgoingContent.ReadChannelContent() {
        var read = false

        override fun readFrom(): ByteReadChannel = ByteReadChannel(bytes).also { read = true }
    }

    private class Written(
        private val write: suspend (ByteWriteChannel) -> Unit,
        override val contentType: ContentType? = null,
    ) : OutgoingContent.WriteChannelContent() {
        override suspend fun writeTo(channel: ByteWriteChannel) = write(channel)
    }

    @Test
    fun `a body in memory is shown and left as it is`() {
        val shown = Shown(TextContent("""{"a":1}""", json))
        assertNull(shown.passed, "the app's own content goes out")
        assertEquals(mapOf("a" to 1L), shown.data, "JSON is shown as a structure")
        assertNull(Shown(ByteArrayContent(ByteArray(0))).data, "an empty body is no body")
    }

    @Test
    fun `only a JSON content type is read as JSON`() {
        assertEquals(listOf(1L, 2L), Shown(TextContent("[1,2]", ContentType.parse("application/problem+json"))).data)
        assertEquals("[1,2]", String(Shown(TextContent("[1,2]", ContentType.Text.Plain)).data as ByteArray))
        assertEquals("[1,2]", String(Shown(ByteArrayContent("[1,2]".toByteArray())).data as ByteArray))
    }

    @Test
    fun `a large body in memory, a compressed one and a stream known to be long are summarised`() {
        assertEquals(mapOf("notShown" to "larger than 256 KiB", "size" to (Bodies.LIMIT + 1).toLong()), Shown(ByteArrayContent(big(Bodies.LIMIT + 1))).data)
        assertEquals(mapOf("encoding" to "gzip", "size" to 15), Shown(TextContent("not really gzip", ContentType.Text.Plain), "gzip").data)
        val long = Streamed(big(10), contentLength = Bodies.LIMIT + 1L)
        val shown = Shown(long)
        assertNull(shown.passed)
        assertEquals(mapOf("notShown" to "larger than 256 KiB", "size" to (Bodies.LIMIT + 1).toLong()), shown.data)
        assertEquals(false, long.read)
        val events = Streamed("data: 1\n\n".toByteArray(), ContentType.Text.EventStream)
        assertEquals(mapOf("stream" to "text/event-stream"), Shown(events).data)
        assertEquals(false, events.read)
        assertEquals(mapOf("encoding" to "br"), Shown(Streamed(big(10)), "br").data)
        assertNull(Shown(Streamed(big(10), contentLength = 0L)).data)
        assertNull(Shown(object : OutgoingContent.NoContent() {}).data)
    }

    @Test
    fun `a stream of unknown length is passed on as it is and shown once written`() {
        val exact = big(Bodies.LIMIT)
        val teed = Shown(Streamed(exact))
        assertTrue(teed.calls.isEmpty(), "nothing is shown before it is written")
        assertArrayEquals(exact, teed.written())
        assertArrayEquals(exact, teed.data as ByteArray)

        val over = big(Bodies.LIMIT + 1)
        val overTeed = Shown(Written({ it.writeFully(over) }))
        assertArrayEquals(over, overTeed.written())
        assertEquals(mapOf("notShown" to "larger than 256 KiB", "size" to (Bodies.LIMIT + 1).toLong()), overTeed.data)

        val parsed = Shown(Written({ it.writeFully("""{"ok":true}""".toByteArray()) }, json))
        assertEquals("""{"ok":true}""", String(parsed.written()))
        assertEquals(mapOf("ok" to true), parsed.data)
    }

    @Test
    fun `the stream handed on keeps the original's type, length, status, headers and properties`() {
        val key = AttributeKey<String>("k")
        val original =
            object : OutgoingContent.ReadChannelContent() {
                override val contentType = ContentType.Text.Plain
                override val status = HttpStatusCode.Accepted
                override val headers = headersOf("X-Kind", "stream")

                override fun readFrom(): ByteReadChannel = ByteReadChannel("hello")

                override fun trailers(): Headers = headersOf("X-Trailer", "t")
            }
        val passed = Shown(original).passed!!
        assertEquals(ContentType.Text.Plain, passed.contentType)
        assertNull(passed.contentLength)
        assertEquals(HttpStatusCode.Accepted, passed.status)
        assertEquals("stream", passed.headers["X-Kind"])
        assertEquals("t", passed.trailers()?.get("X-Trailer"))
        passed.setProperty(key, "v")
        assertEquals("v", original.getProperty(key))
        assertEquals("v", passed.getProperty(key))
    }

    @Test
    fun `a wrapped stream is teed inside its wrapper`() {
        val inner = Streamed("hello".toByteArray())
        val wrapper =
            object : OutgoingContent.ContentWrapper(inner) {
                override fun copy(delegate: OutgoingContent): OutgoingContent.ContentWrapper = Wrapped(delegate)
            }
        val shown = Shown(wrapper)
        val passed = shown.passed as Wrapped
        val bytes =
            runBlocking {
                val channel = ByteChannel()
                launch {
                    (passed.delegate() as OutgoingContent.WriteChannelContent).writeTo(channel)
                    channel.flushAndClose()
                }
                channel.readRemaining().readByteArray()
            }
        assertEquals("hello", String(bytes))
        assertEquals("hello", String(shown.data as ByteArray))
        val inMemory = Shown(object : OutgoingContent.ContentWrapper(TextContent("hi", ContentType.Text.Plain)) {
            override fun copy(delegate: OutgoingContent) = Wrapped(delegate)
        })
        assertNull(inMemory.passed)
        assertEquals("hi", String(inMemory.data as ByteArray))
    }

    private class Wrapped(
        delegate: OutgoingContent,
    ) : OutgoingContent.ContentWrapper(delegate) {
        override fun copy(delegate: OutgoingContent) = Wrapped(delegate)
    }

    @Test
    fun `a stream that fails part way fails the caller, and is shown as closed early`() {
        val failing =
            Shown(
                Written({
                    it.writeFully("xxx".toByteArray())
                    it.flush()
                    throw IOException("reset")
                }),
            )
        assertThrows(Throwable::class.java) {
            runBlocking {
                val channel = ByteChannel()
                (failing.passed as OutgoingContent.WriteChannelContent).writeTo(channel)
            }
        }
        // As far as the copy got before the failure reached it: the bytes written may go with it.
        val note = (failing.data as Map<*, *>)["note"] as String
        assertTrue(note.startsWith("closed after ") && note.endsWith(" bytes, not read to the end"), note)
    }

    @Test
    fun `a caller that goes away early is shown as a note of how far it got`() {
        val long = Shown(Streamed(big(Bodies.LIMIT + 10)))
        runBlocking {
            val channel = ByteChannel()
            channel.cancel(IOException("gone"))
            runCatching { (long.passed as OutgoingContent.WriteChannelContent).writeTo(channel) }
        }
        val note = (long.data as Map<*, *>)
        assertTrue((note["note"] as String).startsWith("closed after "), note.toString())
    }

    @Test
    fun `a capture that fails still shows a reply, once`() {
        val broken =
            object : OutgoingContent.ReadChannelContent() {
                override val contentType: ContentType get() = throw IllegalStateException("gone")

                override fun readFrom(): ByteReadChannel = ByteReadChannel.Empty
            }
        val shown = Shown(broken)
        assertNull(shown.passed)
        assertEquals(listOf<Any?>(null), shown.calls)
    }

    @Test
    fun `the head of a channel is read up to its length, or the failure that stopped it`() {
        runBlocking {
            assertEquals("hel", String(Bodies.readHead(ByteReadChannel("hello"), 3).getOrThrow()))
            assertEquals("hello", String(Bodies.readHead(ByteReadChannel("hello"), 10).getOrThrow()))
            val failed = ByteChannel().also { it.cancel(IOException("reset")) }
            assertNotNull(Bodies.readHead(failed, 10).exceptionOrNull())
        }
    }

    @Test
    fun `encodings and summaries`() {
        assertNull(Bodies.encoding("identity"))
        assertNull(Bodies.encoding(" "))
        assertNull(Bodies.encoding(null as String?))
        assertEquals("gzip", Bodies.encoding(headersOf(HttpHeaders.ContentEncoding, "gzip")))
        assertNull(Bodies.summary("text/plain", null, 10L))
        assertEquals(mapOf("encoding" to "gzip", "size" to 10L), Bodies.summary(null, "gzip", 10L)?.value)
        assertEquals(mapOf("notShown" to "a stream of unknown length, passed on unread"), Bodies.unknownLength(null))
        assertEquals(mapOf("encoding" to "gzip", "size" to 2), Bodies.show(byteArrayOf(1, 2), "gzip", null))
        val once = mutableListOf<Any?>()
        val shown = Bodies.Once { once += it }
        shown(1)
        shown(2)
        assertEquals(listOf<Any?>(1), once)
        assertSame(null, Bodies.show(ByteArray(0), null, null))
    }
}
