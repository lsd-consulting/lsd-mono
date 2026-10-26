package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.core.testing.ScenarioJson
import io.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.core.env.Environment
import org.springframework.http.HttpHeaders
import org.springframework.mock.env.MockEnvironment
import org.springframework.web.socket.BinaryMessage
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.PongMessage
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketExtension
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.WebSocketHttpHeaders
import org.springframework.web.socket.WebSocketMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.WebSocketClient
import org.springframework.web.socket.handler.AbstractWebSocketHandler
import java.net.InetSocketAddress
import java.net.URI
import java.security.Principal
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException

/** [LsdWebSocketClient] opening sockets to another server, played by [Server]. */
@LsdTestConfig(deterministicIds = true)
class LsdWebSocketClientTest {
    private val started = mutableListOf<LsdScenario>()

    @BeforeEach
    @AfterEach
    fun clear() {
        started.forEach(SpringScenarios::finished)
        started.clear()
        LsdContext.instance.clear()
    }

    private fun start(environment: Environment = shop()): LsdScenario =
        LsdContext.instance.beginScenario(reportKey = KEY, key = KEY, bindCurrentThread = true).also {
            SpringScenarios.started(it, environment)
            started += it
        }

    private fun shop(): MockEnvironment =
        MockEnvironment()
            .withProperty("spring.application.name", "shop")
            .withProperty("shop.pricing.url", "ws://pricing.example:8080/prices")

    private fun report(scenario: LsdScenario): ScenarioJson {
        SpringScenarios.finished(scenario)
        scenario.complete(KEY)
        return ReportJson.read(LsdContext.instance.completeReport(KEY, KEY).reportJson).scenario(KEY)
    }

    private fun ScenarioJson.notes() = eventsOf("note").mapNotNull { it.string("text") }

    @Test
    fun `a socket to another server is drawn by the client, from the test - handshake, messages either way, then the close`() {
        val scenario = start()
        val server = Server()
        val received = Received()

        val socket = LsdWebSocketClient.wrap(server).execute(received, null, PRICES).get()
        socket.sendMessage(TextMessage("""{"sku":"lamp-01"}"""))
        server.send(TextMessage("""{"sku":"lamp-01","price":12.5}"""))
        server.send(PongMessage())
        socket.close()

        val drawn = report(scenario)
        assertEquals(
            listOf("GET /prices", "101 Switching Protocols", "text message", "text message", "close 1000"),
            drawn.labels,
            drawn.json,
        )
        val (out, back) = drawn.messages.filter { it["label"] == "text message" }
        assertEquals(listOf("client", "pricing"), listOf(out["from"], out["to"]), drawn.json)
        assertEquals(listOf("pricing", "client"), listOf(back["from"], back["to"]), drawn.json)
        assertEquals(12.5, (back["data"] as JsonObject)["price"], drawn.json)
        assertEquals("client", drawn.message("close 1000")["from"], drawn.json)
        assertEquals(listOf("""{"sku":"lamp-01","price":12.5}"""), received.texts)
        // The scenario header goes only to hosts LSD may send it to; pricing.example is not one by default.
        assertNull(server.headers?.getFirst(LsdHeaders.SCENARIO), "${server.headers}")
    }

    @Test
    fun `the server closing is drawn from the server, once`() {
        val scenario = start()
        val server = Server()

        val socket = LsdWebSocketClient.wrap(server).execute(Received(), null, PRICES).get()
        server.close(CloseStatus.GOING_AWAY.withReason("restarting"))
        socket.close()

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "101 Switching Protocols", "close 1001 restarting"), drawn.labels, drawn.json)
        assertEquals("pricing", drawn.message("close 1001 restarting")["from"], drawn.json)
    }

    @Test
    fun `after the first messages shown the rest are counted in a note when the socket closes`() {
        val scenario = start(shop().withProperty("lsd.mono.spring.websocket.messages-shown", "2"))
        val server = Server()

        val socket = LsdWebSocketClient.wrap(server).execute(Received(), null, PRICES).get()
        repeat(5) { server.send(TextMessage("""{"tick":$it}""")) }
        socket.close()

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "101 Switching Protocols", "text message", "text message", "close 1000"), drawn.labels, drawn.json)
        assertEquals(listOf("… 3 more WebSocket messages not drawn"), drawn.notes(), drawn.json)
    }

    @Test
    fun `a binary message is labelled with its size, and text over the body limit is not shown`() {
        val scenario = start()
        val server = Server()

        val socket = LsdWebSocketClient.wrap(server).execute(Received(), null, PRICES).get()
        socket.sendMessage(BinaryMessage(byteArrayOf(1, 2, 3)))
        server.send(TextMessage("x".repeat(Bodies.LIMIT + 1)))

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "101 Switching Protocols", "binary (3 bytes)", "text message"), drawn.labels, drawn.json)
        assertNull(drawn.message("binary (3 bytes)")["data"], drawn.json)
        val big = drawn.message("text message")["data"] as JsonObject
        assertEquals("larger than 256 KiB", big["notShown"], drawn.json)
    }

    @Test
    fun `the client's handler failing is drawn as an error and the close that follows`() {
        val scenario = start()
        val server = Server()
        val failing =
            object : Received() {
                override fun handleTextMessage(
                    session: WebSocketSession,
                    message: TextMessage,
                ): Unit = throw IllegalArgumentException("not a price")
            }

        LsdWebSocketClient.wrap(server).execute(failing, null, PRICES).get()
        assertThrows(IllegalArgumentException::class.java) { server.send(TextMessage("?")) }
        server.close(CloseStatus.SERVER_ERROR)

        val drawn = report(scenario)
        assertEquals(
            listOf("GET /prices", "101 Switching Protocols", "text message", "IllegalArgumentException", "close 1011"),
            drawn.labels,
            drawn.json,
        )
        assertEquals("error", drawn.message("IllegalArgumentException")["status"], drawn.json)
        assertEquals("client", drawn.message("IllegalArgumentException")["from"], drawn.json)
        assertEquals("client", drawn.message("close 1011")["from"], drawn.json)
    }

    @Test
    fun `a transport error is drawn from the server`() {
        val scenario = start()
        val server = Server()

        LsdWebSocketClient.wrap(server).execute(Received(), null, PRICES).get()
        server.handler!!.handleTransportError(server.session, java.io.IOException("reset"))

        val drawn = report(scenario)
        assertEquals("pricing", drawn.message("IOException")["from"], drawn.json)
    }

    @Test
    fun `a handshake the server refuses is drawn as an error reply`() {
        val scenario = start()
        val server = Server(refuse = true)

        val opened = LsdWebSocketClient.wrap(server).execute(Received(), "ws://pricing.example:8080/prices?sku={sku}", "lamp 01")

        assertThrows(ExecutionException::class.java) { opened.get() }
        val drawn = report(scenario)
        assertEquals(listOf("GET /prices?sku=lamp%2001", "IllegalStateException"), drawn.labels, drawn.json)
        assertEquals("error", drawn.message("IllegalStateException")["status"], drawn.json)
    }

    @Test
    fun `outside a scenario the client passes straight through`() {
        val server = Server()
        val received = Received()

        val socket = LsdWebSocketClient.wrap(server).execute(received, null, PRICES).get()

        assertSame(server.session, socket)
        assertSame(received, server.handler)
        assertNull(server.headers?.getFirst(LsdHeaders.SCENARIO))
    }

    @Test
    fun `a socket to this app's own server is left to its side to draw`() {
        val scenario = start(shop().withProperty("local.server.port", "8081"))
        val server = Server()

        val socket = LsdWebSocketClient.wrap(server).execute(Received(), null, URI.create("ws://localhost:8081/prices")).get()
        socket.sendMessage(TextMessage("hello"))

        assertSame(server.session, socket)
        assertTrue(server.headers?.getFirst(LsdHeaders.SCENARIO) != null, "${server.headers}")
        assertEquals(emptyList<String>(), report(scenario).labels)
    }

    @Test
    fun `wrapping a wrapped client adds nothing`() {
        val wrapped = LsdWebSocketClient.wrap(Server())

        assertSame(wrapped, LsdWebSocketClient.wrap(wrapped))
    }

    /** The test's own handler: what it was sent. */
    open class Received : AbstractWebSocketHandler() {
        val texts = mutableListOf<String>()

        override fun handleTextMessage(
            session: WebSocketSession,
            message: TextMessage,
        ) {
            texts += message.payload
        }
    }

    /** Another server: opens at once (or refuses), and sends or closes when the test says. */
    private class Server(
        private val refuse: Boolean = false,
    ) : WebSocketClient {
        var handler: WebSocketHandler? = null
        var headers: WebSocketHttpHeaders? = null
        val session = Session()

        fun send(message: WebSocketMessage<*>) = handler!!.handleMessage(session, message)

        fun close(status: CloseStatus) {
            session.open = false
            handler!!.afterConnectionClosed(session, status)
        }

        override fun execute(
            webSocketHandler: WebSocketHandler,
            uriTemplate: String,
            vararg uriVariables: Any?,
        ): CompletableFuture<WebSocketSession> = error("not used")

        override fun execute(
            webSocketHandler: WebSocketHandler,
            headers: WebSocketHttpHeaders?,
            uri: URI,
        ): CompletableFuture<WebSocketSession> {
            this.headers = headers
            if (refuse) return CompletableFuture.failedFuture(IllegalStateException("401 from $uri"))
            handler = webSocketHandler
            webSocketHandler.afterConnectionEstablished(session)
            return CompletableFuture.completedFuture(session)
        }

        /** The client's end of the socket; closing it tells the client's handler, as a container would. */
        inner class Session : WebSocketSession {
            var open = true
            val sent = mutableListOf<WebSocketMessage<*>>()
            private val attributes = mutableMapOf<String, Any>()

            override fun getId() = "socket-1"

            override fun getUri() = PRICES

            override fun getHandshakeHeaders() = HttpHeaders()

            override fun getAttributes() = attributes

            override fun getPrincipal(): Principal? = null

            override fun getLocalAddress(): InetSocketAddress? = null

            override fun getRemoteAddress(): InetSocketAddress? = null

            override fun getAcceptedProtocol(): String? = null

            override fun setTextMessageSizeLimit(messageSizeLimit: Int) = Unit

            override fun getTextMessageSizeLimit() = Int.MAX_VALUE

            override fun setBinaryMessageSizeLimit(messageSizeLimit: Int) = Unit

            override fun getBinaryMessageSizeLimit() = Int.MAX_VALUE

            override fun getExtensions() = emptyList<WebSocketExtension>()

            override fun sendMessage(message: WebSocketMessage<*>) {
                sent += message
            }

            override fun isOpen() = open

            override fun close() = close(CloseStatus.NORMAL)

            override fun close(status: CloseStatus) {
                if (!open) return
                open = false
                handler?.afterConnectionClosed(this, status)
            }
        }
    }

    private companion object {
        const val KEY = "web socket client"
        val PRICES: URI = URI.create("ws://pricing.example:8080/prices")
    }
}
