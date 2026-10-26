package io.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test
import org.springframework.boot.autoconfigure.AutoConfigurations
import org.springframework.boot.test.context.runner.WebApplicationContextRunner
import org.springframework.http.HttpHeaders
import org.springframework.mock.env.MockEnvironment
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.adapter.standard.StandardWebSocketSession
import org.springframework.web.socket.handler.AbstractWebSocketHandler

class LsdWebSocketServerTest {
    private val autoConfig = AutoConfigurations.of(LsdAutoConfiguration::class.java)

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
}
