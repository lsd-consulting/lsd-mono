package io.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletResponse

class TeeResponseTest {
    @Test
    fun `what the app writes reaches the client and is copied for the diagram`() {
        val client = MockHttpServletResponse()
        val tee = TeeResponse(client).apply { contentType = "application/json" }

        tee.writer.apply {
            write("{\"total\":")
            print(49.0)
            write("}")
            flush()
        }

        assertEquals("{\"total\":49.0}", client.contentAsString)
        assertEquals(mapOf("total" to 49.0), tee.body())
    }

    @Test
    fun `an event stream written as bytes is summarised, and reaches the client whole`() {
        val client = MockHttpServletResponse()
        val tee = TeeResponse(client).apply { contentType = "text/event-stream" }
        val stream = (1..6).joinToString("") { "data: $it\n\n" }

        tee.outputStream.write(stream.toByteArray())

        assertEquals(stream, client.contentAsString)
        val summary = tee.body() as Map<*, *>
        assertEquals(6, summary["events"])
        assertEquals(true, summary["truncated"])
    }

    @Test
    fun `a sendError is noted, and a reset forgets what was copied`() {
        val tee = TeeResponse(MockHttpServletResponse()).apply { contentType = "text/plain" }
        tee.outputStream.write("partial".toByteArray())
        tee.reset()
        assertFalse(tee.errorSent)

        tee.sendError(404)

        assertTrue(tee.errorSent)
    }
}
