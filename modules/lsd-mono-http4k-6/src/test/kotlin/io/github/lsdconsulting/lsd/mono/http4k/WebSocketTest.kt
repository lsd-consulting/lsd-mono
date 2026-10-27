package io.github.lsdconsulting.lsd.mono.http4k

import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.arrow
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.body
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.lsd
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.report
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.start
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
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
import org.junit.jupiter.api.Assertions.assertThrows
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
                "text message",
                "GET /stock/lamp-01",
                "200 OK",
                "text message",
                "text message",
                "close 1000 Normal",
            ),
            drawn.labels,
            drawn.json,
        )
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("GET /prices")))
        assertEquals(
            listOf("Client -> Prices", "Prices -> Client", "Prices -> Client"),
            drawn.messages.filter { it["label"] == "text message" }.map { drawn.arrow(it) },
        )
        assertEquals("lamp-01", drawn.messages.first { it["label"] == "text message" }.body(), "the text is in the popup, not the label")
        assertEquals("Prices -> Inventory", drawn.arrow(drawn.message("GET /stock/lamp-01")))
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("close 1000 Normal")), "the client closed it")
    }

    @Test
    fun `after the cap, the app's calls are not nested under the last message drawn`() {
        val scenario = start()
        val stock = LsdHttp4k.clientFilter("Inventory").then { Response(OK) }
        val client = prices(quotes = 0, shown = 1, stock = stock).testWsClient(Request(GET, "/prices"))

        client.send(WsMessage("lamp-01"))
        client.send(WsMessage("desk-02"))
        client.close(WsStatus.NORMAL)

        val drawn = report(scenario)
        val first = drawn.message("GET /stock/lamp-01").obj("trace")?.string("parentSpanId")
        val second = drawn.message("GET /stock/desk-02").obj("trace")?.string("parentSpanId")
        assertTrue(first != null && second != null && first != second, drawn.json)
    }

    @Test
    fun `no messages shown still draws the handshake, the count and the close, and a negative count is refused`() {
        val scenario = start()
        val client = prices(quotes = 2, shown = 0).testWsClient(Request(GET, "/prices"))
        client.send(WsMessage("lamp-01"))
        client.received().take(2).toList()
        client.close(WsStatus.NORMAL)

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "101 Switching Protocols", "close 1000 Normal"), drawn.labels, drawn.json)
        assertTrue(
            drawn
                .eventsOf("note")
                .single()
                .source
                .contains("3 more WebSocket messages not drawn"),
            drawn.json,
        )
        assertThrows(IllegalArgumentException::class.java) { LsdHttp4k.wsFilter("Prices", messagesShown = -1) }
    }

    @Test
    fun `messages after the close are not drawn`() {
        val scenario = start()
        val handler =
            LsdHttp4k.wsFilter("Feed").then { _: Request ->
                WsResponse { ws: Websocket ->
                    ws.onMessage {
                        ws.close(WsStatus.NORMAL)
                        ws.send(WsMessage("too late"))
                    }
                }
            }
        handler.testWsClient(Request(GET, "/feed")).send(WsMessage("hi"))

        val drawn = report(scenario)
        assertEquals(listOf("GET /feed", "101 Switching Protocols", "text message", "close 1000 Normal"), drawn.labels, drawn.json)
        assertEquals("Feed -> Client", drawn.arrow(drawn.message("close 1000 Normal")))
    }

    @Test
    fun `a text message over the limit is noted as not shown`() {
        val scenario = start()
        val text = "x".repeat(Bodies.LIMIT + 1)
        val handler = LsdHttp4k.wsFilter("Feed").then { _: Request -> WsResponse { ws: Websocket -> ws.onMessage { } } }
        handler.testWsClient(Request(GET, "/feed")).send(WsMessage(text))

        val drawn = report(scenario)
        val message = drawn.message("text message")
        assertEquals(
            mapOf("notShown" to "larger than 256 KiB", "size" to (Bodies.LIMIT + 1).toLong()),
            (message.body() as Map<*, *>).mapValues { (_, v) -> if (v is Number) v.toLong() else v },
            message.source,
        )
    }

    @Test
    fun `a chatty socket draws the first messages and counts the rest in a note`() {
        val scenario = start()
        val client = prices(quotes = 10, shown = 3).testWsClient(Request(GET, "/prices"))

        client.send(WsMessage("desk-02"))
        client.received().take(10).toList()
        client.close(WsStatus.NORMAL)

        val drawn = report(scenario)
        assertEquals(3, drawn.labels.count { it == "text message" }, drawn.json)
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
            listOf(
                "GET /feed",
                "101 Switching Protocols",
                "text message",
                "binary (3 bytes)",
                "IllegalStateException",
                "text message",
                "binary (3 bytes)",
                "close 4000 done",
            ),
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
        assertEquals(listOf("GET /prices", "101 Switching Protocols", "text message"), drawn.labels.take(3), drawn.json)
        assertEquals(3, drawn.labels.count { it == "text message" }, drawn.json)
        assertTrue(drawn.labels.last().startsWith("close 1000"), drawn.json)
    }
}
