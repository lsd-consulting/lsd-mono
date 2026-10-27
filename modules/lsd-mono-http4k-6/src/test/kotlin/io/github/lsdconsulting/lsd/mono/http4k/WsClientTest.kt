package io.github.lsdconsulting.lsd.mono.http4k

import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.arrow
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.body
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.lsd
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.report
import io.github.lsdconsulting.lsd.mono.http4k.Scenarios.start
import io.github.lsdconsulting.lsd.mono.http4k.fixture.PriceChanged
import io.github.lsdconsulting.lsd.mono.http4k.fixture.PriceMessages
import io.github.lsdconsulting.lsd.mono.http4k.fixture.Subscribe
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import org.http4k.client.WebsocketClient
import org.http4k.core.Headers
import org.http4k.core.Method.GET
import org.http4k.core.PolyHandler
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.Status.Companion.OK
import org.http4k.core.Uri
import org.http4k.core.then
import org.http4k.lens.string
import org.http4k.routing.bindWs
import org.http4k.routing.websockets
import org.http4k.server.Http4kServer
import org.http4k.server.Jetty
import org.http4k.server.asServer
import org.http4k.testing.ClosedWebsocket
import org.http4k.testing.TestWebsocketFactory
import org.http4k.websocket.PushPullAdaptingWebSocket
import org.http4k.websocket.Websocket
import org.http4k.websocket.WebsocketFactory
import org.http4k.websocket.WsClient
import org.http4k.websocket.WsConsumer
import org.http4k.websocket.WsHandler
import org.http4k.websocket.WsMessage
import org.http4k.websocket.WsResponse
import org.http4k.websocket.WsStatus
import org.http4k.websocket.blocking
import org.http4k.websocket.nonBlocking
import org.http4k.websocket.then
import org.java_websocket.exceptions.WebsocketNotConnectedException
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.ConnectException
import java.net.ServerSocket
import java.nio.ByteBuffer
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** A WebSocket the app opens: drawn by the client, or once by the server's filter in this JVM. */
@LsdTestConfig(deterministicIds = true)
class WsClientTest {
    private var server: Http4kServer? = null

    @BeforeEach
    @AfterEach
    fun clear() {
        server?.stop()
        server = null
        lsd.clear()
    }

    private val serverClosed = CountDownLatch(1)

    /** Prices, answering each subscription with its ticks; no LSD filter of its own. */
    private val pricesApp: WsHandler =
        websockets(
            "/prices" bindWs { _: Request ->
                WsResponse { ws: Websocket ->
                    ws.onMessage { message ->
                        val subscribe = PriceMessages.subscribe(message)
                        repeat(subscribe.ticks) { ws.send(PriceMessages.priceChanged(PriceChanged(subscribe.sku, 4900 + it))) }
                        if (subscribe.sku == "bye") ws.close(WsStatus(4000, "done"))
                    }
                    ws.onClose { serverClosed.countDown() }
                }
            },
        )

    private val filtered = LsdHttp4k.wsFilter("Prices").then(pricesApp)

    private val roundTrip =
        listOf("GET /prices", "101 Switching Protocols", "Subscribe", "PriceChanged", "PriceChanged", "close 1000 Normal")

    @Test
    fun `in memory with the server's filter, the socket is drawn once, labelled with the classes`() {
        val scenario = start()
        val client = LsdHttp4k.wsClient(TestWebsocketFactory(filtered), caller = "Shop").blocking("/prices")

        client.send(PriceMessages.subscribe(Subscribe("lamp-01")))
        assertEquals(
            listOf(PriceChanged("lamp-01", 4900), PriceChanged("lamp-01", 4901)),
            client
                .received()
                .take(2)
                .map(PriceMessages.priceChanged)
                .toList(),
        )
        client.close(WsStatus.NORMAL)

        val drawn = report(scenario)
        assertEquals(roundTrip, drawn.labels, drawn.json)
        assertEquals("Shop -> Prices", drawn.arrow(drawn.message("GET /prices")))
        assertEquals("Shop -> Prices", drawn.arrow(drawn.message("Subscribe")))
        assertEquals("Prices -> Shop", drawn.arrow(drawn.messages.first { it["label"] == "PriceChanged" }))
        assertEquals(
            mapOf("sku" to "lamp-01", "ticks" to 2L),
            (drawn.message("Subscribe").body() as Map<*, *>).mapValues { (_, v) ->
                if (v is Number) v.toLong() else v
            },
            "the JSON is in the popup",
        )
    }

    @Test
    fun `in memory without a server filter, the client draws the socket to its target`() {
        val scenario = start()
        val opened = CountDownLatch(1)
        val factory = LsdHttp4k.wsClient(TestWebsocketFactory(pricesApp), target = "Prices")
        val ws = factory.nonBlocking("/prices", onConnect = { opened.countDown() })
        val received = mutableListOf<WsMessage>()
        ws.onMessage { received += it }

        ws.send(PriceMessages.subscribe(Subscribe("lamp-01")))
        ws.close(WsStatus.NORMAL)

        assertEquals(0L, opened.count, "connected")
        assertEquals(2, received.size)
        val drawn = report(scenario)
        assertEquals(roundTrip, drawn.labels, drawn.json)
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("GET /prices")))
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("101 Switching Protocols")))
        assertEquals("Prices -> Client", drawn.arrow(drawn.messages.first { it["label"] == "PriceChanged" }))
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("close 1000 Normal")))
    }

    @Test
    fun `a close from the other end, a capped socket and plain messages are drawn by the client`() {
        val scenario = start()
        val ws = LsdHttp4k.wsClient(TestWebsocketFactory(pricesApp), target = "Prices", messagesShown = 2).nonBlocking("/prices")
        ws.send(WsMessage("""{"sku":"bye","ticks":3}"""))

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "101 Switching Protocols", "text message", "PriceChanged", "close 4000 done"), drawn.labels, drawn.json)
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("close 4000 done")))
        assertTrue(
            drawn
                .eventsOf("note")
                .single()
                .source
                .contains("2 more WebSocket messages not drawn"),
            drawn.json,
        )
    }

    @Test
    fun `an error the blocking client receives is drawn and rethrown`() {
        val scenario = start()
        val client = LsdHttp4k.wsClient(TestWebsocketFactory(pricesApp), target = "Prices").blocking("/prices")
        client.send(PriceMessages.subscribe(Subscribe("bye", ticks = 0)))
        assertThrows(ClosedWebsocket::class.java) { client.received().toList() }

        val drawn = report(scenario)
        assertEquals("error", drawn.message("ClosedWebsocket")["status"], drawn.json)
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("ClosedWebsocket")))
    }

    @Test
    fun `a handshake that fails is drawn as an error reply and rethrown`() {
        val scenario = start()
        val failing = LsdHttp4k.wsClient(TestWebsocketFactory { _: Request -> error("no route") }, target = "Prices")
        assertThrows(IllegalStateException::class.java) { failing.blocking("/prices") }

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "IllegalStateException"), drawn.labels, drawn.json)
        assertEquals("error", drawn.message("IllegalStateException")["status"])
    }

    @Test
    fun `over real sockets the server's filter draws the socket, once, under its own name`() {
        val scenario = start(bind = false)
        server = PolyHandler(ws = filtered).asServer(Jetty(0)).start()
        val client = LsdHttp4k.wsClient(WebsocketClient(Duration.ofSeconds(5))).blocking("ws://localhost:${server!!.port()}/prices")

        client.send(PriceMessages.subscribe(Subscribe("lamp-01")))
        assertEquals(
            2,
            client
                .received()
                .take(2)
                .toList()
                .size,
        )
        client.close(WsStatus.NORMAL)
        assertTrue(serverClosed.await(5, TimeUnit.SECONDS), "the server saw the close")

        val drawn = report(scenario)
        assertEquals(1, drawn.labels.count { it == "GET /prices" }, drawn.json)
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("GET /prices")))
        assertEquals(2, drawn.labels.count { it == "PriceChanged" }, "labelled at the server, written by its lens: ${drawn.json}")
        assertEquals("Subscribe", drawn.labels[2], "labelled at the server, written by the client's lens")
    }

    @Test
    fun `over a real socket to a server without the filter, the client draws it`() {
        val scenario = start(bind = false)
        server = PolyHandler(ws = pricesApp).asServer(Jetty(0)).start()
        val port = server!!.port()
        val connected = CountDownLatch(1)
        val got = CountDownLatch(2)
        val closed = CountDownLatch(1)
        val ws = LsdHttp4k.wsClient(WebsocketClient(Duration.ofSeconds(5))).nonBlocking("ws://localhost:$port/prices", onConnect = { connected.countDown() })
        ws.onMessage { got.countDown() }
        ws.onClose { closed.countDown() }
        assertTrue(connected.await(5, TimeUnit.SECONDS), "connected")
        ws.send(PriceMessages.subscribe(Subscribe("lamp-01")))
        assertTrue(got.await(5, TimeUnit.SECONDS), "got both prices")
        ws.close(WsStatus.NORMAL)
        assertTrue(closed.await(5, TimeUnit.SECONDS), "closed")

        val drawn = report(scenario)
        assertEquals(roundTrip, drawn.labels, drawn.json)
        assertEquals("Client -> localhost:$port", drawn.arrow(drawn.message("GET /prices")))
    }

    @Test
    fun `wrapped twice it draws once, and outside a scenario it passes through`() {
        val factory = TestWebsocketFactory(pricesApp)
        val outside = LsdHttp4k.wsClient(factory).blocking("/prices")
        outside.send(PriceMessages.subscribe(Subscribe("lamp-01", ticks = 1)))
        assertEquals(
            1,
            outside
                .received()
                .take(1)
                .toList()
                .size,
        )
        assertEquals(factory.nonBlocking("/prices").javaClass, LsdHttp4k.wsClient(factory).nonBlocking("/prices").javaClass)

        val scenario = start()
        val twice = LsdHttp4k.wsClient(LsdHttp4k.wsClient(factory, target = "Inner"), target = "Outer").blocking("/prices")
        twice.close(WsStatus.NORMAL)
        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "101 Switching Protocols", "close 1000 Normal"), drawn.labels, drawn.json)
        assertEquals("Client -> Outer", drawn.arrow(drawn.message("GET /prices")))
        assertThrows(IllegalArgumentException::class.java) { LsdHttp4k.wsClient(factory, messagesShown = -1) }
    }

    @Test
    fun `a call the app makes while handling a received message lands in the scenario`() {
        val scenario = start(bind = false)
        val inventory = LsdHttp4k.clientFilter("Inventory").then { Response(OK) }
        val ws = LsdHttp4k.wsClient(TestWebsocketFactory(pricesApp), target = "Prices").nonBlocking("/prices")
        ws.onMessage { inventory(Request(GET, "/stock/lamp-01")) }
        ws.send(PriceMessages.subscribe(Subscribe("lamp-01", ticks = 1)))

        val drawn = report(scenario)
        assertTrue(drawn.labels.contains("GET /stock/lamp-01"), drawn.json)
    }

    @Test
    fun `a real client refused its port draws the handshake's error once, and no close`() {
        val scenario = start(bind = false)
        val port = ServerSocket(0).use { it.localPort }
        val errors = AtomicInteger()
        val failed = CountDownLatch(1)
        val ws =
            LsdHttp4k.wsClient(WebsocketClient(Duration.ofSeconds(2))).nonBlocking(
                "ws://localhost:$port/prices",
                onError = {
                    errors.incrementAndGet()
                    failed.countDown()
                },
            )
        assertTrue(failed.await(5, TimeUnit.SECONDS), "refused")
        val closed = CountDownLatch(1)
        ws.onClose { closed.countDown() }
        closed.await(1, TimeUnit.SECONDS)
        assertThrows(WebsocketNotConnectedException::class.java) { ws.send(WsMessage("too late")) }

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "ConnectException"), drawn.labels, drawn.json)
        assertEquals("error", drawn.message("ConnectException")["status"])
        assertEquals(1, errors.get(), "the app's own handler, once")
    }

    @Test
    fun `after a refused handshake, the socket's error, its close and the app's close are not drawn`() {
        val scenario = start()
        val factory = ManualFactory()
        val errors = mutableListOf<Throwable>()
        val ws = LsdHttp4k.wsClient(factory, target = "Prices").nonBlocking("/prices", onError = { errors += it })

        factory.refuse(ConnectException("Connection refused"))
        ws.close(WsStatus.NORMAL)
        assertThrows(WebsocketNotConnectedException::class.java) { ws.send(WsMessage("too late")) }

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "ConnectException"), drawn.labels, drawn.json)
        assertEquals(1, errors.size)
    }

    @Test
    fun `a send before the socket connects is drawn only if it goes, and errors after connecting are drawn`() {
        val scenario = start()
        val factory = ManualFactory()
        val ws = LsdHttp4k.wsClient(factory, target = "Prices").nonBlocking("/prices")
        val errors = mutableListOf<Throwable>()
        ws.onError { errors += it }

        assertThrows(WebsocketNotConnectedException::class.java) { ws.send(WsMessage("too soon")) }
        factory.open()
        ws.send(WsMessage("hello"))
        factory.socket.triggerError(IllegalStateException("reset"))
        ws.close(WsStatus.NORMAL)

        assertEquals(listOf("hello"), factory.socket.sent.map { it.bodyString() })
        assertEquals(listOf("reset"), errors.map { it.message })
        val drawn = report(scenario)
        assertEquals(
            listOf("GET /prices", "101 Switching Protocols", "text message", "IllegalStateException", "close 1000 Normal"),
            drawn.labels,
            drawn.json,
        )
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("text message")))
    }

    @Test
    fun `a send a client takes before it connects is drawn once it has gone`() {
        val scenario = start()
        val factory = ManualFactory(buffers = true)
        val ws = LsdHttp4k.wsClient(factory, target = "Prices").nonBlocking("/prices")

        ws.send(WsMessage("early"))

        assertEquals(listOf("early"), factory.socket.sent.map { it.bodyString() })
        val drawn = report(scenario)
        assertEquals(listOf("text message"), drawn.labels, drawn.json)
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("text message")))
    }

    @Test
    fun `bytes written from two classes keep the default label`() {
        val both = WsMessage("{ }")
        MessageNames.record(both, Ping())
        MessageNames.record(both, Ping())
        assertEquals("Ping", MessageNames.of(both))
        MessageNames.record(both, Pong())
        assertNull(MessageNames.of(both))
        MessageNames.record(both, Ping())
        assertNull(MessageNames.of(both), "still ambiguous")
    }

    @Test
    fun `text and binary with the same bytes are named apart`() {
        val text = WsMessage("same bytes")
        val binary = WsMessage(ByteBuffer.wrap("same bytes".toByteArray()))
        MessageNames.record(text, Ping())
        assertNull(MessageNames.of(binary))
        MessageNames.record(binary, Pong())
        assertEquals("Ping", MessageNames.of(text))
        assertEquals("Pong", MessageNames.of(binary))
    }

    @Test
    fun `messages up to the size limit are named`() {
        val largest = WsMessage("x".repeat(MessageNames.MAX_BYTES))
        val over = WsMessage("y".repeat(MessageNames.MAX_BYTES + 1))
        MessageNames.record(largest, Ping())
        MessageNames.record(over, Ping())
        assertEquals("Ping", MessageNames.of(largest))
        assertNull(MessageNames.of(over))
    }

    @Test
    fun `only the most recently used names are kept`() {
        val first = WsMessage("eviction first")
        MessageNames.record(first, Ping())
        repeat(MessageNames.MAX_ENTRIES - 1) { MessageNames.record(WsMessage("eviction filler $it"), Pong()) }
        assertEquals("Ping", MessageNames.of(first), "a full table keeps them all")
        MessageNames.record(WsMessage("eviction one more"), Pong())
        assertNull(MessageNames.of(WsMessage("eviction filler 0")), "the least recently used goes")
        assertEquals("Ping", MessageNames.of(first), "a name looked up is kept")
    }

    @Test
    fun `only the app's own classes name a message`() {
        val strings = LsdHttp4k.labelled(WsMessage.string().toLens())
        assertEquals(LsdHttp4k.labelled(PriceMessages.priceChanged).invoke(PriceMessages.priceChanged(PriceChanged("a", 1))), PriceChanged("a", 1))
        assertNull(MessageNames.of(strings("plain words")))
        assertNull(MessageNames.nameOf(object {}.javaClass))
        assertNull(MessageNames.nameOf(listOf(1)::class.java))
        assertEquals("PriceChanged", MessageNames.nameOf(PriceChanged::class.java))
        assertEquals("PriceChanged", MessageNames.of(WsMessage("""{"sku":"a","pence":1}""")))
        assertNull(MessageNames.of(WsMessage("x".repeat(MessageNames.MAX_BYTES + 1))))
        assertNull(MessageNames.of(WsMessage("never written".byteInputStream())))
    }
}

private class Ping

private class Pong

/** A non-blocking factory the test drives: it connects or is refused when told, as the real client reports it. */
private class ManualFactory(
    private val buffers: Boolean = false,
) : WebsocketFactory {
    lateinit var socket: Manual
    private lateinit var connect: WsConsumer

    override fun nonBlocking(
        uri: Uri,
        headers: Headers,
        onError: (Throwable) -> Unit,
        onConnect: WsConsumer,
    ): Websocket {
        connect = onConnect
        return Manual(buffers).apply { onError(onError) }.also { socket = it }
    }

    override fun blocking(
        uri: Uri,
        headers: Headers,
    ): WsClient = error("not used")

    fun open() {
        socket.open = true
        connect(socket)
    }

    fun refuse(e: Throwable) {
        socket.triggerError(e)
        socket.triggerClose(WsStatus(-1, ""))
    }

    class Manual(
        private val buffers: Boolean,
    ) : PushPullAdaptingWebSocket() {
        var open = false
        val sent = mutableListOf<WsMessage>()

        override fun send(message: WsMessage) {
            if (!open && !buffers) throw WebsocketNotConnectedException()
            sent += message
        }

        override fun close(status: WsStatus) = Unit
    }
}
