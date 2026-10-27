package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.boot.autoconfigure.AutoConfigurations
import org.springframework.boot.test.context.runner.WebApplicationContextRunner
import org.springframework.http.HttpHeaders
import org.springframework.http.server.ServletServerHttpRequest
import org.springframework.http.server.ServletServerHttpResponse
import org.springframework.messaging.simp.SimpMessageHeaderAccessor
import org.springframework.messaging.support.MessageBuilder
import org.springframework.mock.env.MockEnvironment
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.web.socket.BinaryMessage
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.adapter.standard.StandardWebSocketSession
import org.springframework.web.socket.handler.AbstractWebSocketHandler
import org.springframework.web.socket.handler.TextWebSocketHandler
import org.springframework.web.socket.handler.WebSocketHandlerDecorator
import org.springframework.web.socket.server.support.WebSocketHandlerMapping
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler

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

    private companion object {
        const val KEY = "web socket server"
    }
}
