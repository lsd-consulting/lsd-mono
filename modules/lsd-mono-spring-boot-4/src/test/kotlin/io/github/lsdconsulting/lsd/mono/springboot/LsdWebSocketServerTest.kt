package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.boot.autoconfigure.AutoConfigurations
import org.springframework.boot.test.context.runner.WebApplicationContextRunner
import org.springframework.http.HttpHeaders
import org.springframework.http.server.ServletServerHttpRequest
import org.springframework.http.server.ServletServerHttpResponse
import org.springframework.messaging.Message
import org.springframework.messaging.simp.SimpMessageHeaderAccessor
import org.springframework.messaging.simp.stomp.StompCommand
import org.springframework.messaging.simp.stomp.StompHeaderAccessor
import org.springframework.messaging.support.ExecutorSubscribableChannel
import org.springframework.messaging.support.MessageBuilder
import org.springframework.mock.env.MockEnvironment
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.web.socket.BinaryMessage
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.WebSocketMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.adapter.standard.StandardWebSocketSession
import org.springframework.web.socket.handler.AbstractWebSocketHandler
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator
import org.springframework.web.socket.handler.TextWebSocketHandler
import org.springframework.web.socket.handler.WebSocketHandlerDecorator
import org.springframework.web.socket.handler.WebSocketSessionDecorator
import org.springframework.web.socket.messaging.StompSubProtocolErrorHandler
import org.springframework.web.socket.messaging.StompSubProtocolHandler
import org.springframework.web.socket.messaging.SubProtocolWebSocketHandler
import org.springframework.web.socket.server.support.WebSocketHandlerMapping
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@LsdTestConfig(deterministicIds = true)
class LsdWebSocketServerTest {
    private val autoConfig = AutoConfigurations.of(LsdAutoConfiguration::class.java)
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
            SpringScenarios.started(it, MockEnvironment())
            started += it
        }

    private fun report(scenario: LsdScenario): ScenarioJson {
        SpringScenarios.finished(scenario)
        scenario.complete(KEY)
        return ReportJson.read(LsdContext.instance.completeReport(KEY, KEY).reportJson).scenario(KEY)
    }

    /** A session the handshake left in [scenario], opened by the test. */
    private fun session(scenario: LsdScenario) = StandardWebSocketSession(
        HttpHeaders(),
        mutableMapOf<String, Any>(WsCall.ATTRIBUTE to WsCall(scenario, null, "client")),
        null,
        null,
    )

    private fun mapping(app: WebSocketHandler) = WebSocketHandlerMapping().apply { registerHandler("/prices", WebSocketHttpRequestHandler(app)) }

    /** The decorators around the endpoint's handler, outermost first, down to the app's. */
    private fun chain(mapping: WebSocketHandlerMapping): List<WebSocketHandler> =
        generateSequence(
            (mapping.handlerMap["/prices"] as WebSocketHttpRequestHandler).webSocketHandler,
        ) { (it as? WebSocketHandlerDecorator)?.delegate }.toList()

    @Test
    fun `an endpoint post-processed twice is wrapped once`() {
        val app = TextWebSocketHandler()
        val mapping = mapping(app)
        val processor = LsdWebSocketPostProcessor(MockEnvironment())

        processor.postProcessAfterInitialization(mapping, "mapping")
        processor.postProcessAfterInitialization(mapping, "mapping")

        val handlers = chain(mapping)
        assertEquals(1, handlers.count { it is LsdWebSocketHandler }, "$handlers")
        assertSame(app, handlers.last())
        val interceptors = (mapping.handlerMap["/prices"] as WebSocketHttpRequestHandler).handshakeInterceptors
        assertEquals(1, interceptors.count { it is LsdHandshakeInterceptor }, "$interceptors")
    }

    @Test
    fun `a negative messages-shown stops the app starting, naming the setting`() {
        val processor = LsdWebSocketPostProcessor(MockEnvironment().withProperty("lsd.mono.spring.websocket.messages-shown", "-1"))

        val e = assertThrows(IllegalArgumentException::class.java) { processor.postProcessAfterInitialization(mapping(TextWebSocketHandler()), "mapping") }
        assertEquals("lsd.mono.spring.websocket.messages-shown must not be negative: -1", e.message)
        assertSame("other", processor.postProcessAfterInitialization("other", "other"))
    }

    @Test
    fun `the handshake names its caller from the caller header, else the client`() {
        val scenario = start()

        fun callerOf(caller: String?): String? {
            val request = MockHttpServletRequest("GET", "/prices").apply { caller?.let { addHeader(SpringScenarios.CALLER_HEADER, it) } }
            val attributes = mutableMapOf<String, Any>()
            LsdHandshakeInterceptor(
                names,
            ).beforeHandshake(ServletServerHttpRequest(request), ServletServerHttpResponse(MockHttpServletResponse()), TextWebSocketHandler(), attributes)
            return (attributes[WsCall.ATTRIBUTE] as? WsCall)?.also { assertSame(scenario, it.scenario) }?.caller
        }

        assertEquals("Checkout", callerOf("Checkout"))
        assertEquals("Client", callerOf(null))
        assertEquals("Client", callerOf(" "))
    }

    @Test
    fun `after the first messages shown the app's side counts the rest in a note when the socket closes`() {
        val scenario = start()
        val handler = LsdWebSocketHandler(TextWebSocketHandler(), names, shown = 1)
        val session = session(scenario)

        handler.afterConnectionEstablished(session)
        repeat(3) { handler.handleMessage(session, TextMessage("{\"tick\":$it}")) }
        handler.afterConnectionClosed(session, CloseStatus.NORMAL)

        val drawn = report(scenario)
        assertEquals(listOf("text message", "close 1000"), drawn.labels, drawn.json)
        assertEquals(listOf("… 2 more WebSocket messages not drawn"), drawn.eventsOf("note").map { it["text"] }, drawn.json)
    }

    @Test
    fun `an ERROR the concurrent session drops while another send is in flight is still drawn`() {
        val scenario = start()
        val handler = LsdWebSocketHandler(TextWebSocketHandler(), names, shown = 20, frames = false)
        val blocking = BlockingSession(session(scenario))
        handler.afterConnectionEstablished(blocking)
        val drawn = DrawnSession.of(blocking)!!
        // Production order: SubProtocolWebSocketHandler wraps DrawnSession in this decorator.
        val concurrent = ConcurrentWebSocketSessionDecorator(drawn, 10_000, 64 * 1024)

        val sender = Thread({ concurrent.sendMessage(TextMessage("CONNECTED\n\n\u0000")) }, "connected-send")
        sender.start()
        assertEquals(true, blocking.entered.await(5, TimeUnit.SECONDS), "the first send should hold the decorator's flush lock")

        // The protocol handler decides to send ERROR (drawn here) and then writes and closes.
        // The write stays in the decorator's buffer; close drops it, so DrawnSession.sendMessage never sees it.
        val clientMessage =
            MessageBuilder.withPayload(ByteArray(0)).setHeader(SimpMessageHeaderAccessor.SESSION_ID_HEADER, blocking.id).build()
        LsdStompErrorHandler().handleClientMessageProcessingError(clientMessage, IllegalStateException("not allowed"))
        concurrent.sendMessage(TextMessage("ERROR\nmessage:not allowed\n\n\u0000"))
        concurrent.close(CloseStatus.PROTOCOL_ERROR)
        blocking.release.countDown()
        sender.join(5_000)
        handler.afterConnectionClosed(blocking, CloseStatus.PROTOCOL_ERROR)

        val report = report(scenario)
        assertEquals(listOf("ERROR", "close 1002"), report.labels, report.json)
        val error = report.message("ERROR")
        assertEquals(listOf("shop", "client", "error"), listOf(error["from"], error["to"], error["status"]), report.json)
        assertEquals("not allowed", (error["data"] as JsonObject)["message"], report.json)
    }

    @Test
    fun `an ERROR drawn by the protocol handler is not drawn again when the write reaches the socket`() {
        val scenario = start()
        val handler = LsdWebSocketHandler(TextWebSocketHandler(), names, shown = 20, frames = false)
        val session = BlockingSession(session(scenario)).also { it.release.countDown() }
        handler.afterConnectionEstablished(session)
        val drawn = DrawnSession.of(session)!!
        val clientMessage =
            MessageBuilder.withPayload(ByteArray(0)).setHeader(SimpMessageHeaderAccessor.SESSION_ID_HEADER, session.id).build()

        LsdStompErrorHandler().handleClientMessageProcessingError(clientMessage, IllegalStateException("not allowed"))
        drawn.sendMessage(TextMessage("ERROR\nmessage:not allowed\n\n\u0000"))
        handler.afterConnectionClosed(session, CloseStatus.PROTOCOL_ERROR)

        val report = report(scenario)
        assertEquals(listOf("ERROR", "close 1002"), report.labels, report.json)
    }

    @Test
    fun `a STOMP endpoint's protocol error handler is wrapped once and still consults the app's`() {
        val inbound = ExecutorSubscribableChannel()
        val outbound = ExecutorSubscribableChannel()
        val sub = SubProtocolWebSocketHandler(inbound, outbound)
        val protocol = StompSubProtocolHandler()
        var delegated = false
        val app =
            object : StompSubProtocolErrorHandler() {
                override fun handleClientMessageProcessingError(
                    clientMessage: Message<ByteArray>?,
                    ex: Throwable,
                ) = super.handleClientMessageProcessingError(clientMessage, ex).also { delegated = true }
            }
        protocol.setErrorHandler(app)
        sub.addProtocolHandler(protocol)
        sub.defaultProtocolHandler = protocol

        Stomp.installErrorDrawing(sub)
        val wrapped = protocol.errorHandler as LsdStompErrorHandler
        Stomp.installErrorDrawing(sub)
        assertSame(wrapped, protocol.errorHandler)

        val scenario = start()
        val handler = LsdWebSocketHandler(TextWebSocketHandler(), names, shown = 20, frames = false)
        val session = session(scenario)
        handler.afterConnectionEstablished(session)
        val clientMessage =
            MessageBuilder.withPayload(ByteArray(0)).setHeader(SimpMessageHeaderAccessor.SESSION_ID_HEADER, session.id).build()
        assertNotNull(wrapped.handleClientMessageProcessingError(clientMessage, IllegalStateException("not allowed")))
        assertTrue(delegated)

        val report = report(scenario)
        assertEquals(listOf("ERROR"), report.labels, report.json)
        handler.afterConnectionClosed(session, CloseStatus.PROTOCOL_ERROR)
    }

    @Test
    fun `a later setErrorHandler replaces the drawing wrapper`() {
        val inbound = ExecutorSubscribableChannel()
        val outbound = ExecutorSubscribableChannel()
        val sub = SubProtocolWebSocketHandler(inbound, outbound)
        val protocol = StompSubProtocolHandler()
        sub.addProtocolHandler(protocol)
        sub.defaultProtocolHandler = protocol

        Stomp.installErrorDrawing(sub)
        assertTrue(protocol.errorHandler is LsdStompErrorHandler)

        val later = StompSubProtocolErrorHandler()
        protocol.setErrorHandler(later)
        assertSame(later, protocol.errorHandler)
    }

    @Test
    fun `an ERROR frame that reaches the socket without the protocol handler is still drawn`() {
        val scenario = start()
        val handler = LsdWebSocketHandler(TextWebSocketHandler(), names, shown = 20, frames = false)
        val session = BlockingSession(session(scenario)).also { it.release.countDown() }
        handler.afterConnectionEstablished(session)

        DrawnSession.of(session)!!.sendMessage(TextMessage("ERROR\nmessage:gone\n\n\u0000"))
        handler.afterConnectionClosed(session, CloseStatus.PROTOCOL_ERROR)

        val report = report(scenario)
        assertEquals(listOf("ERROR", "close 1002"), report.labels, report.json)
        assertEquals("gone", (report.message("ERROR")["data"] as JsonObject)["message"], report.json)
    }

    @Test
    fun `an ERROR message to the client is drawn from the protocol handler`() {
        val scenario = start()
        val handler = LsdWebSocketHandler(TextWebSocketHandler(), names, shown = 20, frames = false)
        val session = session(scenario)
        handler.afterConnectionEstablished(session)
        val accessor = StompHeaderAccessor.create(StompCommand.ERROR)
        accessor.setMessage("gone")
        accessor.sessionId = session.id
        accessor.setLeaveMutable(true)

        LsdStompErrorHandler().handleErrorMessageToClient(MessageBuilder.createMessage(ByteArray(0), accessor.messageHeaders))
        handler.afterConnectionClosed(session, CloseStatus.PROTOCOL_ERROR)

        val report = report(scenario)
        assertEquals(listOf("ERROR", "close 1002"), report.labels, report.json)
        assertEquals("gone", (report.message("ERROR")["data"] as JsonObject)["message"], report.json)
    }

    @Test
    fun `an app error handler that suppresses the ERROR draws nothing`() {
        val scenario = start()
        val handler = LsdWebSocketHandler(TextWebSocketHandler(), names, shown = 20, frames = false)
        val session = session(scenario)
        handler.afterConnectionEstablished(session)
        val clientMessage =
            MessageBuilder.withPayload(ByteArray(0)).setHeader(SimpMessageHeaderAccessor.SESSION_ID_HEADER, session.id).build()
        val app =
            object : StompSubProtocolErrorHandler() {
                override fun handleClientMessageProcessingError(
                    clientMessage: Message<ByteArray>?,
                    ex: Throwable,
                ): Message<ByteArray>? = null
            }

        assertNull(LsdStompErrorHandler(app).handleClientMessageProcessingError(clientMessage, IllegalStateException("not allowed")))
        handler.afterConnectionClosed(session, CloseStatus.NORMAL)

        assertEquals(listOf("close 1000"), report(scenario).labels)
    }

    @Test
    fun `a STOMP session is forgotten once it closes`() {
        val scenario = start()
        val handler = LsdWebSocketHandler(TextWebSocketHandler(), names, shown = 20, frames = false)
        val session = session(scenario)
        val frame = MessageBuilder.withPayload(ByteArray(0)).setHeader(SimpMessageHeaderAccessor.SESSION_ID_HEADER, session.id).build()

        handler.afterConnectionEstablished(session)
        assertNotNull(Stomp.session(frame))
        handler.afterConnectionClosed(session, CloseStatus.NORMAL)

        assertNull(Stomp.session(frame))
    }

    @Test
    fun `an ERROR frame's popup is its message header, unescaped, and its body - no other frame is one`() {
        val error = Stomp.error(TextMessage("ERROR\ncontent-type:text/plain\nmessage:no\\c quotes\\nnow \\\\ later\n\ntry again\u0000"))
        assertEquals(listOf("message", "body"), error?.keys?.toList())
        assertEquals("no: quotes\nnow \\ later", error?.get("message"))
        assertEquals("try again", (error?.get("body") as ByteArray).decodeToString())
        assertEquals(mapOf("message" to "gone"), Stomp.error(TextMessage("ERROR\r\nmessage:gone\r\n\r\n\u0000")))
        assertEquals(emptyMap<String, Any?>(), Stomp.error(TextMessage("ERROR\n\n\u0000")))
        assertNull(Stomp.error(TextMessage("MESSAGE\ndestination:/topic/prices\n\nERROR\n\u0000")))
        assertNull(Stomp.error(BinaryMessage("ERROR\n\n\u0000".toByteArray())))
    }

    @Test
    fun `a servlet app's WebSocket handlers are drawn unless the property switches it off`() {
        WebApplicationContextRunner().withConfiguration(autoConfig).run {
            assertEquals(1, it.getBeanNamesForType(LsdWebSocketPostProcessor::class.java).size)
            assertEquals(1, it.getBeanNamesForType(LsdStompPostProcessor::class.java).size)
        }
        WebApplicationContextRunner()
            .withConfiguration(autoConfig)
            .withPropertyValues("lsd.mono.spring.websocket.enabled=false")
            .run {
                assertEquals(0, it.getBeanNamesForType(LsdWebSocketPostProcessor::class.java).size)
                assertEquals(0, it.getBeanNamesForType(LsdStompPostProcessor::class.java).size)
                assertEquals(0, it.getBeanNamesForType(LsdStompConfigurer::class.java).size)
            }
    }

    @Test
    fun `a socket opened outside a scenario reaches the app's handler as it is`() {
        val seen = mutableListOf<WebSocketSession>()
        val app =
            object : AbstractWebSocketHandler() {
                override fun afterConnectionEstablished(session: WebSocketSession) {
                    seen += session
                }

                override fun handleTextMessage(
                    session: WebSocketSession,
                    message: TextMessage,
                ) {
                    seen += session
                }

                override fun afterConnectionClosed(
                    session: WebSocketSession,
                    status: CloseStatus,
                ) {
                    seen += session
                }
            }
        val handler = LsdWebSocketHandler(app, ParticipantNames(MockEnvironment()), shown = 20)
        val session = StandardWebSocketSession(HttpHeaders(), mutableMapOf(), null, null)

        handler.afterConnectionEstablished(session)
        handler.handleMessage(session, TextMessage("hello"))
        handler.afterConnectionClosed(session, CloseStatus.NORMAL)

        assertEquals(3, seen.size)
        seen.forEach { assertSame(session, it) }
    }

    /**
     * A session whose [sendMessage] blocks until [release], like a slow CONNECTED write
     * holding ConcurrentWebSocketSessionDecorator's flush lock (#224).
     */
    private class BlockingSession(
        session: WebSocketSession,
    ) : WebSocketSessionDecorator(session) {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)

        override fun sendMessage(message: WebSocketMessage<*>) {
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS)) { "release the blocking send" }
        }

        override fun close() = Unit

        override fun close(status: CloseStatus) = Unit
    }

    private companion object {
        const val KEY = "web socket server"
    }
}
