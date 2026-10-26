package io.lsdconsulting.lsd.mono.http4k

import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.http4k.Calls.guarded
import org.http4k.core.Request
import org.http4k.routing.WsResponseWithContext
import org.http4k.websocket.Websocket
import org.http4k.websocket.WsConsumer
import org.http4k.websocket.WsFilter
import org.http4k.websocket.WsHandler
import org.http4k.websocket.WsMessage
import org.http4k.websocket.WsResponse
import org.http4k.websocket.WsStatus
import java.time.Instant

/**
 * Draws a WebSocket the app serves: the handshake as a call from its caller to [app] answered
 * `101 Switching Protocols`, then each message as an arrow (the first [shown] of them; the rest
 * are counted in a note when the socket closes), the close and any error. The scenario is the
 * one the handshake belongs to, as for [ServerFilter]; with none the socket passes through. A
 * handshake from [WsClientCapture] in this JVM is taken over and drawn here, so it is drawn once.
 */
internal class WsCapture(
    private val app: String,
    private val client: String,
    private val shown: Int,
) : WsFilter {
    override fun invoke(next: WsHandler): WsHandler = { request -> handshake(next, request) }

    private class Inbound(
        val scenario: LsdScenario,
        val id: String,
        val caller: String,
        val parent: String?,
    )

    private fun inbound(request: Request): Inbound? {
        val call =
            Calls.pendingHere.get()?.takeIf { it.take() }
                ?: request.header(Calls.CALL_HEADER)?.let { Calls.pending[it] }?.takeIf { it.take() }
        if (call != null) return Inbound(call.scenario, call.id, call.caller, call.parent)
        val scenario =
            Calls.lsd.findScenarioByHeader(request.header(LsdHeaders.SCENARIO))
                ?: Calls.lsd.runningScenario()
                ?: return null
        val caller = request.header(Calls.CALLER_HEADER)?.takeIf { it.isNotBlank() } ?: client
        return Inbound(scenario, Calls.newId(), caller, request.header(Calls.PARENT_SPAN_HEADER))
    }

    private fun handshake(
        next: WsHandler,
        request: Request,
    ): WsResponse {
        val inbound = guarded(null) { inbound(request) } ?: return next(request)
        val scenario = inbound.scenario
        val caller = inbound.caller
        val id = inbound.id
        guarded(Unit) {
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.REQUEST,
                    from = caller,
                    to = app,
                    label = Calls.label(request),
                    interactionId = id,
                    trace = Trace(scenario.correlationId, id, inbound.parent),
                    source = Calls.SOURCE,
                    startedAt = Instant.now(),
                    headers = Calls.headers(request),
                ),
            )
        }
        val t0 = System.nanoTime()
        val response =
            try {
                scenario.bind().use { next(request) }
            } catch (e: Throwable) {
                reply(scenario, caller, id, t0, "error", e.javaClass.simpleName, e.toString())
                throw e
            }
        reply(scenario, caller, id, t0, "101", "101 Switching Protocols", null)
        val socket = Socket(WsDrawing(scenario, app, shown), app, caller, request)
        val tapped: WsConsumer = { ws -> response.consumer(socket.tap(ws)) }
        // Keep what routing recorded (the route's template) on the response.
        return if (response is WsResponseWithContext) {
            WsResponseWithContext(response.delegate.withConsumer(tapped), response.context)
        } else {
            response.withConsumer(tapped)
        }
    }

    private fun reply(
        scenario: LsdScenario,
        caller: String,
        id: String,
        t0: Long,
        status: String,
        label: String,
        data: Any?,
    ) = guarded(Unit) {
        scenario.ingest(
            Interaction(
                kind = InteractionKind.RESPONSE,
                from = app,
                to = caller,
                label = label,
                status = status,
                replyTo = id,
                source = Calls.SOURCE,
                durationMs = Calls.elapsedMs(t0),
                data = data,
            ),
        )
    }

    /** One connection, and the message the app is handling (its calls nest under it). */
    private class Socket(
        val drawing: WsDrawing,
        val app: String,
        val caller: String,
        val handshake: Request,
    ) {
        @Volatile private var lastIn: String? = null

        fun tap(ws: Websocket): Websocket {
            // Registered before the app's own handlers, so a message is drawn before its replies.
            // A message left out (over the cap) still gets a span of its own, so the app's calls
            // while handling it are not nested under an earlier message.
            ws.onMessage { lastIn = drawing.message(caller, app, it) ?: Calls.newId() }
            ws.onClose { drawing.close(caller, app, it) }
            ws.onError { drawing.error(caller, app, it) }
            return Tapped(ws)
        }

        /** Runs an app handler with the scenario bound, so its HTTP calls are drawn from [app]. */
        fun <T> within(block: () -> T): T {
            val previous = Calls.serving.get()
            Calls.serving.set(Serving(drawing.scenario, app, lastIn ?: Calls.newId(), handshake))
            try {
                return drawing.scenario.bind().use { block() }
            } finally {
                Calls.serving.set(previous)
            }
        }

        private inner class Tapped(
            private val ws: Websocket,
        ) : Websocket {
            override fun send(message: WsMessage) {
                drawing.message(app, caller, message)
                ws.send(message)
            }

            override fun close(status: WsStatus) {
                drawing.close(app, caller, status)
                ws.close(status)
            }

            override fun onMessage(fn: (WsMessage) -> Unit) = ws.onMessage { within { fn(it) } }

            override fun onClose(fn: (WsStatus) -> Unit) = ws.onClose { within { fn(it) } }

            override fun onError(fn: (Throwable) -> Unit) = ws.onError { within { fn(it) } }
        }
    }
}
