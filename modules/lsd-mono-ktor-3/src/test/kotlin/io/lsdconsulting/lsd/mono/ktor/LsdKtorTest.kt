package io.lsdconsulting.lsd.mono.ktor

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.contentType
import io.ktor.server.application.install
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.receiveText
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.ktor.Scenarios.arrow
import io.lsdconsulting.lsd.mono.ktor.Scenarios.body
import io.lsdconsulting.lsd.mono.ktor.Scenarios.lsd
import io.lsdconsulting.lsd.mono.ktor.Scenarios.nameOf
import io.lsdconsulting.lsd.mono.ktor.Scenarios.report
import io.lsdconsulting.lsd.mono.ktor.Scenarios.start
import io.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.ConnectException
import java.util.concurrent.atomic.AtomicReference

/** What the plugins draw for an app under testApplication, and that the app sees every byte. */
@LsdTestConfig(deterministicIds = true)
class LsdKtorTest {
    @BeforeEach
    @AfterEach
    fun clear() = lsd.clear()

    private val json = ContentType.Application.Json

    /** Inventory, outside the app: drawn by the shop's client unless it has the server plugin itself. */
    private fun ApplicationTestBuilder.inventory(
        name: String? = null,
        sent: AtomicReference<Headers> = AtomicReference(),
    ) = externalServices {
        hosts("http://inventory") {
            name?.let { app -> install(Lsd) { this.app = app } }
            routing {
                get("/stock/{sku}") {
                    sent.set(call.request.headers)
                    call.respondText("""{"available":true}""", json)
                }
            }
        }
    }

    /** The shop: places an order, checking stock through the client plugin. */
    private fun ApplicationTestBuilder.shop(seen: AtomicReference<String> = AtomicReference()) {
        val inventory = createClient { install(LsdClient) { target = "Inventory" } }
        application {
            install(Lsd) { app = "Shop" }
            routing {
                post("/orders/{sku}") {
                    seen.set(call.receiveText())
                    inventory.get("http://inventory/stock/${call.parameters["sku"]}").bodyAsText()
                    call.response.header("X-Order", "o-1")
                    call.respondText("""{"total":49.0}""", json, HttpStatusCode.Created)
                }
            }
        }
    }

    private suspend fun ApplicationTestBuilder.order() =
        client.post("/orders/lamp-01?express=true") {
            contentType(json)
            header("X-Trace", "abc")
            setBody("""{"quantity":2}""")
        }

    @Test
    fun `a request the app serves, and the calls it makes, are drawn with bodies, status and headers`() {
        val scenario = start()
        val seen = AtomicReference<String>()
        testApplication {
            inventory()
            shop(seen)

            assertEquals("""{"total":49.0}""", order().bodyAsText())
        }

        assertEquals("""{"quantity":2}""", seen.get(), "the app reads the body the plugin showed")
        val drawn = report(scenario)
        assertEquals(listOf("POST /orders/lamp-01?express=true", "GET /stock/lamp-01", "200 OK", "201 Created"), drawn.labels, drawn.json)
        val request = drawn.message("POST /orders/lamp-01?express=true")
        assertEquals("Client -> Shop", drawn.arrow(request))
        assertEquals(2L, ((request.body() as? JsonObject)?.get("quantity") as? Number)?.toLong(), request.source)
        assertEquals("abc", request.obj("data")?.obj("headers")?.string("X-Trace"), request.source)
        assertEquals("Shop -> Inventory", drawn.arrow(drawn.message("GET /stock/lamp-01")))
        assertEquals("Inventory -> Shop", drawn.arrow(drawn.message("200 OK")))
        assertEquals(true, (drawn.message("200 OK").body() as? JsonObject)?.get("available"), drawn.json)
        val created = drawn.message("201 Created")
        assertEquals("201", created["status"].toString())
        assertEquals("o-1", created.obj("data")?.obj("headers")?.string("X-Order"), created.source)
        assertFalse(drawn.json.contains("lsd-"), "LSD's own headers stay out: ${drawn.json}")
    }

    @Test
    fun `a call to a server plugin in memory is drawn once, under the name the server gives itself`() {
        val scenario = start()
        val sent = AtomicReference<Headers>()
        testApplication {
            inventory("Stock service", sent)
            shop()
            order()
        }

        val drawn = report(scenario)
        assertEquals(listOf("POST /orders/lamp-01?express=true", "GET /stock/lamp-01", "200 OK", "201 Created"), drawn.labels, drawn.json)
        assertEquals("Shop -> Stock service", drawn.arrow(drawn.message("GET /stock/lamp-01")))
        assertEquals("Stock service -> Shop", drawn.arrow(drawn.message("200 OK")))
        assertEquals(scenario.correlationId, sent.get()[LsdHeaders.SCENARIO], "an in-memory call carries the scenario")
        assertEquals("Shop", sent.get()[Calls.CALLER_HEADER])
    }

    @Test
    fun `a call nobody else draws is drawn by the client plugin, named by target or host, and only allowed hosts get the scenario`() {
        val scenario = start()
        val seen = mutableMapOf<String, Headers>()
        val engine =
            MockEngine { request ->
                seen[request.url.host] = request.headers
                respond("", if (request.url.host == "localhost") HttpStatusCode.OK else HttpStatusCode.Accepted)
            }
        runBlocking {
            HttpClient(engine) { install(LsdClient) { target = "Payments" } }.get("https://payments.example.com/status")
            val plain = HttpClient(engine) { install(LsdClient) }
            plain.get("https://payments.example.com/status")
            plain.get("http://localhost:8089/health")
            plain.get("http://localhost/health")
        }

        val drawn = report(scenario)
        assertEquals(
            listOf("Payments", "payments.example.com", "localhost:8089", "localhost"),
            drawn.messages.filter { drawn.nameOf(it["from"]) == LsdKtor.DEFAULT_CLIENT }.map { drawn.nameOf(it["to"]) },
            drawn.json,
        )
        assertEquals("202 Accepted", drawn.labels[1])
        val local = seen.getValue("localhost")
        assertEquals(scenario.correlationId, local[LsdHeaders.SCENARIO])
        assertEquals(LsdKtor.DEFAULT_CLIENT, local[Calls.CALLER_HEADER])
        val remote = seen.getValue("payments.example.com")
        assertNull(remote[LsdHeaders.SCENARIO], "only allowed hosts are sent the scenario")
        assertNull(remote[Calls.CALLER_HEADER])
        assertNull(remote[Calls.CALL_HEADER])
    }

    @Test
    fun `a call that stays in memory carries the scenario to any host`() {
        val scenario = start()
        val sent = AtomicReference<Headers>()
        testApplication {
            externalServices {
                hosts("http://payments.example.com") {
                    routing {
                        get("/status") {
                            sent.set(call.request.headers)
                            call.respond(HttpStatusCode.Accepted)
                        }
                    }
                }
            }
            startApplication()
            createClient { install(LsdClient) { target = "Payments" } }.get("http://payments.example.com/status")
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /status", "202 Accepted"), drawn.labels, drawn.json)
        assertEquals(scenario.correlationId, sent.get()[LsdHeaders.SCENARIO])
    }

    @Test
    fun `an exception is drawn as an error reply and still thrown, by the server and the client`() {
        val scenario = start()
        testApplication {
            application {
                install(Lsd) { app = "Shop" }
                routing { post("/orders/{sku}") { throw IllegalStateException("boom") } }
            }
            runCatching { order() }
        }
        val offline = HttpClient(CIO) { install(LsdClient) { target = "Rates" } }
        assertThrows(ConnectException::class.java) { runBlocking { offline.get("http://127.0.0.1:1/rates") } }
        offline.close()

        val drawn = report(scenario)
        assertEquals(listOf("POST /orders/lamp-01?express=true", "IllegalStateException", "GET /rates", "ConnectException"), drawn.labels, drawn.json)
        val error = drawn.message("IllegalStateException")
        assertEquals("error", error["status"])
        assertTrue(error.source.contains("boom"), error.source)
        assertEquals("Rates -> Client", drawn.arrow(drawn.message("ConnectException")))
    }

    @Test
    fun `an exception StatusPages turns into a reply is drawn as that reply`() {
        val scenario = start()
        testApplication {
            application {
                install(StatusPages) {
                    exception<IllegalArgumentException> { call, e -> call.respondText("""{"error":"${e.message}"}""", json, HttpStatusCode.BadRequest) }
                }
                install(Lsd) { app = "Shop" }
                routing { post("/orders/{sku}") { throw IllegalArgumentException("no such sku") } }
            }
            assertEquals(HttpStatusCode.BadRequest, order().status)
        }

        val drawn = report(scenario)
        assertEquals(listOf("POST /orders/lamp-01?express=true", "400 Bad Request"), drawn.labels, drawn.json)
        assertEquals("no such sku", (drawn.message("400 Bad Request").body() as? JsonObject)?.get("error"), drawn.json)
    }

    @Test
    fun `outside a scenario everything passes through untouched`() {
        val seen = AtomicReference<String>()
        val sent = AtomicReference<Headers>()
        testApplication {
            inventory("Inventory", sent)
            shop(seen)
            assertEquals("""{"total":49.0}""", order().bodyAsText())
        }
        assertEquals("""{"quantity":2}""", seen.get())
        assertNull(sent.get()[LsdHeaders.SCENARIO])
        assertNull(sent.get()[Calls.CALL_HEADER])
        assertTrue(Calls.pending.isEmpty())
    }

    @Test
    fun `an unbound scenario is found when it is the only one running, and two running are told apart by header`() {
        val first = start("first", bind = false)
        lateinit var second: io.lsdconsulting.lsd.mono.core.LsdScenario
        testApplication {
            application {
                install(Lsd) { app = "Shop" }
                routing { get("/{path}") { call.respond(HttpStatusCode.OK) } }
            }
            client.get("/one")
            second = start("second", bind = false)
            client.get("/nobody")
            client.get("/two") { header(LsdHeaders.SCENARIO, second.correlationId) }
        }

        assertEquals(listOf("GET /one", "200 OK"), report(first, "first").labels)
        assertEquals(listOf("GET /two", "200 OK"), report(second, "second").labels)
    }

    @Test
    fun `a caller named in the header is drawn as the caller`() {
        val scenario = start()
        testApplication {
            application {
                install(Lsd) {
                    app = "Shop"
                    client = "Browser"
                }
                routing { get("/{path}") { call.respond(HttpStatusCode.NoContent) } }
            }
            client.get("/one")
            client.get("/two") { header(Calls.CALLER_HEADER, "Checkout") }
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /one", "204 No Content", "GET /two", "204 No Content"), drawn.labels, drawn.json)
        assertEquals("Browser -> Shop", drawn.arrow(drawn.message("GET /one")))
        assertEquals("Checkout -> Shop", drawn.arrow(drawn.message("GET /two")))
    }

    @Test
    fun `names and labels`() {
        assertEquals("201 Created", Calls.statusLabel(HttpStatusCode.Created))
        assertEquals("599", Calls.statusLabel(HttpStatusCode(599, "")))
        assertEquals("GET /", Calls.label("GET", "", ""))
        assertEquals("GET /a?b=1", Calls.label("GET", "/a", "b=1"))
        assertEquals("127.0.0.1:9000", ClientCapture.nameOf(Url("http://127.0.0.1:9000/x")))
        assertEquals("localhost", ClientCapture.nameOf(Url("http://localhost/x")))
        assertEquals("api.example.com", ClientCapture.nameOf(Url("https://api.example.com:8443/x")))
        assertEquals(
            mapOf("A" to "1, 2", "b" to "3"),
            Calls.headers(
                Headers.build {
                    appendAll("A", listOf("1", "2"))
                    append("lsd-call", "x")
                },
                Headers.build {
                    append("a", "9")
                    append("b", "3")
                },
            ),
        )
        assertThrows(IllegalArgumentException::class.java) { HttpClient(CIO) { install(LsdClient) { messagesShown = -1 } } }
        assertThrows(IllegalArgumentException::class.java) {
            testApplication {
                application { install(Lsd) { messagesShown = -1 } }
                startApplication()
            }
        }
    }

    @Test
    fun `a guarded capture interrupted is left out, and the thread stays interrupted`() {
        assertEquals("fallback", Calls.guarded("fallback") { throw InterruptedException("stop") })
        assertTrue(Thread.interrupted(), "the interrupt is kept for the app")
        assertEquals("again", Calls.guarded("again") { throw IllegalStateException("second warning is quieter") })
        assertThrows(StackOverflowError::class.java) { Calls.guarded("never") { throw StackOverflowError() } }
    }
}
