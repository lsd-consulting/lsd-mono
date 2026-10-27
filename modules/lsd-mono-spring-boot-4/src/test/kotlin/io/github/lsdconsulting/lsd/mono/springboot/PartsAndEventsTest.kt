package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.core.io.buffer.DataBuffer
import org.springframework.core.io.buffer.DataBufferUtils
import org.springframework.core.io.buffer.DefaultDataBufferFactory
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.client.ClientHttpRequestExecution
import org.springframework.http.codec.multipart.Part
import org.springframework.http.server.reactive.HttpHandler
import org.springframework.mock.env.MockEnvironment
import org.springframework.mock.http.client.MockClientHttpRequest
import org.springframework.mock.http.client.MockClientHttpResponse
import org.springframework.mock.http.server.reactive.MockServerHttpRequest
import org.springframework.mock.http.server.reactive.MockServerHttpResponse
import org.springframework.web.reactive.function.client.ClientRequest
import org.springframework.web.reactive.function.client.ClientResponse
import org.springframework.web.server.WebHandler
import org.springframework.web.server.adapter.WebHttpHandlerBuilder
import reactor.core.publisher.Flux
import reactor.core.publisher.Mono
import java.io.ByteArrayOutputStream
import java.net.URI
import java.util.concurrent.atomic.AtomicReference

/**
 * A WebFlux multipart request drawn as its parts as the app reads it, and an event stream read
 * through a `RestClient` or `RestTemplate` drawn as its events, still streaming; and the scenario a
 * `WebTestClient` request carries.
 */
@LsdTestConfig(deterministicIds = true)
class PartsAndEventsTest {
    private val names = ParticipantNames(MockEnvironment().withProperty("spring.application.name", "shop"))
    private val started = mutableListOf<LsdScenario>()

    @BeforeEach
    @AfterEach
    fun clear() {
        started.forEach(SpringScenarios::finished)
        started.clear()
        LsdContext.instance.clear()
    }

    private fun start(): LsdScenario =
        LsdContext.instance.beginScenario(reportKey = KEY, key = KEY, bindCurrentThread = true).also {
            SpringScenarios.started(it)
            started += it
        }

    private fun report(scenario: LsdScenario): ScenarioJson {
        SpringScenarios.finished(scenario)
        scenario.complete(KEY)
        return ReportJson.read(LsdContext.instance.completeReport(KEY, KEY).reportJson).scenario(KEY)
    }

    private fun multipart(invoice: ByteArray): ByteArray =
        ByteArrayOutputStream()
            .apply {
                write(
                    "--b0\r\nContent-Disposition: form-data; name=\"invoice\"; filename=\"invoice-7.pdf\"\r\nContent-Type: application/pdf\r\n\r\n"
                        .toByteArray(),
                )
                write(invoice)
                write("\r\n--b0\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nleave it with the neighbour\r\n--b0--\r\n".toByteArray())
            }.toByteArray()

    /** [bytes] sent in [chunk]-sized buffers, with no content length, as WebClient sends a multipart body. */
    private fun upload(
        scenario: LsdScenario,
        bytes: ByteArray,
        chunk: Int = 1024,
    ): MockServerHttpRequest {
        val buffers =
            (bytes.indices step chunk).map { DefaultDataBufferFactory.sharedInstance.wrap(bytes.copyOfRange(it, minOf(it + chunk, bytes.size))) }
        return MockServerHttpRequest
            .post("http://localhost:8080/orders/order-7/documents")
            .header(LsdHeaders.SCENARIO, scenario.correlationId)
            .contentType(MediaType.parseMediaType("multipart/form-data; boundary=b0"))
            .body(Flux.fromIterable<DataBuffer>(buffers))
    }

    /** The app, behind the starter's filter, with the server handler decorated as the starter decorates it. */
    private fun app(
        web: WebHandler,
        readParts: Boolean = true,
    ): HttpHandler = ErrorCapturingResponse.decorate(WebHttpHandlerBuilder.webHandler(web).filter(LsdWebFilter(names)).build(), readParts)

    private fun reads(seen: AtomicReference<ByteArray>) =
        WebHandler { exchange ->
            DataBufferUtils.join(exchange.request.body).flatMap { joined ->
                seen.set(ByteArray(joined.readableByteCount()).also(joined::read))
                DataBufferUtils.release(joined)
                exchange.response.statusCode = HttpStatus.CREATED
                exchange.response.setComplete()
            }
        }

    private fun parts(drawn: ScenarioJson) = drawn
        .message("POST /orders/order-7/documents")
        .obj("data")
        ?.obj("body")
        ?.objects("parts")
        .orEmpty()

    @Test
    fun `a chunked multipart request is drawn as its parts, never their contents, and the app reads every byte`() {
        val scenario = start()
        val body = multipart("%PDF-1.7 an invoice for order-7".toByteArray())
        val seen = AtomicReference<ByteArray>()

        app(reads(seen)).handle(upload(scenario, body, chunk = 16), MockServerHttpResponse()).block()

        assertArrayEquals(body, seen.get())
        val drawn = report(scenario)
        val parts = parts(drawn)
        assertEquals(listOf("invoice", "note"), parts.map { it["name"] }, drawn.json)
        assertEquals("invoice-7.pdf", parts.first()["filename"], drawn.json)
        assertEquals("application/pdf", parts.first()["contentType"], drawn.json)
        assertEquals(31.0, parts.first()["size"], drawn.json)
        assertEquals(false, drawn.json.contains("%PDF"), drawn.json)
    }

    @Test
    fun `a multipart body larger than the limit is drawn from its head, marked truncated, and still reaches the app whole`() {
        val scenario = start()
        val body = multipart(ByteArray(300 * 1024) { 'x'.code.toByte() })
        val seen = AtomicReference<ByteArray>()

        app(reads(seen)).handle(upload(scenario, body, chunk = 8192), MockServerHttpResponse()).block()

        assertArrayEquals(body, seen.get())
        val drawn = report(scenario)
        assertEquals(listOf("invoice"), parts(drawn).map { it["name"] }, drawn.json)
        assertEquals(
            true,
            drawn
                .message("POST /orders/order-7/documents")
                .obj("data")
                ?.obj("body")
                ?.get("truncated"),
            drawn.json,
        )
    }

    @Test
    fun `the parts reach the app's multipart reader, and a body the app never reads is still drawn`() {
        val scenario = start()
        val names = AtomicReference<Set<String>>()
        val multipart =
            WebHandler { exchange ->
                exchange.multipartData.flatMap { parts ->
                    names.set(parts.keys)
                    Flux.fromIterable(parts.values.flatten()).flatMap(Part::delete).then(exchange.response.setComplete())
                }
            }

        app(multipart).handle(upload(scenario, multipart("pdf".toByteArray())), MockServerHttpResponse()).block()
        app(WebHandler { it.response.setComplete() }).handle(upload(scenario, multipart("pdf".toByteArray())), MockServerHttpResponse()).block()

        assertEquals(setOf("invoice", "note"), names.get())
        val drawn = report(scenario)
        val requests = drawn.messages.filter { it["label"] == "POST /orders/order-7/documents" }
        assertEquals(2, requests.size, drawn.json)
        requests.forEach {
            assertEquals(
                2,
                it
                    .obj("data")
                    ?.obj("body")
                    ?.objects("parts")
                    ?.size,
                drawn.json,
            )
        }
    }

    @Test
    fun `with parts turned off, a multipart request is drawn without them and passed through untouched`() {
        val scenario = start()
        val body = multipart("pdf".toByteArray())
        val seen = AtomicReference<ByteArray>()

        app(reads(seen), readParts = false).handle(upload(scenario, body), MockServerHttpResponse()).block()

        assertArrayEquals(body, seen.get())
        val drawn = report(scenario)
        assertNull(drawn.message("POST /orders/order-7/documents").obj("data")?.obj("body"), drawn.json)
    }

    private fun events(count: Int) = (1..count).joinToString("") { "event: scan\nid: $it\ndata: {\"depot\":\"depot-$it\"}\n\n" }.toByteArray()

    private fun courier(bytes: ByteArray) =
        ClientHttpRequestExecution { _, _ ->
            MockClientHttpResponse(bytes, HttpStatus.OK).apply { headers.contentType = MediaType.TEXT_EVENT_STREAM }
        }

    private fun scans() = MockClientHttpRequest(HttpMethod.GET, URI.create("http://courier.example/parcels/7/scans"))

    private fun streamReplies(drawn: ScenarioJson) = drawn.messages.filter { it["from"] == "courier-example" }

    @Test
    fun `an event stream read to its end is drawn once, with its events, and the app reads every byte`() {
        val scenario = start()
        val wire = events(7)

        val response = LsdClientInterceptor(names).intercept(scans(), ByteArray(0), courier(wire))
        val read = ByteArrayOutputStream()
        response.body.use { stream ->
            val buffer = ByteArray(10)
            while (true) {
                val n = stream.read(buffer, 0, buffer.size)
                if (n < 0) break
                read.write(buffer, 0, n)
            }
            assertEquals(-1, stream.read())
        }
        response.close()

        assertArrayEquals(wire, read.toByteArray())
        val drawn = report(scenario)
        val reply = streamReplies(drawn).single()
        assertEquals(7.0, reply.obj("data")?.obj("body")?.get("events"), drawn.json)
        assertEquals(
            "depot-1",
            reply
                .obj("data")
                ?.obj("body")
                ?.objects("first")
                ?.first()
                ?.obj("data")
                ?.get("depot"),
            drawn.json,
        )
    }

    @Test
    fun `an event stream closed before its end is drawn with what was read, marked truncated`() {
        val scenario = start()
        val wire = events(3)
        val firstEvent = wire.decodeToString().indexOf("\n\n") + 2

        val response = LsdClientInterceptor(names).intercept(scans(), ByteArray(0), courier(wire))
        repeat(firstEvent) { response.body.read() }
        response.close()
        response.body.close()

        val drawn = report(scenario)
        val reply = streamReplies(drawn).single()
        assertEquals(1.0, reply.obj("data")?.obj("body")?.get("events"), drawn.json)
        assertEquals(true, reply.obj("data")?.obj("body")?.get("truncated"), drawn.json)
    }

    @Test
    fun `an event stream the app never closes is not drawn`() {
        val scenario = start()

        LsdClientInterceptor(names).intercept(scans(), ByteArray(0), courier(events(2))).body.read()

        val drawn = report(scenario)
        assertEquals(listOf("GET /parcels/7/scans"), drawn.labels, drawn.json)
    }

    private fun sent(
        request: ClientRequest,
        header: AtomicReference<String?>,
    ) = LsdWebTestClient.filter().filter(request) {
        header.set(it.headers().getFirst(LsdHeaders.SCENARIO))
        Mono.just(ClientResponse.create(HttpStatus.OK).build())
    }

    @Test
    fun `a WebTestClient request carries the test's scenario, unless it already names one or there is no test`() {
        val header = AtomicReference<String?>()
        sent(ClientRequest.create(HttpMethod.GET, URI.create("/orders/7")).build(), header).block()
        assertNull(header.get(), "outside a test, nothing is added")

        val scenario = start()
        sent(ClientRequest.create(HttpMethod.GET, URI.create("/orders/7")).build(), header).block()
        assertEquals(scenario.correlationId, header.get(), "bound to the context")
        sent(ClientRequest.create(HttpMethod.GET, URI.create("http://localhost:8080/orders/7")).build(), header).block()
        assertEquals(scenario.correlationId, header.get()?.substringBefore(';'), "bound to a local server")
        sent(ClientRequest.create(HttpMethod.GET, URI.create("https://shop.example.com/orders/7")).build(), header).block()
        assertNull(header.get(), "not to a remote host")
        val own = ClientRequest.create(HttpMethod.GET, URI.create("/orders/7")).header(LsdHeaders.SCENARIO, "theirs").build()
        sent(own, header).block()
        assertEquals("theirs", header.get())
    }

    private companion object {
        const val KEY = "parts-and-events"
    }
}
