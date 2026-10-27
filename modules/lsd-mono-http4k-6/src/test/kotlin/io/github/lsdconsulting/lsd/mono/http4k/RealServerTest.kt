package io.github.lsdconsulting.lsd.mono.http4k

import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.arrow
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.lsd
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.report
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.start
import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import org.http4k.client.JavaHttpClient
import org.http4k.core.Method.GET
import org.http4k.core.Method.POST
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.Status.Companion.CREATED
import org.http4k.core.Status.Companion.OK
import org.http4k.core.then
import org.http4k.routing.bind
import org.http4k.routing.routes
import org.http4k.server.Http4kServer
import org.http4k.server.SunHttp
import org.http4k.server.asServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.atomic.AtomicReference

/** The same filters on a real server and a real client: requests on the server's own threads. */
@LsdTestConfig(deterministicIds = true)
class RealServerTest {
    private val servers = mutableListOf<Http4kServer>()

    @BeforeEach
    @AfterEach
    fun clear() {
        servers.forEach { it.stop() }
        servers.clear()
        lsd.clear()
    }

    private fun serve(app: org.http4k.core.HttpHandler): String {
        val server = app.asServer(SunHttp(0)).start()
        servers += server
        return "http://localhost:${server.port()}"
    }

    @Test
    fun `a call over a socket to a server filter is drawn once, by the server, nested as it happens`() {
        val scenario = start()
        val inventory = serve(LsdHttp4k.serverFilter("Inventory").then { Response(OK).body("""{"available":true}""") })
        val inventoryClient = LsdHttp4k.clientFilter().then(JavaHttpClient())
        val shop =
            serve(
                LsdHttp4k.serverFilter("Shop").then(
                    routes(
                        "/orders" bind POST to {
                            inventoryClient(Request(GET, "$inventory/stock/lamp-01"))
                            Response(CREATED).body("""{"total":49.0}""")
                        },
                    ),
                ),
            )
        val testClient = LsdHttp4k.clientFilter("Shop").then(JavaHttpClient())

        val response = testClient(Request(POST, "$shop/orders").body("""{"quantity":2}"""))

        assertEquals("""{"total":49.0}""", response.bodyString())
        val drawn = report(scenario)
        assertEquals(listOf("POST /orders", "GET /stock/lamp-01", "200 OK", "201 Created"), drawn.labels, drawn.json)
        assertEquals("Client -> Shop", drawn.arrow(drawn.message("POST /orders")))
        assertEquals("Shop -> Inventory", drawn.arrow(drawn.message("GET /stock/lamp-01")))
        assertEquals("Inventory -> Shop", drawn.arrow(drawn.message("200 OK")))
    }

    @Test
    fun `a server called by a plain client draws into the only scenario running, or the one its header names`() {
        val seen = AtomicReference<String>()
        val shop =
            serve(
                LsdHttp4k.serverFilter("Shop").then { request ->
                    seen.set(request.bodyString())
                    Response(OK).body("ok")
                },
            )
        val only = start("only", bind = false)
        JavaHttpClient()(Request(POST, "$shop/one").body("first"))
        assertEquals("first", seen.get(), "the app reads the body the filter showed")
        val other = start("other", bind = false)
        JavaHttpClient()(Request(GET, "$shop/two").header(LsdHeaders.SCENARIO, other.correlationId))

        assertEquals(listOf("POST /one", "200 OK"), report(only, "only").labels)
        assertEquals(listOf("GET /two", "200 OK"), report(other, "other").labels)
    }

    @Test
    fun `a client call to a real server without a server filter is drawn by the client, named host and port`() {
        val scenario = start()
        val plain = serve { Response(OK) }
        LsdHttp4k.clientFilter().then(JavaHttpClient())(Request(GET, "$plain/ping"))

        val drawn = report(scenario)
        assertEquals("Client -> ${plain.removePrefix("http://")}", drawn.arrow(drawn.message("GET /ping")))
    }
}
