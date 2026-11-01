package io.github.lsdconsulting.lsd.mono.http4k

import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.body
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.lsd
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.nameOf
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.report
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.start
import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import org.http4k.core.Body
import org.http4k.core.HttpHandler
import org.http4k.core.Method.GET
import org.http4k.core.Method.POST
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.Status
import org.http4k.core.Status.Companion.CREATED
import org.http4k.core.Status.Companion.OK
import org.http4k.core.then
import org.http4k.routing.bind
import org.http4k.routing.path
import org.http4k.routing.routes
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.InputStream
import java.util.concurrent.atomic.AtomicReference

/** What the filters draw for an app tested in memory, and that the app sees every byte. */
@LsdTestConfig(deterministicIds = true)
class LsdHttp4kTest {
    @BeforeEach
    @AfterEach
    fun clear() = lsd.clear()

    private val seen = AtomicReference<Request>()

    private val stock: HttpHandler = { Response(OK).header("Content-Type", "application/json").body("""{"available":true}""") }

    /** The shop: places an order, checking stock through a client filter. */
    private fun shop(inventory: HttpHandler = LsdHttp4k.serverFilter("Inventory").then(stock)): HttpHandler {
        val client = LsdHttp4k.clientFilter("Inventory").then(inventory)
        return LsdHttp4k.serverFilter("Shop").then(
            routes(
                "/orders/{sku}" bind POST to { request ->
                    seen.set(request)
                    client(Request(GET, "/stock/${request.path("sku")}"))
                    Response(CREATED).header("Content-Type", "application/json").header("X-Order", "o-1").body("""{"total":49.0}""")
                },
            ),
        )
    }

    private fun order() =
        Request(POST, "/orders/lamp-01?express=true")
            .header("Content-Type", "application/json")
            .header("X-Trace", "abc")
            .body("""{"quantity":2}""")

    @Test
    fun `a request the app serves, and the calls it makes, are drawn with bodies, status and headers`() {
        val scenario = start()

        val response = shop()(order())

        assertEquals("""{"total":49.0}""", response.bodyString())
        assertEquals("""{"quantity":2}""", seen.get().bodyString())
        val drawn = report(scenario)
        assertEquals(listOf("POST /orders/lamp-01?express=true", "GET /stock/lamp-01", "200 OK", "201 Created"), drawn.labels, drawn.json)
        val request = drawn.message("POST /orders/lamp-01?express=true")
        assertEquals(LsdHttp4k.DEFAULT_CLIENT, drawn.nameOf(request["from"]))
        assertEquals("Shop", drawn.nameOf(request["to"]))
        assertEquals(2L, ((request.body() as? JsonObject)?.get("quantity") as? Number)?.toLong(), request.source)
        assertEquals("abc", request.obj("data")?.obj("headers")?.string("X-Trace"), request.source)
        val stockCall = drawn.message("GET /stock/lamp-01")
        assertEquals("Shop", drawn.nameOf(stockCall["from"]))
        assertEquals("Inventory", drawn.nameOf(stockCall["to"]))
        val created = drawn.message("201 Created")
        assertEquals("201", created["status"].toString())
        assertEquals(request["id"], created["replyTo"])
        assertEquals("call_id", created["pairing"])
        assertEquals("o-1", created.obj("data")?.obj("headers")?.string("X-Order"), created.source)
        assertFalse(drawn.json.contains("lsd-"), "LSD's own headers stay out: ${drawn.json}")
    }

    @Test
    fun `a call to a server filter in memory is drawn once, under the name the server gives itself`() {
        val scenario = start()
        val sent = AtomicReference<Request>()
        val inventory = LsdHttp4k.serverFilter("Stock service").then { r ->
            sent.set(r)
            stock(r)
        }

        shop(inventory)(order())

        val drawn = report(scenario)
        assertEquals(1, drawn.labels.count { it == "GET /stock/lamp-01" }, drawn.json)
        assertEquals("Stock service", drawn.nameOf(drawn.message("GET /stock/lamp-01")["to"]))
        assertEquals(scenario.correlationId, sent.get().header(LsdHeaders.SCENARIO), "an in-memory call carries the scenario")
        assertEquals("Shop", sent.get().header(Calls.CALLER_HEADER))
    }

    @Test
    fun `a call nobody else draws is drawn by the client filter, named by target or host`() {
        val scenario = start()
        val sent = AtomicReference<Request>()
        val payments: HttpHandler = { r ->
            sent.set(r)
            Response(Status.ACCEPTED)
        }

        LsdHttp4k.clientFilter("Payments").then(payments)(Request(POST, "/pay").body("10"))
        LsdHttp4k.clientFilter().then(payments)(Request(GET, "http://payments.example.com/status"))
        LsdHttp4k.clientFilter().then(payments)(Request(GET, "http://localhost:8089/health"))

        val drawn = report(scenario)
        assertEquals(
            listOf("Payments", "payments.example.com", "localhost:8089"),
            drawn.messages
                .filter {
                    drawn.nameOf(it["from"]) == "Client"
                }.map { drawn.nameOf(it["to"]) },
        )
        assertEquals("202 Accepted", drawn.labels[1])
        assertEquals(scenario.correlationId, sent.get().header(LsdHeaders.SCENARIO))
    }

    @Test
    fun `only allowed hosts are sent the scenario`() {
        start()
        val sent = AtomicReference<Request>()
        LsdHttp4k.clientFilter().then { r ->
            sent.set(r)
            Response(OK)
        }(Request(GET, "https://api.example.com/rates"))
        assertNull(sent.get().header(LsdHeaders.SCENARIO))
        assertNull(sent.get().header(Calls.CALLER_HEADER))
        assertNull(sent.get().header(Calls.CALL_HEADER))
    }

    @Test
    fun `an exception is drawn as an error reply and still thrown, by the server and the client`() {
        val scenario = start()
        val broken = LsdHttp4k.serverFilter("Shop").then { throw IllegalStateException("boom") }
        assertThrows(IllegalStateException::class.java) { broken(order()) }
        val offline = LsdHttp4k.clientFilter("Rates").then { throw java.net.ConnectException("refused") }
        assertThrows(java.net.ConnectException::class.java) { offline(Request(GET, "/rates")) }

        val drawn = report(scenario)
        assertEquals(listOf("POST /orders/lamp-01?express=true", "IllegalStateException", "GET /rates", "ConnectException"), drawn.labels, drawn.json)
        val error = drawn.message("IllegalStateException")
        assertEquals("error", error["status"])
        assertEquals(drawn.message("POST /orders/lamp-01?express=true")["id"], error["replyTo"])
        assertEquals("call_id", error["pairing"])
        assertTrue(error.source.contains("boom"), error.source)
        assertEquals("Rates", drawn.nameOf(drawn.message("ConnectException")["from"]))
    }

    @Test
    fun `outside a scenario everything passes through untouched`() {
        val passed = AtomicReference<Request>()
        val request = order()
        LsdHttp4k.serverFilter().then { r ->
            passed.set(r)
            Response(OK)
        }(request)
        assertSame(request, passed.get())
        LsdHttp4k.clientFilter().then { r ->
            passed.set(r)
            Response(OK)
        }(request)
        assertSame(request, passed.get())
    }

    @Test
    fun `a filter applied twice draws once`() {
        val scenario = start()
        val server = LsdHttp4k.serverFilter("Shop")
        val client = LsdHttp4k.clientFilter("Inventory")
        server.then(server).then { Response(OK) }(order())
        client.then(client).then { Response(OK) }(Request(GET, "/stock"))

        assertEquals(listOf("POST /orders/lamp-01?express=true", "200 OK", "GET /stock", "200 OK"), report(scenario).labels)
    }

    @Test
    fun `an unbound scenario is found when it is the only one running, and two running are told apart by header`() {
        val first = start("first", bind = false)
        val app = LsdHttp4k.serverFilter("Shop").then { Response(OK) }
        app(Request(GET, "/one"))
        val second = start("second", bind = false)
        app(Request(GET, "/nobody"))
        app(Request(GET, "/two").header(LsdHeaders.SCENARIO, second.correlationId))

        assertEquals(listOf("GET /one", "200 OK"), report(first, "first").labels)
        assertEquals(listOf("GET /two", "200 OK"), report(second, "second").labels)
    }

    @Test
    fun `a body the filters cannot read is left out, and the app still gets it`() {
        val scenario = start()
        val unreadable =
            object : Body {
                override val stream: InputStream get() = "kept".byteInputStream()
                override val payload get() = java.nio.ByteBuffer.wrap("kept".toByteArray())
                override val length: Long get() = throw IllegalStateException("no length")

                override fun close() = Unit
            }
        val got = AtomicReference<String>()
        LsdHttp4k.serverFilter("Shop").then { r ->
            got.set(
                r.body.stream
                    .readAllBytes()
                    .decodeToString(),
            )
            Response(OK)
        }(Request(POST, "/x").body(unreadable))

        assertEquals("kept", got.get())
        assertEquals(listOf("POST /x", "200 OK"), report(scenario).labels)
    }

    @Test
    fun `names and labels`() {
        assertEquals("201 Created", Calls.statusLabel(CREATED))
        assertEquals("599", Calls.statusLabel(Status(599, "")))
        assertEquals("GET /", Calls.label(Request(GET, "")))
        assertEquals(
            "Downstream",
            ClientFilter.nameOf(
                org.http4k.core.Uri
                    .of("/x"),
            ),
        )
        assertEquals(
            "127.0.0.1:9000",
            ClientFilter.nameOf(
                org.http4k.core.Uri
                    .of("http://127.0.0.1:9000/x"),
            ),
        )
        assertEquals(
            "localhost",
            ClientFilter.nameOf(
                org.http4k.core.Uri
                    .of("http://localhost/x"),
            ),
        )
        assertThrows(IllegalArgumentException::class.java) { LsdHttp4k.wsFilter(messagesShown = -1) }
    }
}
