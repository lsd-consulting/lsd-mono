package io.lsdconsulting.lsd.mono.http4k

import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.http4k.Scenarios.arrow
import io.lsdconsulting.lsd.mono.http4k.Scenarios.lsd
import io.lsdconsulting.lsd.mono.http4k.Scenarios.report
import io.lsdconsulting.lsd.mono.http4k.Scenarios.start
import org.http4k.client.WebsocketClient
import org.http4k.core.HttpHandler
import org.http4k.core.Method.GET
import org.http4k.core.PolyHandler
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.Status.Companion.OK
import org.http4k.core.Uri
import org.http4k.core.then
import org.http4k.routing.bindWs
import org.http4k.routing.websockets
import org.http4k.server.Http4kServer
import org.http4k.server.Jetty
import org.http4k.server.asServer
import org.http4k.testing.testWsClient
import org.http4k.websocket.Websocket
import org.http4k.websocket.WsMessage
import org.http4k.websocket.WsResponse
import org.http4k.websocket.WsStatus
import org.http4k.websocket.then
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A WebSocket the app serves: the handshake, its messages either way, the close. */
@LsdTestConfig(deterministicIds = true)
class WebSocketTest {
    private var server: Http4kServer? = null

    @BeforeEach
    @AfterEach
    fun clear() {
        server?.stop()
        server = null
        lsd.clear()
    }

    private val closed = CountDownLatch(1)

    /** Prices: answers each sku with [quotes] prices, checking stock through [stock] first. */
    private fun prices(
        quotes: Int = 2,
        shown: Int = LsdHttp4k.DEFAULT_MESSAGES_SHOWN,
        stock: HttpHandler? = null,
    ) = LsdHttp4k.wsFilter("Prices", messagesShown = shown).then(
        websockets(
            "/prices" bindWs { _: Request ->
                WsResponse { ws: Websocket ->
                    ws.onMessage { message ->
                        val sku = message.bodyString()
                        stock?.invoke(Request(GET, "/stock/$sku"))
                        repeat(quotes) { ws.send(WsMessage("""{"sku":"$sku","price":${10 + it}}""")) }
                    }
                    ws.onClose { closed.countDown() }
                }
            },
        ),
    )

    @Test
    fun `the handshake is a call, each message an arrow, and the app's calls are drawn from it`() {
        val scenario = start()
        val stock = LsdHttp4k.clientFilter("Inventory").then { Response(OK) }
        val client = prices(stock = stock).testWsClient(Request(GET, "/prices"))

        client.send(WsMessage("lamp-01"))
        assertEquals(
            2,
            client
                .received()
                .take(2)
                .toList()
                .size,
        )
        client.close(WsStatus.NORMAL)

        val drawn = report(scenario)
        assertEquals(
            listOf(
                "GET /prices",
                "101 Switching Protocols",
                "lamp-01",
                "GET /stock/lamp-01",
                "200 OK",
                """{"sku":"lamp-01","price":10}""",
                """{"sku":"lamp-01","price":11}""",
                "close 1000 Normal",
            ),
            drawn.labels,
            drawn.json,
        )
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("GET /prices")))
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("""{"sku":"lamp-01","price":10}""")))
        assertEquals("Prices -> Inventory", drawn.arrow(drawn.message("GET /stock/lamp-01")))
    }

    @Test
    fun `a chatty socket draws the first messages and counts the rest in a note`() {
        val scenario = start()
        val client = prices(quotes = 10, shown = 3).testWsClient(Request(GET, "/prices"))

        client.send(WsMessage("desk-02"))
        client.received().take(10).toList()
        client.close(WsStatus.NORMAL)

        val drawn = report(scenario)
        assertEquals(3, drawn.labels.count { it.startsWith("desk-02") || it.startsWith("{") }, drawn.json)
        val note = drawn.eventsOf("note").single()
        assertTrue(note.source.contains("8 more WebSocket messages not drawn"), note.source)
    }

    @Test
    fun `binary messages, errors and a close from the app are drawn`() {
        val scenario = start()
        val handler =
            LsdHttp4k.wsFilter("Feed").then { _: Request ->
                WsResponse { ws: Websocket ->
                    ws.onMessage { ws.send(WsMessage(byteArrayOf(1, 2, 3))) }
                    ws.onError { }
                    ws.onMessage { if (it.bodyString() == "bye") ws.close(WsStatus(4000, "done")) }
                }
            }
        val client = handler.testWsClient(Request(GET, "/feed"))
        client.send(WsMessage("hi"))
        client.error(IllegalStateException("lost"))
        client.send(WsMessage("bye"))

        val drawn = report(scenario)
        assertEquals(
            listOf("GET /feed", "101 Switching Protocols", "hi", "binary (3 bytes)", "IllegalStateException", "bye", "binary (3 bytes)", "close 4000 done"),
            drawn.labels,
            drawn.json,
        )
        assertEquals("error", drawn.message("IllegalStateException")["status"])
        assertEquals("Feed -> Client", drawn.arrow(drawn.messages.last()))
    }

    @Test
    fun `outside a scenario the socket is the app's own`() {
        val response = prices()(Request(GET, "/prices"))
        assertTrue(response.subprotocol == null)
    }

    @Test
    fun `a real WebSocket over Jetty is drawn on the server's threads`() {
        val scenario = start(bind = false)
        server = PolyHandler(ws = prices()).asServer(Jetty(0)).start()
        val client = WebsocketClient.blocking(Uri.of("ws://localhost:${server!!.port()}/prices"), timeout = Duration.ofSeconds(5))

        client.send(WsMessage("lamp-01"))
        assertEquals(
            2,
            client
                .received()
                .take(2)
                .toList()
                .size,
        )
        client.close(WsStatus.NORMAL)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "the server saw the close")

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "101 Switching Protocols", "lamp-01"), drawn.labels.take(3), drawn.json)
        assertEquals(2, drawn.labels.count { it.startsWith("{\"sku\"") }, drawn.json)
        assertTrue(drawn.labels.last().startsWith("close 1000"), drawn.json)
    }
}
