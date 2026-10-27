package io.github.lsdconsulting.lsd.mono.ktor

import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.arrow
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.body
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.lsd
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.report
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.start
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.prepareGet
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.request.receiveText
import io.ktor.server.response.header
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondBytesWriter
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.utils.io.ByteWriteChannel
import io.ktor.utils.io.readRemaining
import io.ktor.utils.io.writeFully
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.io.readByteArray
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.atomic.AtomicReference
import io.ktor.client.engine.cio.CIO as ClientCIO
import io.ktor.server.cio.CIO as ServerCIO

/**
 * A streamed body the caller has to start reading before it ends is passed on at once: the
 * plugins never hold a reply back waiting for a body that only the caller can release.
 */
@LsdTestConfig(deterministicIds = true)
class StreamingTest {
    private val servers = mutableListOf<EmbeddedServer<*, *>>()
    private val clients = mutableListOf<HttpClient>()

    @BeforeEach
    @AfterEach
    fun clear() {
        clients.forEach { it.close() }
        clients.clear()
        servers.forEach { it.stop(0, 0) }
        servers.clear()
        lsd.clear()
    }

    private fun serve(module: Application.() -> Unit): String {
        val server = embeddedServer(ServerCIO, port = 0, module = module).start(wait = false)
        servers += server
        return "http://localhost:${runBlocking {
            server.engine
                .resolvedConnectors()
                .first()
                .port
        }}"
    }

    private fun client(withPlugin: Boolean = true): HttpClient =
        HttpClient(ClientCIO) { if (withPlugin) install(LsdClient) { target = "Prices" } }.also { clients += it }

    /**
     * [FIRST] at once, then `last` once released, or after the timeout if nobody releases it, so a
     * plugin that waits for the end of the body fails the test rather than hanging it.
     */
    private class Gated {
        val gate = CompletableDeferred<Unit>()

        @Volatile var timedOut = false

        suspend fun write(channel: ByteWriteChannel) {
            channel.writeFully(FIRST.toByteArray())
            channel.flush()
            if (withTimeoutOrNull(TIMEOUT_MS) { gate.await() } == null) timedOut = true
            channel.writeFully("last".toByteArray())
        }
    }

    private fun Application.prices(gated: Gated) {
        routing {
            get("/prices") { call.respondBytesWriter(ContentType.Text.Plain) { gated.write(this) } }
        }
    }

    @Test
    fun `a server plugin on a real server sends the headers before a streamed body ends`() {
        val scenario = start(bind = false)
        val gated = Gated()
        val url =
            serve {
                install(Lsd) { app = "Prices" }
                prices(gated)
            }

        runBlocking {
            client(withPlugin = false).prepareGet("$url/prices").execute { response ->
                assertEquals(HttpStatusCode.OK, response.status)
                assertFalse(gated.timedOut, "the headers came before the body was released")
                gated.gate.complete(Unit)
                assertEquals(FIRST + "last", String(response.bodyAsChannel().readRemaining().readByteArray()))
            }
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "200 OK"), drawn.labels, drawn.json)
        assertEquals(FIRST + "last", drawn.message("200 OK").body(), drawn.json)
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("200 OK")))
    }

    @Test
    fun `a client plugin hands back a streamed response before it ends, and draws it once read`() {
        val scenario = start()
        val gated = Gated()
        val url = serve { prices(gated) }

        runBlocking {
            client().prepareGet("$url/prices").execute { response ->
                assertFalse(gated.timedOut, "the response came before the body was released")
                gated.gate.complete(Unit)
                assertEquals(FIRST + "last", String(response.bodyAsChannel().readRemaining().readByteArray()))
            }
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "200 OK"), drawn.labels, drawn.json)
        assertEquals(FIRST + "last", drawn.message("200 OK").body(), drawn.json)
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("200 OK")))
    }

    @Test
    fun `a streamed request is passed on unread, and the app reads all of it`() {
        val scenario = start()
        val seen = AtomicReference<String>()
        val url =
            serve {
                install(Lsd) { app = "Uploads" }
                routing {
                    post("/uploads") {
                        seen.set(call.receiveText())
                        call.respondText("ok")
                    }
                }
            }
        runBlocking {
            client(withPlugin = false).post("$url/uploads") {
                setBody(
                    object : OutgoingContent.WriteChannelContent() {
                        override suspend fun writeTo(channel: ByteWriteChannel) = channel.writeFully("a long upload".toByteArray())
                    },
                )
            }
        }

        assertEquals("a long upload", seen.get())
        val drawn = report(scenario)
        assertEquals("a stream of unknown length, passed on unread", (drawn.message("POST /uploads").body() as Map<*, *>)["notShown"], drawn.json)
    }

    @Test
    fun `the client draws the bodies it sends, and summarises the ones it cannot show`() {
        val scenario = start()
        val big = "x".repeat(Bodies.LIMIT + 1)
        val url =
            serve {
                routing {
                    post("/pay") { call.respondText(call.receiveText(), ContentType.Application.Json) }
                    get("/big") { call.respondText(big) }
                    get("/zipped") {
                        call.response.header(HttpHeaders.ContentEncoding, "gzip")
                        call.respondBytes(ByteArray(10), ContentType.Application.OctetStream)
                    }
                }
            }
        runBlocking {
            val client = client()
            client.post("$url/pay") {
                setBody(
                    io.ktor.http.content
                        .TextContent("""{"amount":49.0}""", ContentType.Application.Json),
                )
            }
            client.post("$url/pay") {
                setBody(
                    object : OutgoingContent.ReadChannelContent() {
                        override val contentType = ContentType.Application.Json

                        override fun readFrom() = io.ktor.utils.io
                            .ByteReadChannel("""{"amount":1.0}""")
                    },
                )
            }
            assertEquals(big.length, client.get("$url/big").bodyAsText().length)
            client.get("$url/zipped")
        }

        val drawn = report(scenario)
        assertEquals(
            listOf("POST /pay", "200 OK", "POST /pay", "200 OK", "GET /big", "200 OK", "GET /zipped", "200 OK"),
            drawn.labels,
            drawn.json,
        )
        val sent = drawn.messages.filter { it["label"] == "POST /pay" }
        assertEquals(49.0, ((sent[0].body() as Map<*, *>)["amount"] as Number).toDouble(), drawn.json)
        assertEquals("a stream of unknown length, passed on unread", (sent[1].body() as Map<*, *>)["notShown"], drawn.json)
        val replies = drawn.messages.filter { it["label"] == "200 OK" }
        assertEquals(1.0, ((replies[1].body() as Map<*, *>)["amount"] as Number).toDouble(), "the streamed request still went: ${drawn.json}")
        assertEquals("larger than 256 KiB", (replies[2].body() as Map<*, *>)["notShown"], drawn.json)
        assertEquals("gzip", (replies[3].body() as Map<*, *>)["encoding"], drawn.json)
    }

    private companion object {
        const val TIMEOUT_MS = 5_000L
        val FIRST = "a".repeat(64 * 1024)
    }
}
