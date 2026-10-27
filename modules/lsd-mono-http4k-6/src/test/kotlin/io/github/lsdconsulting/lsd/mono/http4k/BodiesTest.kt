package io.github.lsdconsulting.lsd.mono.http4k

import org.http4k.core.Body
import org.http4k.core.Method.POST
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.Status.Companion.OK
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

/** Bodies are shown without taking a byte from the app, or holding one back. */
class BodiesTest {
    private fun big(size: Int) = ByteArray(size) { (it % 251).toByte() }

    private val json = "application/json"

    /** A stream that records whether anyone read or closed it. */
    private class Watched(
        bytes: ByteArray,
    ) : ByteArrayInputStream(bytes) {
        var read = false
        var closed = false

        override fun read(
            b: ByteArray,
            off: Int,
            len: Int,
        ): Int = super.read(b, off, len).also { read = true }

        override fun read(): Int = super.read().also { read = true }

        override fun close() {
            closed = true
        }
    }

    /** The response handed on and what was shown for it, recorded every time it is. */
    private class Shown(
        response: Response,
    ) {
        val calls = mutableListOf<Any?>()
        val passed: Response = Bodies.capture(response) { calls += it }
        val data: Any? get() = calls.single()
    }

    @Test
    fun `a body in memory is shown and left as it is`() {
        val request = Request(POST, "/").header("Content-Type", json).body("""{"a":1}""")
        val captured = Bodies.capture(request)
        assertSame(request, captured.message)
        assertEquals(mapOf("a" to 1L), captured.data, "JSON is shown as a structure")
        assertEquals("""{"a":1}""", captured.message.bodyString(), "still readable")
        assertNull(Bodies.capture(Request(POST, "/")).data, "an empty body is no body")
    }

    @Test
    fun `only a JSON content type is read as JSON`() {
        assertEquals(listOf(1L, 2L), Bodies.capture(Request(POST, "/").header("Content-Type", "application/problem+json").body("[1,2]")).data)
        assertEquals("[1,2]", String(Bodies.capture(Request(POST, "/").header("Content-Type", "text/plain").body("[1,2]")).data as ByteArray))
        assertEquals("[1,2]", String(Bodies.capture(Request(POST, "/").body("[1,2]")).data as ByteArray))
    }

    @Test
    fun `a short stream of known length is read whole, handed back in memory, and the original closed`() {
        val original = Watched("hello".toByteArray())
        val captured = Bodies.capture(Request(POST, "/").body(original, 5L))
        assertEquals("hello", String(captured.data as ByteArray))
        assertEquals("hello", captured.message.bodyString())
        assertTrue(original.closed)
    }

    @Test
    fun `a stream exactly the limit is shown, one byte over is not, and either way the app gets every byte`() {
        val exact = big(Bodies.LIMIT)
        val known = Shown(Response(OK).body(ByteArrayInputStream(exact), Bodies.LIMIT.toLong()))
        assertArrayEquals(exact, known.data as ByteArray)
        assertArrayEquals(
            exact,
            known.passed.body.stream
                .readAllBytes(),
        )

        val teed = Shown(Response(OK).body(ByteArrayInputStream(exact)))
        assertArrayEquals(
            exact,
            teed.passed.body.stream
                .readAllBytes(),
        )
        assertArrayEquals(exact, teed.data as ByteArray)

        val over = big(Bodies.LIMIT + 1)
        val overTeed = Shown(Response(OK).body(ByteArrayInputStream(over)))
        assertArrayEquals(
            over,
            overTeed.passed.body.stream
                .readAllBytes(),
        )
        assertEquals(mapOf("notShown" to "larger than 256 KiB", "size" to (Bodies.LIMIT + 1).toLong()), overTeed.data)
    }

    @Test
    fun `a stream longer than it said is handed on whole and not shown`() {
        val bytes = big(Bodies.LIMIT + 10)
        val liar = Shown(Response(OK).body(ByteArrayInputStream(bytes), 10L))
        assertEquals(mapOf("notShown" to "larger than 256 KiB", "size" to 10L), liar.data)
        assertArrayEquals(
            bytes,
            liar.passed.body.stream
                .readAllBytes(),
        )
    }

    @Test
    fun `a response stream of unknown length is passed on unread and shown once the reader is done`() {
        val original = Watched("""{"ok":true}""".toByteArray())
        val shown = Shown(Response(OK).header("Content-Type", json).body(original))
        assertFalse(original.read, "nothing is read before the caller reads")
        assertTrue(shown.calls.isEmpty(), "nothing is shown before the caller reads")
        val stream = shown.passed.body.stream
        assertEquals('{'.code, stream.read())
        assertEquals("\"ok\":true}", String(stream.readAllBytes()))
        stream.close()
        assertEquals(mapOf("ok" to true), shown.data, "shown once, at the end")
        assertTrue(original.closed)
    }

    @Test
    fun `a stream the reader closes early shows what was read, marked as not read to the end`() {
        val shown = Shown(Response(OK).body(ByteArrayInputStream("hello world".toByteArray())))
        val stream = shown.passed.body.stream
        assertEquals(5, stream.read(ByteArray(5)))
        assertEquals(0, stream.read(ByteArray(0)))
        assertTrue(stream.available() > 0)
        stream.close()
        val data = shown.data as Map<*, *>
        assertEquals("closed after 5 bytes, not read to the end", data["note"])
        assertEquals("hello", String(data["body"] as ByteArray))
    }

    @Test
    fun `a long stream closed early, or closed unread, is a note without a body`() {
        val long = Shown(Response(OK).body(ByteArrayInputStream(big(Bodies.LIMIT + 10))))
        val stream = long.passed.body.stream
        val read = stream.readNBytes(Bodies.LIMIT + 1).size
        stream.close()
        assertEquals(mapOf("note" to "closed after $read bytes, not read to the end"), long.data)

        val unread = Shown(Response(OK).body(ByteArrayInputStream("hello".toByteArray())))
        unread.passed.body.stream
            .close()
        assertEquals(mapOf("note" to "closed after 0 bytes, not read to the end"), unread.data)
    }

    @Test
    fun `a stream read to its end and then closed is the whole body, shown once`() {
        val shown = Shown(Response(OK).body(ByteArrayInputStream("hello".toByteArray())))
        val stream = shown.passed.body.stream
        assertEquals("hello", String(stream.readAllBytes()))
        stream.close()
        assertEquals("hello", String(shown.data as ByteArray))
    }

    @Test
    fun `a stream that fails while teed is shown as far as it got, and fails the reader`() {
        val failing =
            object : InputStream() {
                var left = 3

                override fun read(): Int = if (left-- > 0) 'x'.code else throw IOException("reset")
            }
        val shown = Shown(Response(OK).body(failing))
        val stream = shown.passed.body.stream
        assertEquals("xxx", String(ByteArray(3).also { b -> repeat(3) { b[it] = stream.read().toByte() } }))
        assertThrows(IOException::class.java) { stream.read() }
        stream.close()
        assertEquals("xxx", String(shown.data as ByteArray))
    }

    @Test
    fun `a stream that fails while teed is shown on the failure itself, without being closed`() {
        val failing =
            object : InputStream() {
                var left = 3

                override fun read(): Int = if (left-- > 0) 'x'.code else throw IOException("reset")

                override fun read(
                    b: ByteArray,
                    off: Int,
                    len: Int,
                ): Int = if (left > 0) super.read(b, off, minOf(len, left)) else throw IOException("reset")
            }
        val shown = Shown(Response(OK).body(failing))
        val stream = shown.passed.body.stream
        val buffer = ByteArray(16)
        assertEquals(3, stream.read(buffer, 0, buffer.size))
        assertTrue(shown.calls.isEmpty(), "nothing is shown before the stream ends or fails")
        assertThrows(IOException::class.java) { stream.read(buffer, 0, buffer.size) }
        assertEquals("xxx", String(shown.data as ByteArray), "shown once, though never closed")
        assertThrows(IOException::class.java) { stream.read() }
        assertEquals(1, shown.calls.size, "a second failure does not show it again")
    }

    @Test
    fun `a request stream of unknown length is passed on unread`() {
        val original = Watched("hello".toByteArray())
        val request = Request(POST, "/").header("Content-Type", "text/plain").body(original)
        val captured = Bodies.capture(request)
        assertSame(request, captured.message)
        assertFalse(original.read)
        assertEquals(mapOf("notShown" to "a stream of unknown length, passed on unread", "contentType" to "text/plain"), captured.data)
    }

    @Test
    fun `a stream known to be long, and an event stream, are never read`() {
        val long = Watched(big(10))
        val known = Shown(Response(OK).body(long, (Bodies.LIMIT + 1).toLong()))
        assertEquals(mapOf("notShown" to "larger than 256 KiB", "size" to (Bodies.LIMIT + 1).toLong()), known.data)
        assertFalse(long.read)

        val events = Watched("data: 1\n\n".toByteArray())
        val sse = Shown(Response(OK).header("Content-Type", "text/event-stream").body(events))
        assertEquals(mapOf("stream" to "text/event-stream"), sse.data)
        assertFalse(events.read)

        val empty = Watched(ByteArray(0))
        assertNull(Shown(Response(OK).body(empty, 0L)).data)
        assertFalse(empty.read)
    }

    @Test
    fun `a large body in memory is not copied`() {
        assertEquals(
            mapOf("notShown" to "larger than 256 KiB", "size" to (Bodies.LIMIT + 1).toLong()),
            Shown(Response(OK).body(Body(java.nio.ByteBuffer.wrap(big(Bodies.LIMIT + 1))))).data,
        )
    }

    @Test
    fun `a compressed body is its encoding and size, and a compressed stream is never read`() {
        val gzip = Shown(Response(OK).header("Content-Encoding", "gzip").body("not really gzip"))
        assertEquals(mapOf("encoding" to "gzip", "size" to 15), gzip.data)
        val identity = Shown(Response(OK).header("Content-Encoding", "identity").body("plain"))
        assertEquals("plain", String(identity.data as ByteArray))

        val zipped = Watched(big(10))
        assertEquals(mapOf("encoding" to "gzip", "size" to 10L), Shown(Response(OK).header("Content-Encoding", "gzip").body(zipped, 10L)).data)
        val unknown = Watched(big(10))
        assertEquals(mapOf("encoding" to "br"), Shown(Response(OK).header("Content-Encoding", "br").body(unknown)).data)
        assertFalse(zipped.read || unknown.read)
    }

    @Test
    fun `a stream that fails part way fails the app the same way, after the bytes it gave`() {
        val failing =
            object : InputStream() {
                var left = 3

                override fun read(): Int = if (left-- > 0) 'x'.code else throw IOException("reset")
            }
        val captured = Bodies.capture(Request(POST, "/").body(failing, 10L))
        assertNull(captured.data)
        val stream = captured.message.body.stream
        assertEquals("xxx", String(ByteArray(3).also { stream.read(it) }))
        assertThrows(IOException::class.java) { stream.read() }
    }

    @Test
    fun `a capture that fails still shows a reply, once`() {
        val broken =
            object : Body {
                override val stream: InputStream get() = throw IllegalStateException("gone")
                override val payload get() = throw IllegalStateException("gone")
                override val length: Long = 5L

                override fun close() = Unit
            }
        val shown = Shown(Response(OK).body(broken))
        assertEquals(listOf<Any?>(null), shown.calls)
    }
}
