package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.core.env.Environment
import org.springframework.http.server.ServerHttpRequest
import org.springframework.http.server.ServerHttpResponse
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.WebSocketMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.ExceptionWebSocketHandlerDecorator
import org.springframework.web.socket.handler.LoggingWebSocketHandlerDecorator
import org.springframework.web.socket.handler.WebSocketHandlerDecorator
import org.springframework.web.socket.handler.WebSocketSessionDecorator
import org.springframework.web.socket.server.HandshakeInterceptor
import org.springframework.web.socket.server.support.WebSocketHandlerMapping
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler

/**
 * Puts every WebSocket endpoint the app registers (`@EnableWebSocket`, or a STOMP endpoint) behind
 * [LsdWebSocketHandler] and [LsdHandshakeInterceptor]. Spring MVC serves those endpoints through
 * [WebSocketHandlerMapping]s, so each one's `WebSocketHttpRequestHandler` is swapped for one that
 * wraps the same handler and reuses the same handshake handler. SockJS endpoints are left as they are.
 */
internal class LsdWebSocketPostProcessor(
    private val env: Environment,
) : BeanPostProcessor {
    private val names by lazy { ParticipantNames(env) }
    private val shown by lazy { WsDrawing.shown(env) }

    override fun postProcessAfterInitialization(
        bean: Any,
        beanName: String,
    ): Any {
        if (bean !is WebSocketHandlerMapping) return bean
        // Outside the guard: a negative messages-shown fails the app's start, with the setting named.
        val shown = shown
        guarded(Unit) { wrap(bean, shown) }
        return bean
    }

    private fun wrap(
        mapping: WebSocketHandlerMapping,
        shown: Int,
    ) {
        for ((path, handler) in mapping.handlerMap.toMap()) {
            if (handler !is WebSocketHttpRequestHandler) continue
            val app = unwrap(handler.webSocketHandler)
            if (app is LsdWebSocketHandler) continue
            // A STOMP endpoint's frames are drawn from its channels (see LsdStompInterceptor); this draws its close.
            val frames = !Stomp.isEndpoint(app)
            val wrapped = WebSocketHttpRequestHandler(LsdWebSocketHandler(app, names, shown, frames), handler.handshakeHandler)
            wrapped.setHandshakeInterceptors(listOf(LsdHandshakeInterceptor(names)) + handler.handshakeInterceptors)
            mapping.unregisterHandler(path)
            mapping.registerHandler(path, wrapped)
            @Suppress("UNCHECKED_CAST")
            (mapping.urlMap as? MutableMap<String, Any?>)?.replaceAll { _, it -> if (it === handler) wrapped else it }
        }
    }

    /** The app's handler without the logging and exception decorators the request handler adds itself. */
    private fun unwrap(handler: WebSocketHandler): WebSocketHandler {
        val logging = (handler as? ExceptionWebSocketHandlerDecorator)?.delegate as? LoggingWebSocketHandlerDecorator
        return logging?.delegate ?: handler
    }
}

/** One socket's scenario, its caller and the handshake it was opened by: what the handshake left for the session. */
internal class WsCall(
    val scenario: LsdScenario,
    val handshake: String?,
    val caller: String,
) {
    companion object {
        const val ATTRIBUTE: String = "io.github.lsdconsulting.lsd.mono.springboot.WsCall"
    }
}

/**
 * Notes, on the handshake's thread (where the inbound filter is drawing it as `GET /prices` →
 * `101 Switching Protocols`), which scenario and caller the socket belongs to.
 */
internal class LsdHandshakeInterceptor(
    private val names: ParticipantNames,
) : HandshakeInterceptor {
    override fun beforeHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        attributes: MutableMap<String, Any>,
    ): Boolean {
        guarded(Unit) {
            val current = SpringScenarios.current()
            val scenario = current?.scenario ?: SpringScenarios.resolve(request.headers.getFirst(LsdHeaders.SCENARIO)) ?: return@guarded
            val caller = request.headers.getFirst(SpringScenarios.CALLER_HEADER)?.takeIf { it.isNotBlank() } ?: names.client
            attributes[WsCall.ATTRIBUTE] = WsCall(scenario, current?.parent, caller)
        }
        return true
    }

    override fun afterHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        exception: Exception?,
    ) = Unit
}

/**
 * Draws a socket the app serves: each message the caller sends and each the app sends back
 * (through the session it is given), the close from whichever side closed first, and errors. The
 * app's handling of a message is that message's: the calls it makes are drawn under it. With
 * [frames] false (a STOMP endpoint) only the close and errors are drawn here.
 */
internal class LsdWebSocketHandler(
    delegate: WebSocketHandler,
    private val names: ParticipantNames,
    private val shown: Int,
    private val frames: Boolean = true,
) : WebSocketHandlerDecorator(delegate) {
    override fun afterConnectionEstablished(session: WebSocketSession) {
        val drawn = guarded(null) { open(session) }
        if (drawn == null) {
            super.afterConnectionEstablished(session)
            return
        }
        SpringScenarios.within(SpringScenarios.Current(drawn.drawing.scenario, drawn.call.handshake)) {
            drawn.run { super.afterConnectionEstablished(drawn) }
        }
    }

    override fun handleMessage(
        session: WebSocketSession,
        message: WebSocketMessage<*>,
    ) {
        val drawn = DrawnSession.of(session)
        if (drawn == null) {
            super.handleMessage(session, message)
            return
        }
        val id = if (frames) drawn.drawing.message(drawn.call.caller, names.app, message) else null
        SpringScenarios.within(SpringScenarios.Current(drawn.drawing.scenario, id ?: drawn.call.handshake)) {
            drawn.run { super.handleMessage(drawn, message) }
        }
    }

    override fun handleTransportError(
        session: WebSocketSession,
        exception: Throwable,
    ) {
        DrawnSession.of(session)?.let { it.drawing.error(it.call.caller, names.app, exception) }
        super.handleTransportError(DrawnSession.of(session) ?: session, exception)
    }

    override fun afterConnectionClosed(
        session: WebSocketSession,
        closeStatus: CloseStatus,
    ) {
        val drawn = DrawnSession.of(session)
        drawn?.drawing?.close(drawn.call.caller, names.app, closeStatus)
        try {
            super.afterConnectionClosed(drawn ?: session, closeStatus)
        } finally {
            if (!frames) Stomp.closed(session.id)
        }
    }

    private fun open(session: WebSocketSession): DrawnSession? {
        val call = session.attributes[WsCall.ATTRIBUTE] as? WsCall ?: return null
        if (!SpringScenarios.isRunning(call.scenario)) return null
        val drawn = DrawnSession(session, call, WsDrawing(call.scenario, names.app, shown), names.app, frames)
        session.attributes[DrawnSession.ATTRIBUTE] = drawn
        if (!frames) Stomp.opened(session.id, drawn)
        return drawn
    }
}

/**
 * The session the app's handler is given: what the app sends through it is drawn from [app] to
 * the caller, and so is a close the app makes.
 */
internal class DrawnSession(
    session: WebSocketSession,
    val call: WsCall,
    val drawing: WsDrawing,
    val app: String,
    private val frames: Boolean,
) : WebSocketSessionDecorator(session) {
    override fun sendMessage(message: WebSocketMessage<*>) {
        if (frames) {
            drawing.message(app, call.caller, message)
        } else {
            // STOMP writes its ERROR frames here, some (an inbound interceptor's rejection) without the outbound channel.
            guarded(null) { Stomp.error(message) }?.let { drawing.arrow(app, call.caller, "ERROR", it, status = "error") }
        }
        super.sendMessage(message)
    }

    override fun close() = close(CloseStatus.NORMAL)

    override fun close(status: CloseStatus) {
        drawing.close(app, call.caller, status)
        super.close(status)
    }

    /**
     * Runs the app's handling; when it throws, draws the error and the close the container then
     * makes (`1011`), from the app, before passing the exception on.
     */
    fun run(block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            drawing.error(app, call.caller, e)
            drawing.close(app, call.caller, CloseStatus.SERVER_ERROR)
            throw e
        }
    }

    companion object {
        const val ATTRIBUTE: String = "io.github.lsdconsulting.lsd.mono.springboot.DrawnSession"

        fun of(session: WebSocketSession): DrawnSession? = session as? DrawnSession ?: session.attributes[ATTRIBUTE] as? DrawnSession
    }
}
