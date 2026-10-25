package io.lsdconsulting.lsd.mono.http4k

import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.http4k.Scenarios.arrow
import io.lsdconsulting.lsd.mono.http4k.Scenarios.body
import io.lsdconsulting.lsd.mono.http4k.Scenarios.lsd
import io.lsdconsulting.lsd.mono.http4k.Scenarios.report
import io.lsdconsulting.lsd.mono.http4k.Scenarios.start
import org.http4k.client.JavaHttpClient
import org.http4k.core.BodyMode
import org.http4k.core.Method.GET
import org.http4k.core.Method.POST
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.Status.Companion.OK
import org.http4k.core.then
import org.http4k.server.Http4kServer
import org.http4k.server.SunHttp
import org.http4k.server.asServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * A streamed body the caller has to start reading before it ends is passed on at once: the
 * filters never hold a reply back waiting for a body that only the caller can release.
 */
@LsdTestConfig(deterministicIds = true)
class StreamingTest {
    private var server: Http4kServer? = null

    @BeforeEach
    @AfterEach
    fun clear() {
        server?.stop()
        server = null
        lsd.clear()
    }

    /**
     * `first ` at once, then `last` only once [release] is called: the caller does that when it
     * has the response. If nobody calls it within the timeout the stream ends anyway and
     * [timedOut] says so, so a filter that waits for the body fails the test rather than hanging it.
     */
    private class Gated : InputStream() {
        private val gate = CountDownLatch(1)
        private val parts = ArrayDeque(listOf("first ", "last"))
        private var current: ByteArray = ByteArray(0)
        private var at = 0

        @Volatile var timedOut = false

        fun release() = gate.countDown()

        override fun read(): Int {
            if (at == current.size) {
                if (parts.size == 1 && !gate.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) timedOut = true
                current = parts.removeFirstOrNull()?.toByteArray() ?: return -1
                at = 0
            }
            return current[at++].toInt()
        }

        override fun read(
            b: ByteArray,
            off: Int,
            len: Int,
        ): Int {
            if (len == 0) return 0
            val first = read()
            if (first < 0) return -1
            b[off] = first.toByte()
            var n = 1
            // Hand over the rest of the part already in hand, never waiting for the next one.
            while (n < len && at < current.size) b[off + n++] = current[at++]
            return n
        }
    }

    @Test
    fun `a server filter on a real server sends the headers before a streamed body ends`() {
        val scenario = start(bind = false)
        val body = Gated()
        server =
            LsdHttp4k
                .serverFilter("Prices")
                .then { Response(OK).header("Content-Type", "text/plain").body(body) }
                .asServer(SunHttp(0))
                .start()
        val client = JavaHttpClient(responseBodyMode = BodyMode.Stream)

        val response = client(Request(GET, "http://localhost:${server!!.port()}/prices"))
        assertFalse(body.timedOut, "the headers came before the body was released")
        assertEquals(OK, response.status)
        body.release()
        assertEquals("first last", String(response.body.stream.readAllBytes()))

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "200 OK"), drawn.labels, drawn.json)
        assertEquals("first last", drawn.message("200 OK").body(), drawn.json)
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("200 OK")))
    }

    @Test
    fun `a client filter hands back a streamed response before it ends, and draws it once read`() {
        val scenario = start()
        val body = Gated()
        val prices = LsdHttp4k.clientFilter("Prices").then { Response(OK).header("Content-Type", "text/plain").body(body) }

        val response = prices(Request(GET, "/prices"))
        assertFalse(body.timedOut, "the response came before the body was released")
        body.release()
        response.body.stream.use { assertEquals("first last", String(it.readAllBytes())) }

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "200 OK"), drawn.labels, drawn.json)
        assertEquals("first last", drawn.message("200 OK").body(), drawn.json)
    }

    @Test
    fun `a streamed request is passed on unread, and the app reads all of it`() {
        val scenario = start()
        val seen = StringBuilder()
        val app = LsdHttp4k.serverFilter("Uploads").then { r -> Response(OK).also { seen.append(String(r.body.stream.readAllBytes())) } }

        app(Request(POST, "/uploads").body("a long upload".byteInputStream()))

        assertEquals("a long upload", seen.toString())
        val drawn = report(scenario)
        assertEquals("a stream of unknown length, passed on unread", (drawn.message("POST /uploads").body() as Map<*, *>)["notShown"], drawn.json)
    }

    @Test
    fun `a client in front of an in-memory server that fails after taking the call draws it once`() {
        val scenario = start()
        val broken = LsdHttp4k.clientFilter("Shop").then(LsdHttp4k.serverFilter("Shop").then { throw IllegalStateException("boom") })

        assertThrows(IllegalStateException::class.java) { broken(Request(POST, "/orders")) }

        val drawn = report(scenario)
        assertEquals(listOf("POST /orders", "IllegalStateException"), drawn.labels, drawn.json)
        assertTrue(drawn.message("IllegalStateException").source.contains("boom"), drawn.json)
    }

    @Test
    fun `a guarded capture interrupted is left out, and the thread stays interrupted`() {
        assertEquals("fallback", Calls.guarded("fallback") { throw InterruptedException("stop") })
        assertTrue(Thread.interrupted(), "the interrupt is kept for the app")
    }

    private companion object {
        const val TIMEOUT_SECONDS = 5L
    }
}
