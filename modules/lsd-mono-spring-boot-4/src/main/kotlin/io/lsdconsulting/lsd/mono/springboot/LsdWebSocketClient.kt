package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.WebSocketHttpHeaders
import org.springframework.web.socket.WebSocketMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.WebSocketClient
import org.springframework.web.socket.handler.WebSocketHandlerDecorator
import org.springframework.web.util.UriComponentsBuilder
import java.net.URI
import java.time.Instant
import java.util.concurrent.CompletableFuture

/**
 * For a Spring `WebSocketClient` the test (or the app) opens sockets with, including the one
 * under a `WebSocketStompClient`:
 *
 * ```java
 * WebSocketClient client = LsdWebSocketClient.wrap(new StandardWebSocketClient());
 * WebSocketStompClient stomp = new WebSocketStompClient(client);
 * ```
 *
 * Its handshakes carry the test's scenario, so a socket to this app is drawn in it, once, by the
 * app's side (`GET /prices` → `101 Switching Protocols`, then each message). A socket to another
 * server is drawn by the client: the handshake, each message either way, the close and errors,
 * the first 20 messages (`lsd.mono.spring.websocket.messages-shown`) and then a count. Outside a
 * scenario it passes straight through. Wrapping a wrapped client adds nothing.
 */
public object LsdWebSocketClient {
    /** [client], drawing in the running scenario. */
    @JvmStatic
    public fun wrap(client: WebSocketClient): WebSocketClient = if (client is Drawing) client else Drawing(client)

    private class Drawing(
        private val client: WebSocketClient,
    ) : WebSocketClient {
        override fun execute(
            webSocketHandler: WebSocketHandler,
            uriTemplate: String,
            vararg uriVariables: Any?,
        ): CompletableFuture<WebSocketSession> {
            val uri =
                UriComponentsBuilder
                    .fromUriString(uriTemplate)
                    .buildAndExpand(*uriVariables)
                    .encode()
                    .toUri()
            return execute(webSocketHandler, null, uri)
        }

        override fun execute(
            webSocketHandler: WebSocketHandler,
            headers: WebSocketHttpHeaders?,
            uri: URI,
        ): CompletableFuture<WebSocketSession> {
            val scenario = guarded(null) { SpringScenarios.resolve() } ?: return client.execute(webSocketHandler, headers, uri)
            val sent = WebSocketHttpHeaders().apply { headers?.let { putAll(it) } }
            val settings = ClientSettings.of(scenario)
            val names = settings.names
            val parent = SpringScenarios.parentOf(scenario)
            val caller = if (parent == null) names.client else names.app
            guarded(Unit) {
                val allowed = scenario.bind().use { LsdContext.instance.scenarioHeaderValue(uri) }
                if (allowed != null) {
                    sent.set(LsdHeaders.SCENARIO, allowed)
                    sent.set(SpringScenarios.CALLER_HEADER, caller)
                    parent?.let { sent.set(LsdInboundFilter.PARENT_SPAN_HEADER, it) }
                }
            }
            // A socket to this app's own server is drawn once, by the app's side.
            if (guarded(true) { names.isSelf(uri) }) return client.execute(webSocketHandler, sent, uri)
            val socket = guarded(null) { Socket.open(scenario, caller, names.of(uri), uri, parent, sent, settings.shown) }
                ?: return client.execute(webSocketHandler, sent, uri)
            val handler = ClientHandler(webSocketHandler, socket)
            return client
                .execute(handler, sent, uri)
                .whenComplete { _, e -> if (e != null) socket.failed(e) }
                .thenApply { handler.session(it) }
        }
    }

    /** One socket the client opened to another server, from [local] to [remote]. */
    private class Socket(
        val scenario: LsdScenario,
        val local: String,
        val remote: String,
        val handshake: String,
        val t0: Long,
        val shown: Int,
    ) {
        val drawing = WsDrawing(scenario, local, shown)

        fun opened() = reply("101", statusLabel(101))

        fun failed(e: Throwable) {
            val cause = (e as? java.util.concurrent.CompletionException)?.cause ?: e
            reply("error", cause.javaClass.simpleName, cause.toString())
        }

        private fun reply(
            status: String,
            label: String,
            data: Any? = null,
        ) = guarded(Unit) {
            if (!SpringScenarios.isRunning(scenario)) return@guarded
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.RESPONSE,
                    from = remote,
                    to = local,
                    label = label,
                    status = status,
                    replyTo = handshake,
                    source = SpringScenarios.SOURCE,
                    durationMs = (System.nanoTime() - t0) / 1_000_000.0,
                    data = data,
                ),
            )
        }

        companion object {
            fun open(
                scenario: LsdScenario,
                local: String,
                remote: String,
                uri: URI,
                parent: String?,
                headers: WebSocketHttpHeaders,
                shown: Int,
            ): Socket {
                val id = SpringScenarios.newId()
                scenario.ingest(
                    Interaction(
                        kind = InteractionKind.REQUEST,
                        from = local,
                        to = remote,
                        label = "GET ${uri.rawPath.ifEmpty { "/" }}${uri.rawQuery?.let { "?$it" } ?: ""}",
                        interactionId = id,
                        trace = Trace(scenario.correlationId, id, parent),
                        source = SpringScenarios.SOURCE,
                        startedAt = Instant.now(),
                        headers = headers.headerNames().filterNot(SpringScenarios::isOwnHeader).associateWith { headers.getFirst(it) ?: "" },
                    ),
                )
                return Socket(scenario, local, remote, id, System.nanoTime(), shown)
            }
        }
    }

    /** The client's handler: messages from the server are drawn to it, and it is handed the drawn session. */
    private class ClientHandler(
        delegate: WebSocketHandler,
        private val socket: Socket,
    ) : WebSocketHandlerDecorator(delegate) {
        @Volatile private var drawn: DrawnSession? = null

        fun session(session: WebSocketSession): WebSocketSession = drawn ?: wrap(session)

        @Synchronized
        private fun wrap(session: WebSocketSession): DrawnSession =
            drawn ?: DrawnSession(session, WsCall(socket.scenario, socket.handshake, socket.remote), socket.drawing, socket.local, true)
                .also { drawn = it }

        override fun afterConnectionEstablished(session: WebSocketSession) {
            socket.opened()
            val drawn = wrap(session)
            SpringScenarios.within(SpringScenarios.Current(socket.scenario, socket.handshake)) {
                drawn.run { super.afterConnectionEstablished(drawn) }
            }
        }

        override fun handleMessage(
            session: WebSocketSession,
            message: WebSocketMessage<*>,
        ) {
            val drawn = wrap(session)
            val id = socket.drawing.message(socket.remote, socket.local, message)
            SpringScenarios.within(SpringScenarios.Current(socket.scenario, id ?: socket.handshake)) {
                drawn.run { super.handleMessage(drawn, message) }
            }
        }

        override fun handleTransportError(
            session: WebSocketSession,
            exception: Throwable,
        ) {
            socket.drawing.error(socket.remote, socket.local, exception)
            super.handleTransportError(wrap(session), exception)
        }

        override fun afterConnectionClosed(
            session: WebSocketSession,
            closeStatus: CloseStatus,
        ) {
            socket.drawing.close(socket.remote, socket.local, closeStatus)
            super.afterConnectionClosed(wrap(session), closeStatus)
        }
    }
}
