package io.github.lsdconsulting.lsd.mono.ktor

import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.arrow
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.body
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.lsd
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.nameOf
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.report
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.start
import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.HttpRedirect
import io.ktor.client.plugins.HttpRequestRetry
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytesWriter
import io.ktor.server.response.respondRedirect
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import io.ktor.util.pipeline.PipelinePhase
import io.ktor.utils.io.writeFully
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.cancellation.CancellationException
import io.ktor.client.engine.cio.CIO as ClientCIO
import io.ktor.server.cio.CIO as ServerCIO

/**
 * The client plugin with Ktor's own redirect, retry and timeout plugins, in either install order:
 * every hop drawn as its own call, every body handed on, and each call drawn once.
 */
@LsdTestConfig(deterministicIds = true)
class ClientHopsTest {
    private val servers = mutableListOf<EmbeddedServer<*, *>>()
    private val clients = mutableListOf<HttpClient>()
    private val attempts = AtomicInteger()

    @BeforeEach
    @AfterEach
    fun clear() {
        clients.forEach { it.close() }
        clients.clear()
        servers.forEach { it.stop(0, 0) }
        servers.clear()
        lsd.clear()
    }

    private fun serve(module: Application.() -> Unit): Int {
        val server = embeddedServer(ServerCIO, port = 0, module = module).start(wait = false)
        servers += server
        return runBlocking {
            server.engine
                .resolvedConnectors()
                .first()
                .port
        }
    }

    private fun client(block: HttpClientConfig<*>.() -> Unit): HttpClient = HttpClient(ClientCIO, block).also { clients += it }

    /** A service without the server plugin: a fixed and a chunked body, a flaky endpoint, a redirect. */
    private fun Application.service() {
        routing {
            get("/text") { call.respondText("""{"price":4900}""", ContentType.Application.Json) }
            get("/chunked") { call.respondBytesWriter(ContentType.Text.Plain) { writeFully("streamed".toByteArray()) } }
            get("/flaky") {
                if (attempts.incrementAndGet() == 1) call.respond(HttpStatusCode.ServiceUnavailable) else call.respondText("ok")
            }
            get("/old") { call.respondRedirect("/new") }
            get("/new") { call.respondText("new") }
        }
    }

    private val retry: HttpClientConfig<*>.() -> Unit = {
        install(HttpRequestRetry) {
            retryOnServerErrors(maxRetries = 2)
            constantDelay(1, 0)
        }
    }

    private val lsdClient: HttpClientConfig<*>.() -> Unit = { install(LsdClient) { target = "Prices" } }

    @Test
    fun `with retry installed before the client plugin, the app gets every body, fixed or chunked`() {
        val scenario = start()
        val port = serve { service() }
        val app =
            client {
                retry()
                lsdClient()
            }
        runBlocking {
            assertEquals("""{"price":4900}""", app.get("http://localhost:$port/text").bodyAsText())
            assertEquals("streamed", app.get("http://localhost:$port/chunked").bodyAsText())
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /text", "200 OK", "GET /chunked", "200 OK"), drawn.labels, drawn.json)
        assertEquals("streamed", drawn.messages[3].body(), drawn.json)
    }

    @Test
    fun `with retry installed before the client plugin, a testApplication client gets every body`() {
        val scenario = start()
        testApplication {
            application { service() }
            val app =
                createClient {
                    retry()
                    lsdClient()
                }
            assertEquals("""{"price":4900}""", app.get("/text").bodyAsText())
            assertEquals("streamed", app.get("/chunked").bodyAsText())
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /text", "200 OK", "GET /chunked", "200 OK"), drawn.labels, drawn.json)
    }

    @Test
    fun `each retry is drawn as its own call, whichever plugin is installed first`() {
        for (lsdFirst in listOf(false, true)) {
            attempts.set(0)
            val scenario = start("retry-$lsdFirst")
            val port = serve { service() }
            val app =
                client {
                    if (lsdFirst) lsdClient()
                    retry()
                    if (!lsdFirst) lsdClient()
                }
            assertEquals("ok", runBlocking { app.get("http://localhost:$port/flaky").bodyAsText() })

            val drawn = report(scenario, "retry-$lsdFirst")
            assertEquals(listOf("GET /flaky", "503 Service Unavailable", "GET /flaky", "200 OK"), drawn.labels, "lsd first: $lsdFirst ${drawn.json}")
        }
    }

    @Test
    fun `each redirect hop is drawn as its own call, whichever plugin is installed first`() {
        for (lsdFirst in listOf(false, true)) {
            val scenario = start("redirect-$lsdFirst")
            val port = serve { service() }
            val app =
                client {
                    if (lsdFirst) {
                        followRedirects = false
                        lsdClient()
                        install(HttpRedirect)
                    } else {
                        lsdClient()
                    }
                }
            assertEquals("new", runBlocking { app.get("http://localhost:$port/old").bodyAsText() })

            val drawn = report(scenario, "redirect-$lsdFirst")
            assertEquals(listOf("GET /old", "302 Found", "GET /new", "200 OK"), drawn.labels, "lsd first: $lsdFirst ${drawn.json}")
            assertEquals("new", drawn.messages[3].body(), drawn.json)
        }
    }

    @Test
    fun `a redirect to a server plugin in this JVM is drawn once per hop, under the server's name`() {
        val scenario = start()
        val port =
            serve {
                install(Lsd) { app = "Shop" }
                service()
            }
        assertEquals("new", runBlocking { client { lsdClient() }.get("http://localhost:$port/old").bodyAsText() })

        val drawn = report(scenario)
        assertEquals(listOf("GET /old", "302 Found", "GET /new", "200 OK"), drawn.labels, drawn.json)
        assertEquals("Shop -> Client", drawn.arrow(drawn.message("200 OK")))
    }

    @Test
    fun `a redirect to another host is drawn there, and is not sent the scenario unless that host is allowed`() {
        val scenario = start()
        val seen = mutableMapOf<String, Headers>()
        val engine =
            MockEngine { request ->
                seen[request.url.host] = request.headers
                if (request.url.host == "localhost") {
                    respond("", HttpStatusCode.Found, headersOf(HttpHeaders.Location, "https://payments.example.com/new"))
                } else {
                    respond("paid")
                }
            }
        val app = HttpClient(engine) { install(LsdClient) }.also { clients += it }
        assertEquals("paid", runBlocking { app.get("http://localhost:8089/old").bodyAsText() })

        val drawn = report(scenario)
        assertEquals(listOf("GET /old", "302 Found", "GET /new", "200 OK"), drawn.labels, drawn.json)
        assertEquals("payments.example.com", drawn.nameOf(drawn.message("GET /new")["to"]))
        assertEquals(scenario.correlationId, seen.getValue("localhost")[LsdHeaders.SCENARIO])
        val remote = seen.getValue("payments.example.com")
        assertNull(remote[LsdHeaders.SCENARIO], "the redirect does not carry the scenario on: $remote")
        assertNull(remote[Calls.CALLER_HEADER])
        assertEquals(1, remote.getAll(Calls.CALL_HEADER)?.size, "only a fresh call id: $remote")
        assertNotNull(seen.getValue("localhost")[Calls.CALL_HEADER])
    }

    private fun Application.slow(done: CompletableDeferred<Unit>) {
        routing {
            get("/slow") {
                try {
                    delay(1_000)
                    call.respondText("late")
                } finally {
                    done.complete(Unit)
                }
            }
        }
    }

    @Test
    fun `a client timeout to a server plugin in this JVM is drawn once, as the timeout the caller sees`() {
        val scenario = start()
        val done = CompletableDeferred<Unit>()
        val port =
            serve {
                install(Lsd) { app = "Slow" }
                slow(done)
            }
        val app =
            client {
                install(HttpTimeout) { requestTimeoutMillis = 300 }
                lsdClient()
            }
        assertThrows(HttpRequestTimeoutException::class.java) { runBlocking { app.get("http://localhost:$port/slow") } }
        runBlocking { withTimeout(5_000) { done.await() } }

        val drawn = report(scenario)
        assertEquals(listOf("GET /slow", "HttpRequestTimeoutException"), drawn.labels, drawn.json)
        assertEquals("Slow -> Client", drawn.arrow(drawn.message("HttpRequestTimeoutException")))
        assertEquals("error", drawn.message("HttpRequestTimeoutException")["status"])
    }

    @Test
    fun `a client timeout with no server plugin is drawn as the timeout, not the cancellation`() {
        val scenario = start()
        val done = CompletableDeferred<Unit>()
        val port = serve { slow(done) }
        val app =
            client {
                install(HttpTimeout) { requestTimeoutMillis = 300 }
                lsdClient()
            }
        assertThrows(HttpRequestTimeoutException::class.java) { runBlocking { app.get("http://localhost:$port/slow") } }

        val drawn = report(scenario)
        assertEquals(listOf("GET /slow", "HttpRequestTimeoutException"), drawn.labels, drawn.json)
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("HttpRequestTimeoutException")))
    }

    @Test
    fun `a call to this JVM's server by a non-loopback address is drawn once, by the server`() {
        val ip =
            NetworkInterface
                .getNetworkInterfaces()
                .toList()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.toList() }
                .firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
        assumeTrue(ip != null, "no non-loopback address to call")
        val scenario = start()
        val port =
            serve {
                install(Lsd) { app = "Shop" }
                service()
            }
        attempts.set(1)
        assertEquals("ok", runBlocking { client { lsdClient() }.get("http://${ip!!.hostAddress}:$port/flaky").bodyAsText() })

        val drawn = report(scenario)
        assertEquals(listOf("GET /flaky", "200 OK"), drawn.labels, drawn.json)
        assertEquals("Shop -> Client", drawn.arrow(drawn.message("200 OK")))
    }

    @Test
    fun `over a socket, an unhandled exception is drawn once, and one after the reply is not drawn`() {
        val scenario = start()
        val port =
            serve {
                install(Lsd) { app = "Shop" }
                routing {
                    get("/boom") { throw IllegalStateException("boom") }
                    get("/after") {
                        call.respondText("ok")
                        throw IllegalStateException("after")
                    }
                }
            }
        val plain = client {}
        runBlocking {
            assertEquals(HttpStatusCode.InternalServerError, plain.get("http://localhost:$port/boom").status)
            assertEquals("ok", plain.get("http://localhost:$port/after").bodyAsText())
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /boom", "IllegalStateException", "GET /after", "200 OK"), drawn.labels, drawn.json)
    }

    @Test
    fun `a redirect made while serving a call drops the parent span it copied, and another host gets only the call id`() {
        val scenario = start()
        val seen = mutableListOf<Pair<String, Headers>>()
        val engine =
            MockEngine { request ->
                seen += request.url.host to request.headers
                when (request.url.host) {
                    "localhost" -> respond("", HttpStatusCode.Found, headersOf(HttpHeaders.Location, "http://127.0.0.1:8089/next"))
                    "127.0.0.1" -> respond("", HttpStatusCode.Found, headersOf(HttpHeaders.Location, "https://payments.example.com/new"))
                    else -> respond("paid")
                }
            }
        val payments = HttpClient(engine) { install(LsdClient) }.also { clients += it }
        testApplication {
            application {
                install(Lsd) { app = "Shop" }
                routing { get("/checkout") { call.respondText(payments.get("http://localhost:8089/old").bodyAsText()) } }
            }
            assertEquals("paid", client.get("/checkout").bodyAsText())
        }

        val drawn = report(scenario)
        assertEquals(listOf("localhost", "127.0.0.1", "payments.example.com"), seen.map { it.first }, drawn.json)
        val (local, redirected) = seen[0].second to seen[1].second
        assertNotNull(local[Calls.PARENT_SPAN_HEADER], "the first hop nests under the request being served: $local")
        assertEquals(1, redirected.getAll(Calls.PARENT_SPAN_HEADER)?.size, "an allowed hop gets one parent span, not the copied one too: $redirected")
        val remote = seen[2].second
        assertEquals(listOf(Calls.CALL_HEADER), remote.names().filter { Calls.isOwnHeader(it) }.map { it.lowercase() }, "only the opaque call id: $remote")
        assertEquals(1, remote.getAll(Calls.CALL_HEADER)?.size, "one fresh call id: $remote")
    }

    /**
     * Neither CIO nor `testApplication` cancels a handler when its caller goes away, so the
     * handler is cancelled as an engine that notices a dropped connection would cancel it.
     */
    @Test
    fun `a call cancelled mid-handler (its caller went away) draws no reply for the cancellation`() {
        val scenario = start()
        val served = CompletableDeferred<Unit>()
        testApplication {
            application {
                install(Lsd) { app = "Slow" }
                // Outside the server plugin, so the test waits until the plugin is done with the call.
                val outermost = PipelinePhase("Served")
                insertPhaseBefore(items.first(), outermost)
                intercept(outermost) {
                    try {
                        proceed()
                    } finally {
                        served.complete(Unit)
                    }
                }
                routing { get("/slow") { throw CancellationException("the caller went away") } }
            }
            runCatching { client.get("/slow") }
            withTimeout(5_000) { served.await() }
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /slow"), drawn.labels, drawn.json)
    }

    @Test
    fun `a saved response of exactly the body limit is shown, and one byte more is noted as too large`() {
        for (size in listOf(Bodies.LIMIT, Bodies.LIMIT + 1)) {
            val scenario = start("saved-$size")
            val port =
                serve {
                    routing {
                        get("/big") { call.respondBytesWriter(ContentType.Text.Plain) { writeFully(ByteArray(size) { 'a'.code.toByte() }) } }
                    }
                }
            val app =
                client {
                    retry()
                    lsdClient()
                }
            assertEquals(size, runBlocking { app.get("http://localhost:$port/big").bodyAsText() }.length)

            val drawn = report(scenario, "saved-$size")
            assertEquals(listOf("GET /big", "200 OK"), drawn.labels, "size $size")
            val body = drawn.messages[1].body()
            if (size == Bodies.LIMIT) {
                assertTrue(body is String && body.startsWith("aaaa"), "size $size is shown: ${body.toString().take(80)}")
            } else {
                assertEquals("larger than 256 KiB", (body as Map<*, *>)["notShown"], "size $size: $body")
            }
        }
    }
}
