package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.core.testing.ScenarioJson
import org.apache.kafka.clients.producer.ProducerRecord
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.aop.framework.ProxyFactory
import org.springframework.core.io.buffer.DataBufferUtils
import org.springframework.core.io.buffer.DefaultDataBufferFactory
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.mock.env.MockEnvironment
import org.springframework.mock.http.client.reactive.MockClientHttpRequest
import org.springframework.mock.http.server.reactive.MockServerHttpRequest
import org.springframework.mock.web.server.MockServerWebExchange
import org.springframework.web.reactive.function.BodyInserter
import org.springframework.web.reactive.function.BodyInserters
import org.springframework.web.reactive.function.client.ClientRequest
import org.springframework.web.reactive.function.client.ClientResponse
import org.springframework.web.reactive.function.client.ExchangeFunction
import org.springframework.web.reactive.function.client.ExchangeStrategies
import org.springframework.web.reactive.function.client.WebClientRequestException
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.server.ServerWebExchange
import org.springframework.web.server.WebFilterChain
import reactor.core.publisher.Mono
import reactor.core.publisher.Sinks
import reactor.core.scheduler.Schedulers
import java.net.ConnectException
import java.net.URI
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Duration
import java.util.Optional
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** What the WebFlux filter and the WebClient filter draw, and that the app still sees every byte. */
@LsdTestConfig(deterministicIds = true)
class LsdWebFluxTest {
    private val names = ParticipantNames(MockEnvironment().withProperty("spring.application.name", "shop"))
    private val filter = LsdWebFilter(names)
    private val client = LsdExchangeFilter(names)
    private val started = mutableListOf<LsdScenario>()

    @BeforeEach
    @AfterEach
    fun clear() {
        started.forEach(SpringScenarios::finished)
        started.clear()
        LsdContext.instance.clear()
    }

    private fun start(
        key: String = "webflux-test",
        bind: Boolean = true,
    ): LsdScenario =
        LsdContext.instance.beginScenario(reportKey = key, key = key, bindCurrentThread = bind).also {
            SpringScenarios.started(it)
            started += it
        }

    private fun report(
        scenario: LsdScenario,
        key: String = "webflux-test",
    ): ScenarioJson {
        SpringScenarios.finished(scenario)
        scenario.complete(key)
        return ReportJson.read(LsdContext.instance.completeReport(key, key).reportJson).scenario(key)
    }

    private fun bytes(text: String) = DefaultDataBufferFactory.sharedInstance.wrap(text.toByteArray(UTF_8))

    private fun order(
        scenario: LsdScenario? = null,
        sku: String = "lamp-01",
    ): MockServerWebExchange {
        val request =
            MockServerHttpRequest
                .post("http://localhost:8080/orders/$sku?express=true")
                .contentType(MediaType.APPLICATION_JSON)
                .contentLength(14)
                .header(LsdHeaders.SCENARIO, scenario?.correlationId ?: "")
                .header("X-Trace", "abc")
                .body("""{"quantity":2}""")
        return MockServerWebExchange.from(request)
    }

    /** A handler that reads the request body and answers [status] with [reply]. */
    private fun handler(
        status: HttpStatus = HttpStatus.CREATED,
        reply: String = """{"total":49.0}""",
        seen: AtomicReference<String>? = null,
    ) = WebFilterChain { exchange ->
        DataBufferUtils.join(exchange.request.body).flatMap { body ->
            seen?.set(body.toString(UTF_8))
            DataBufferUtils.release(body)
            exchange.response.statusCode = status
            exchange.response.headers.contentType = MediaType.APPLICATION_JSON
            exchange.response.writeWith(Mono.just(bytes(reply)))
        }
    }

    @Test
    fun `a reactive request and its reply are drawn with bodies, status and timing, and the app reads every byte`() {
        val scenario = start()
        val exchange = order(scenario)
        val seen = AtomicReference<String>()

        filter.filter(exchange, handler(seen = seen)).block()

        assertEquals("""{"quantity":2}""", seen.get())
        assertEquals("""{"total":49.0}""", exchange.response.bodyAsString.block())
        val drawn = report(scenario)
        assertEquals(listOf("POST /orders/lamp-01?express=true", "201 Created"), drawn.labels, drawn.json)
        val request = drawn.message("POST /orders/lamp-01?express=true")
        assertEquals("client", request["from"])
        assertEquals("shop", request["to"])
        assertEquals(
            2,
            request
                .obj("data")
                ?.obj("body")
                ?.get("quantity")
                .toString()
                .toDouble()
                .toInt(),
            request.source,
        )
        assertEquals("abc", request.obj("data")?.obj("headers")?.string("X-Trace"), request.source)
        assertFalse(request.source.contains(LsdHeaders.SCENARIO), "LSD's own headers stay out: ${request.source}")
        val reply = drawn.message("201 Created")
        assertEquals("shop", reply["from"])
        assertEquals("201", reply["status"].toString())
        assertEquals(
            49.0,
            reply
                .obj("data")
                ?.obj("body")
                ?.get("total")
                .toString()
                .toDouble(),
            reply.source,
        )
        assertTrue(request["durationMs"] != null, "the call is timed: ${request.source}")
    }

    @Test
    fun `a status exception is drawn with its status, any other failure as 500`() {
        val missing = start()
        val notFound = WebFilterChain { Mono.error(ResponseStatusException(HttpStatus.NOT_FOUND, "no such order")) }
        runCatching { filter.filter(order(missing), notFound).block() }
        val drawnMissing = report(missing)
        assertEquals("404 Not Found", drawnMissing.labels.last(), drawnMissing.json)
        assertEquals("404", drawnMissing.message("404 Not Found")["status"].toString())

        val broken = start("broken")
        val failure = WebFilterChain { Mono.error(IllegalStateException("boom")) }
        runCatching { filter.filter(order(broken), failure).block() }
        val drawnBroken = report(broken, "broken")
        assertEquals("500 Internal Server Error", drawnBroken.labels.last(), drawnBroken.json)
        assertTrue(drawnBroken.message("500 Internal Server Error").source.contains("boom"), drawnBroken.json)
    }

    @Test
    fun `outside a scenario the exchange passes through untouched`() {
        val exchange = order()
        val passed = AtomicReference<ServerWebExchange>()
        filter.filter(exchange) { passed.set(it).let { Mono.empty() } }.block()
        assertSame(exchange, passed.get())

        val request = ClientRequest.create(HttpMethod.GET, URI.create("http://inventory/stock/lamp-01")).build()
        val sent = AtomicReference<ClientRequest>()
        client.filter(request) { sent.set(it).let { Mono.just(ClientResponse.create(HttpStatus.OK).build()) } }.block()
        assertSame(request, sent.get())
    }

    /** A server that writes the request body, as a real connector would, and answers [status] with [reply]. */
    private fun server(
        status: HttpStatus = HttpStatus.OK,
        reply: String = """{"available":true}""",
        sent: AtomicReference<ClientRequest>? = null,
        written: AtomicReference<String>? = null,
    ) = ExchangeFunction { request ->
        sent?.set(request)
        val wire = MockClientHttpRequest(request.method(), request.url())
        val context =
            object : BodyInserter.Context {
                override fun messageWriters() = ExchangeStrategies.withDefaults().messageWriters()

                override fun serverRequest() = Optional.empty<org.springframework.http.server.reactive.ServerHttpRequest>()

                override fun hints() = emptyMap<String, Any>()
            }
        request
            .body()
            .insert(wire, context)
            .then(Mono.defer { wire.bodyAsString.defaultIfEmpty("") })
            .map { body ->
                written?.set(body)
                ClientResponse
                    .create(status)
                    .header("Content-Type", "application/json")
                    .body(reply)
                    .build()
            }
    }

    @Test
    fun `a WebClient call is drawn with both bodies, the app still reads the reply, and the scenario travels on`() {
        val scenario = start()
        // Only allowed hosts (localhost by default) are sent the scenario.
        val request =
            ClientRequest
                .create(HttpMethod.POST, URI.create("http://localhost:8081/quotes?currency=GBP"))
                .body(BodyInserters.fromValue(mapOf("sku" to "lamp-01")))
                .build()
        val sent = AtomicReference<ClientRequest>()
        val written = AtomicReference<String>()

        val body =
            client
                .filter(request, server(reply = """{"total":49.0}""", sent = sent, written = written))
                .flatMap { it.bodyToMono(String::class.java) }
                .block()

        assertEquals("""{"total":49.0}""", body)
        assertEquals("""{"sku":"lamp-01"}""", written.get())
        assertEquals(scenario.correlationId, sent.get().headers().getFirst(LsdHeaders.SCENARIO))
        assertEquals("Client", sent.get().headers().getFirst(SpringScenarios.CALLER_HEADER))
        val drawn = report(scenario)
        assertEquals(listOf("POST /quotes?currency=GBP", "200 OK"), drawn.labels, drawn.json)
        val call = drawn.message("POST /quotes?currency=GBP")
        assertEquals("client", call["from"])
        assertTrue(call["to"] !in listOf("client", "shop"), call.source)
        assertEquals("lamp-01", call.obj("data")?.obj("body")?.string("sku"), call.source)
        assertFalse(call.source.contains(LsdHeaders.SCENARIO), call.source)
        assertEquals(
            49.0,
            drawn
                .message("200 OK")
                .obj("data")
                ?.obj("body")
                ?.get("total")
                .toString()
                .toDouble(),
            drawn.json,
        )
    }

    @Test
    fun `an error status is drawn as itself, and a connection failure as an error`() {
        val scenario = start()
        val get = ClientRequest.create(HttpMethod.GET, URI.create("http://tracking:8082/parcels/order-404")).build()
        client
            .filter(get, server(HttpStatus.NOT_FOUND, """{"error":"unknown parcel"}"""))
            .flatMap { it.bodyToMono(String::class.java) }
            .block()
        val refused =
            ExchangeFunction { request ->
                Mono.error(WebClientRequestException(ConnectException("Connection refused"), request.method(), request.url(), request.headers()))
            }
        runCatching { client.filter(get, refused).block() }

        val drawn = report(scenario)
        assertEquals(
            listOf("GET /parcels/order-404", "404 Not Found", "GET /parcels/order-404", "ConnectException"),
            drawn.labels,
            drawn.json,
        )
        assertEquals(
            "unknown parcel",
            drawn
                .message("404 Not Found")
                .obj("data")
                ?.obj("body")
                ?.string("error"),
            drawn.json,
        )
        assertEquals(listOf("404", "error"), drawn.messages.filter { it["type"] == "SYNCHRONOUS_RESPONSE" }.map { it["status"].toString() }, drawn.json)
    }

    @Test
    fun `calls to this app itself are left to its own filter`() {
        val self = LsdExchangeFilter(ParticipantNames(MockEnvironment().withProperty("local.server.port", "8080")))
        val scenario = start()
        self
            .filter(ClientRequest.create(HttpMethod.GET, URI.create("http://localhost:8080/health")).build(), server())
            .block()
        assertEquals(emptyList<String>(), report(scenario).labels)
    }

    @Test
    fun `the request served travels in Reactor's context, so a WebClient call after scheduler hops nests under it in its own scenario`() {
        // Two tests in flight and neither bound to this thread: only the context can say which is which.
        val other = start("other", bind = false)
        val scenario = start("hopping", bind = false)
        assertNull(SpringScenarios.resolve())
        val threads = mutableListOf<String>()
        val chain =
            WebFilterChain { exchange ->
                Mono
                    .delay(Duration.ofMillis(5))
                    .publishOn(Schedulers.boundedElastic())
                    .doOnNext { threads += Thread.currentThread().name }
                    .flatMap {
                        client.filter(ClientRequest.create(HttpMethod.GET, URI.create("http://inventory:8083/stock/lamp-01")).build(), server())
                    }.flatMap { it.bodyToMono(String::class.java) }
                    .then(Mono.defer { exchange.response.setComplete() })
            }
        val exchange = order(scenario)

        filter.filter(exchange, chain).block()

        assertTrue(threads.single().startsWith("boundedElastic"), threads.toString())
        val drawn = report(scenario, "hopping")
        assertEquals(listOf("POST /orders/lamp-01?express=true", "GET /stock/lamp-01", "200 OK", "200 OK"), drawn.labels, drawn.json)
        val inbound = drawn.message("POST /orders/lamp-01?express=true")
        val call = drawn.message("GET /stock/lamp-01")
        assertEquals("shop", call["from"], drawn.json)
        assertEquals(inbound["id"], call["parentId"], drawn.json)
        assertEquals(inbound["callId"], call.obj("trace")?.get("parentSpanId"), drawn.json)
        assertEquals(emptyList<String>(), report(other, "other").labels)
    }

    @Test
    fun `nothing is drawn or entered until the server subscribes`() {
        val scenario = start()
        val served = filter.filter(order(scenario), handler())

        assertNull(SpringScenarios.serving(scenario), "assembling the chain serves nothing")
        served.block()

        assertNull(SpringScenarios.serving(scenario), "the request is left once answered")
        val drawn = report(scenario)
        assertEquals(listOf("POST /orders/lamp-01?express=true", "201 Created"), drawn.labels, drawn.json)
    }

    /** A Spring Data repository, as the starter's post-processor proxies one. */
    fun interface Orders {
        fun save(sku: String): String
    }

    @Test
    fun `a repository call and a Kafka send a reactive handler makes are the app's, nested under the request it serves`() {
        val scenario = start()
        val orders =
            ProxyFactory(Orders { it.uppercase() })
                .apply { addAdvice(LsdRepositoryInterceptor(Orders::class.java) { names }) }
                .proxy as Orders
        val kafka = LsdKafkaProducerInterceptor().apply { configure(mapOf(KafkaCapture.APP_CONFIG to "shop")) }
        val chain =
            WebFilterChain { exchange ->
                Mono
                    .fromCallable { orders.save("lamp-01") }
                    .doOnNext { kafka.onSend(ProducerRecord<Any?, Any?>("orders.placed", "lamp-01", "{}")) }
                    .then(Mono.defer { exchange.response.setComplete() })
            }

        filter.filter(order(scenario), chain).block()

        val drawn = report(scenario)
        val inbound = drawn.message("POST /orders/lamp-01?express=true")
        for (label in listOf("save(\"lamp-01\")", "publish \"lamp-01\"")) {
            val call = drawn.message(label)
            assertEquals("shop", call["from"], "$label is the app's: ${drawn.json}")
            assertEquals(inbound["callId"], call.obj("trace")?.get("parentSpanId"), "$label nests under the request: ${drawn.json}")
        }
    }

    @Test
    fun `two requests served at once in one scenario each keep their own WebClient calls, and both are left when answered`() {
        val scenario = start()
        val gate = Sinks.empty<Void>()

        fun chain(sku: String) =
            WebFilterChain { exchange ->
                gate
                    .asMono()
                    .then(Mono.delay(Duration.ofMillis(5)))
                    .publishOn(Schedulers.boundedElastic())
                    .flatMap { client.filter(ClientRequest.create(HttpMethod.GET, URI.create("http://inventory:8083/stock/$sku")).build(), server()) }
                    .flatMap { it.bodyToMono(String::class.java) }
                    .then(Mono.defer { exchange.response.setComplete() })
            }

        val lamp = filter.filter(order(scenario, "lamp-01"), chain("lamp-01")).toFuture()
        val desk = filter.filter(order(scenario, "desk-02"), chain("desk-02")).toFuture()
        assertTrue(SpringScenarios.serving(scenario) != null, "both requests are being served")
        gate.tryEmitEmpty()
        lamp.get(5, TimeUnit.SECONDS)
        desk.get(5, TimeUnit.SECONDS)

        assertNull(SpringScenarios.serving(scenario), "both requests are left once answered")
        val drawn = report(scenario)
        for (sku in listOf("lamp-01", "desk-02")) {
            val inbound = drawn.message("POST /orders/$sku?express=true")
            val call = drawn.message("GET /stock/$sku")
            assertEquals("shop", call["from"], drawn.json)
            assertEquals(inbound["id"], call["parentId"], "$sku's call nests under its own request: ${drawn.json}")
            assertEquals(inbound["callId"], call.obj("trace")?.get("parentSpanId"), drawn.json)
        }
    }

    @Test
    fun `a request the client gives up on is drawn as cancelled, not as a status it never sent, and is left`() {
        val scenario = start()
        val subscription = filter.filter(order(scenario), { Mono.never() }).subscribe()
        assertTrue(SpringScenarios.serving(scenario) != null)
        subscription.dispose()

        assertNull(SpringScenarios.serving(scenario))
        val drawn = report(scenario)
        assertEquals(listOf("POST /orders/lamp-01?express=true", "cancelled"), drawn.labels, drawn.json)
        assertEquals("cancelled", drawn.message("cancelled")["status"].toString(), drawn.json)
        assertEquals("success", drawn.status, "a client going away is not the app's error: ${drawn.json}")
    }

    @Test
    fun `a chain that throws instead of returning a Mono still gets a reply and leaves the request`() {
        val scenario = start()
        runCatching { filter.filter(order(scenario)) { throw IllegalStateException("boom") }.block() }

        assertNull(SpringScenarios.serving(scenario))
        assertEquals("500 Internal Server Error", report(scenario).labels.last())
    }
}
