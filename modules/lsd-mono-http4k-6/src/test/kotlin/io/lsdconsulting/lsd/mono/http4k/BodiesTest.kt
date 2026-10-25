package io.lsdconsulting.lsd.mono.http4k

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
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

/** Bodies are shown without taking a byte from the app. */
class BodiesTest {
    private fun big(size: Int) = ByteArray(size) { (it % 251).toByte() }

    /** A stream that records whether anyone read it. */
    private class Watched(
        bytes: ByteArray,
    ) : ByteArrayInputStream(bytes) {
        var read = false

        override fun read(
            b: ByteArray,
            off: Int,
            len: Int,
        ): Int = super.read(b, off, len).also { read = true }

        override fun read(): Int = super.read().also { read = true }
    }

    @Test
    fun `a body in memory is shown and left as it is`() {
        val request = Request(POST, "/").body("""{"a":1}""")
        val captured = Bodies.capture(request)
        assertSame(request, captured.message)
        assertEquals(mapOf("a" to 1L), captured.data, "JSON is shown as a structure")
        assertEquals("""{"a":1}""", captured.message.bodyString(), "still readable")
        assertNull(Bodies.capture(Request(POST, "/")).data, "an empty body is no body")
    }

    @Test
    fun `a short stream is read whole and handed back in memory`() {
        val captured = Bodies.capture(Request(POST, "/").body(ByteArrayInputStream("hello".toByteArray())))
        assertEquals("hello", String(captured.data as ByteArray))
        assertEquals("hello", captured.message.bodyString())
    }

    @Test
    fun `a long stream of unknown length is shown as not shown, and the app still gets every byte`() {
        val bytes = big(Bodies.LIMIT + 10_000)
        val captured = Bodies.capture(Response(OK).body(ByteArrayInputStream(bytes)))
        assertEquals(mapOf("notShown" to "larger than 256 KiB"), captured.data)
        assertArrayEquals(
            bytes,
            captured.message.body.stream
                .readAllBytes(),
        )
    }

    @Test
    fun `a stream known to be long, and an event stream, are never read`() {
        val long = Watched(big(10))
        val known = Bodies.capture(Response(OK).body(long, (Bodies.LIMIT + 1).toLong()))
        assertEquals(mapOf("notShown" to "larger than 256 KiB", "size" to (Bodies.LIMIT + 1).toLong()), known.data)
        assertFalse(long.read)

        val events = Watched("data: 1\n\n".toByteArray())
        val sse = Bodies.capture(Response(OK).header("Content-Type", "text/event-stream").body(events))
        assertEquals(mapOf("stream" to "text/event-stream"), sse.data)
        assertFalse(events.read)

        val empty = Watched(ByteArray(0))
        assertNull(Bodies.capture(Response(OK).body(empty, 0L)).data)
        assertFalse(empty.read)
    }

    @Test
    fun `a large body in memory is not copied`() {
        assertEquals(
            mapOf("notShown" to "larger than 256 KiB", "size" to (Bodies.LIMIT + 1).toLong()),
            Bodies.capture(Response(OK).body(Body(java.nio.ByteBuffer.wrap(big(Bodies.LIMIT + 1))))).data,
        )
    }

    @Test
    fun `a compressed body is its encoding and size`() {
        val gzip = Bodies.capture(Response(OK).header("Content-Encoding", "gzip").body("not really gzip"))
        assertEquals(mapOf("encoding" to "gzip", "size" to 15), gzip.data)
        val identity = Bodies.capture(Response(OK).header("Content-Encoding", "identity").body("plain"))
        assertEquals("plain", String(identity.data as ByteArray))
    }

    @Test
    fun `a stream that fails part way fails the app the same way, after the bytes it gave`() {
        val failing =
            object : InputStream() {
                var left = 3

                override fun read(): Int = if (left-- > 0) 'x'.code else throw IOException("reset")
            }
        val captured = Bodies.capture(Request(POST, "/").body(failing))
        assertNull(captured.data)
        val stream = captured.message.body.stream
        assertEquals("xxx", String(ByteArray(3).also { stream.read(it) }))
        assertThrows(IOException::class.java) { stream.read() }
    }
}
