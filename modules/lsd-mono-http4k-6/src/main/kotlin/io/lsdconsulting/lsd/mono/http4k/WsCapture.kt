package io.lsdconsulting.lsd.mono.http4k

import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.http4k.Calls.guarded
import org.http4k.core.MemoryBody
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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Draws a WebSocket the app serves: the handshake as a call from its caller to [app] answered
 * `101 Switching Protocols`, then each message as an arrow (the first [shown] of them; the rest
 * are counted in a note when the socket closes), the close and any error. The scenario is the
 * one the handshake belongs to, as for [ServerFilter]; with none the socket passes through.
 */
internal class WsCapture(
    private val app: String,
    private val client: String,
    private val shown: Int,
) : WsFilter {
    override fun invoke(next: WsHandler): WsHandler = { request -> handshake(next, request) }

    private fun handshake(
        next: WsHandler,
        request: Request,
    ): WsResponse {
        val scenario =
            guarded(null) {
                Calls.lsd.findScenarioByHeader(request.header(LsdHeaders.SCENARIO)) ?: Calls.lsd.runningScenario()
            } ?: return next(request)
        val caller = request.header(Calls.CALLER_HEADER)?.takeIf { it.isNotBlank() } ?: client
        val id = Calls.newId()
        guarded(Unit) {
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.REQUEST,
                    from = caller,
                    to = app,
                    label = Calls.label(request),
                    interactionId = id,
                    trace = Trace(scenario.correlationId, id, request.header(Calls.PARENT_SPAN_HEADER)),
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
        val socket = Socket(scenario, app, caller, request, shown)
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
                durationMs = (System.nanoTime() - t0) / 1_000_000.0,
                data = data,
            ),
        )
    }

    /** One connection: what it has drawn, and how many messages it left out. */
    private class Socket(
        val scenario: LsdScenario,
        val app: String,
        val caller: String,
        val handshake: Request,
        val shown: Int,
    ) {
        private val drawn = AtomicInteger()
        private val skipped = AtomicInteger()
        private val closed = AtomicBoolean()

        @Volatile private var lastIn: String? = null

        fun tap(ws: Websocket): Websocket {
            // Registered before the app's own handlers, so a message is drawn before its replies.
            ws.onMessage { message(caller, app, it)?.let { id -> lastIn = id } }
            ws.onClose { close(caller, app, it) }
            ws.onError { error(it) }
            return Tapped(ws)
        }

        fun message(
            from: String,
            to: String,
            message: WsMessage,
        ): String? =
            guarded(null) {
                if (closed.get()) return@guarded null
                if (drawn.incrementAndGet() > shown) {
                    skipped.incrementAndGet()
                    return@guarded null
                }
                val id = Calls.newId()
                val (label, data) = describe(message)
                scenario.ingest(
                    Interaction(
                        kind = InteractionKind.MESSAGE,
                        from = from,
                        to = to,
                        label = label,
                        interactionId = id,
                        source = Calls.SOURCE,
                        startedAt = Instant.now(),
                        data = data,
                    ),
                )
                id
            }

        fun close(
            from: String,
            to: String,
            status: WsStatus,
        ) = guarded(Unit) {
            if (!closed.compareAndSet(false, true)) return@guarded
            val more = skipped.get()
            if (more > 0) scenario.note("… $more more WebSocket message${if (more == 1) "" else "s"} not drawn", on = app)
            val why = status.description.takeIf { it.isNotBlank() }?.let { " $it" } ?: ""
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.MESSAGE,
                    from = from,
                    to = to,
                    label = "close ${status.code}$why",
                    source = Calls.SOURCE,
                    startedAt = Instant.now(),
                ),
            )
        }

        fun error(e: Throwable) =
            guarded(Unit) {
                scenario.ingest(
                    Interaction(
                        kind = InteractionKind.MESSAGE,
                        from = caller,
                        to = app,
                        label = e.javaClass.simpleName,
                        status = "error",
                        source = Calls.SOURCE,
                        startedAt = Instant.now(),
                        data = e.toString(),
                    ),
                )
            }

        /** Runs an app handler with the scenario bound, so its HTTP calls are drawn from [app]. */
        fun <T> within(block: () -> T): T {
            val previous = Calls.serving.get()
            Calls.serving.set(Serving(scenario, app, lastIn ?: Calls.newId(), handshake))
            try {
                return scenario.bind().use { block() }
            } finally {
                Calls.serving.set(previous)
            }
        }

        private inner class Tapped(
            private val ws: Websocket,
        ) : Websocket {
            override fun send(message: WsMessage) {
                message(app, caller, message)
                ws.send(message)
            }

            override fun close(status: WsStatus) {
                close(app, caller, status)
                ws.close(status)
            }

            override fun onMessage(fn: (WsMessage) -> Unit) = ws.onMessage { within { fn(it) } }

            override fun onClose(fn: (WsStatus) -> Unit) = ws.onClose { within { fn(it) } }

            override fun onError(fn: (Throwable) -> Unit) = ws.onError { within { fn(it) } }
        }
    }

    companion object {
        private const val LABEL_CHARS = 40

        /** A text message is labelled with its start and shown whole; binary by its size. */
        fun describe(message: WsMessage): Pair<String, Any?> {
            val body = message.body
            if (body !is MemoryBody) return "binary stream" to null
            val view = body.payload.duplicate()
            val size = view.remaining()
            if (message.mode == WsMessage.Mode.Binary) return "binary ($size bytes)" to null
            val bytes = ByteArray(minOf(view.remaining(), Bodies.LIMIT)).also { view.get(it) }
            val text = String(bytes, Charsets.UTF_8)
            val oneLine = text.replace(Regex("\\s+"), " ").trim()
            val label = if (oneLine.length > LABEL_CHARS) oneLine.take(LABEL_CHARS - 1) + "…" else oneLine
            return label to bytes.takeIf { it.isNotEmpty() }?.let { JsonText.parse(it) ?: it }
        }
    }
}
