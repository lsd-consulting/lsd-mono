package io.github.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.core.io.buffer.DefaultDataBufferFactory

class StreamsTest {
    private fun events(count: Int) = (1..count).joinToString("") { "event: scan\r\nid: $it\r\ndata: {\"n\":$it}\r\n\r\n" }

    @Test
    fun `an event stream is counted and its first events kept, however it is split`() {
        val bytes = (": keep-alive\n\n" + events(7)).toByteArray()
        val tap = SseTap()
        // One byte at a time: lines, and their CRLF endings, split across chunks.
        bytes.indices.forEach { tap.copy(bytes, it, 1) }

        val summary = tap.summary()
        assertEquals(7, summary["events"])
        assertEquals(true, summary["truncated"])
        val first = summary["first"] as List<*>
        assertEquals(5, first.size)
        assertEquals(mapOf("event" to "scan", "id" to "1", "data" to mapOf("n" to 1)), first[0])
    }

    @Test
    fun `a short stream is all shown, multi-line and text data included, and an unfinished last event is dropped, as in the spec`() {
        val tap = SseTap()
        tap.copy(DefaultDataBufferFactory.sharedInstance.wrap("data: one\ndata: two\n\ndata: plain".toByteArray()))

        val summary = tap.summary()
        assertEquals(1, summary["events"])
        assertNull(summary["truncated"])
        assertEquals(listOf(mapOf("data" to "one\ntwo")), summary["first"])
    }

    @Test
    fun `a multipart body is its parts, never their contents`() {
        val body =
            "--b\r\nContent-Disposition: form-data; name=\"invoice\"; filename=\"i.pdf\"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1\r\n" +
                "--b\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nhi\r\n--b--\r\n"

        val summary = Multipart.summary(body.toByteArray(), "multipart/form-data; boundary=b")

        assertEquals(
            mapOf(
                "parts" to
                    listOf(
                        mapOf("name" to "invoice", "filename" to "i.pdf", "contentType" to "application/pdf", "size" to 6L),
                        mapOf("name" to "note", "size" to 2L),
                    ),
            ),
            summary,
        )
    }

    @Test
    fun `a multipart body cut short lists the parts it holds and says so`() {
        val body = "--b\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n12345"

        val summary = Multipart.summary(body.toByteArray(), "multipart/form-data; boundary=\"b\"")!!

        assertEquals(true, summary["truncated"])
        assertEquals(listOf(mapOf("name" to "a", "size" to 5L)), summary["parts"])
        assertNull(Multipart.summary(body.toByteArray(), "multipart/form-data"), "no boundary, no summary")
    }

    @Test
    fun `bodies route streams to their summaries, and only cut-short streams get a head`() {
        val sse = events(2).toByteArray()
        assertEquals(2, (Bodies.read(sse, "text/event-stream") as Map<*, *>)["events"])
        assertEquals(2, (Bodies.head(sse, "text/event-stream") as Map<*, *>)["events"])
        assertEquals(true, (Bodies.head(sse, "text/event-stream") as Map<*, *>)["truncated"])
        assertNull(Bodies.head("{\"a\":1}".toByteArray(), "application/json"))
    }

    @Test
    fun `a body tap past its limit keeps its head, and summarises a stream from it`() {
        val tap = BodyTap()
        val big = events(2).toByteArray() + ByteArray(Bodies.LIMIT) { 'x'.code.toByte() }
        tap.copy(DefaultDataBufferFactory.sharedInstance.wrap(big))

        assertTrue(tap.overflowed)
        assertNull(tap.bytes())
        assertEquals(Bodies.LIMIT, tap.head().size)
        assertEquals(true, (tap.read("text/event-stream") as Map<*, *>)["truncated"])
    }
}
