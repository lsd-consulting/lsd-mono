package io.lsdconsulting.lsd.mono.http4k

import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.http4k.Calls.guarded
import org.http4k.core.Headers
import org.http4k.core.Method
import org.http4k.core.Request
import org.http4k.core.Uri
import org.http4k.websocket.Websocket
import org.http4k.websocket.WebsocketFactory
import org.http4k.websocket.WsClient
import org.http4k.websocket.WsConsumer
import org.http4k.websocket.WsMessage
import org.http4k.websocket.WsStatus
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Draws each WebSocket opened through [factory], from the app serving the current request (else
 * [caller]) to [target] (else the host, as for [ClientFilter]): the handshake, the messages it
 * sends and receives (the first [shown]), the close and any error. The handshake carries the
 * scenario as [ClientFilter]'s calls do, so a socket that reaches a [WsCapture] in this JVM is
 * drawn there, once, under the name the server gives itself; this draws only one nobody else did.
 */
internal class WsClientCapture(
    private val factory: WebsocketFactory,
    private val target: String?,
    private val caller: String,
    private val shown: Int,
) : WebsocketFactory {
    override fun nonBlocking(
        uri: Uri,
        headers: Headers,
        onError: (Throwable) -> Unit,
        onConnect: WsConsumer,
    ): Websocket {
        val call = guarded(null) { open(uri, headers) } ?: return factory.nonBlocking(uri, headers, onError, onConnect)
        val ws =
            call.connecting {
                factory.nonBlocking(
                    uri,
                    call.headers,
                    { e ->
                        call.failed(e)
                        onError(e)
                    },
                    { ws ->
                        call.connected()
                        onConnect(call.tapped(ws))
                    },
                )
            }
        return call.tapped(ws)
    }

    override fun blocking(
        uri: Uri,
        headers: Headers,
    ): WsClient {
        val call = guarded(null) { open(uri, headers) } ?: return factory.blocking(uri, headers)
        val client = call.connecting { factory.blocking(uri, call.headers) }
        call.connected()
        return call.Client(client)
    }

    private fun open(
        uri: Uri,
        headers: Headers,
    ): Socket? {
        // Headers already through a client capture (wrapped twice) are drawn once.
        if (headers.any { it.first.equals(Calls.CALL_HEADER, ignoreCase = true) }) return null
        val serving = Calls.serving.get()
        val scenario = serving?.scenario ?: Calls.lsd.runningScenario() ?: return null
        val call = PendingCall(Calls.newId(), scenario, serving?.app ?: caller, serving?.spanId)
        return Socket(call, uri, headers)
    }

    /** One socket this side opened, until a server capture in this JVM takes it over. */
    private inner class Socket(
        val call: PendingCall,
        val uri: Uri,
        appHeaders: Headers,
    ) {
        val local: String = call.caller
        val remote: String = target ?: ClientFilter.nameOf(uri)
        val drawing = WsDrawing(call.scenario, local, shown)
        private val handshake = Request(Method.GET, uri).headers(appHeaders)
        private val started = Instant.now()
        private val t0 = System.nanoTime()
        private val settled = AtomicBoolean()
        private val listening = AtomicBoolean()

        @Volatile private var tappedWs: Tapped? = null

        /** The handshake was drawn as made: a send is drawn before it goes, so it shows before any reply. */
        @Volatile private var open = false

        /** The handshake was drawn as failed: what the socket reports after (its error again, a close) is not. */
        @Volatile private var refused = false

        /** The app's headers, with the scenario added for a host it may go to. */
        val headers: Headers = guarded(appHeaders) { tag(appHeaders) }

        /** Drawing here: nobody took the handshake over. */
        val drawingHere: Boolean get() = !call.isTaken

        private fun tag(headers: Headers): Headers {
            val host = uri.host
            val allowed = host.isEmpty() || call.scenario.bind().use { Calls.lsd.scenarioHeaderValue(host) } != null
            if (!allowed) return headers
            Calls.pending[call.id] = call
            val ours =
                listOfNotNull(
                    LsdHeaders.SCENARIO to call.scenario.correlationId,
                    Calls.CALLER_HEADER to call.caller,
                    Calls.CALL_HEADER to call.id,
                    call.parent?.let { Calls.PARENT_SPAN_HEADER to it },
                )
            return headers + ours
        }

        /** Opens the socket with the call pending here, so an in-memory server takes it over. */
        fun <T> connecting(open: () -> T): T {
            val previous = Calls.pendingHere.get()
            Calls.pendingHere.set(call)
            try {
                return open()
            } catch (e: Throwable) {
                failed(e)
                throw e
            } finally {
                Calls.pendingHere.set(previous)
            }
        }

        fun connected() {
            if (settle("101", "101 Switching Protocols", null)) open = true
        }

        fun failed(e: Throwable) {
            if (settle("error", e.javaClass.simpleName, e.toString())) refused = true
        }

        /** Drawing what the socket reports: here, and it opened. */
        private val drawingSocket: Boolean get() = drawingHere && !refused

        /** Draws the handshake and its outcome once, unless a server capture took it over; true if this settled it. */
        private fun settle(
            status: String,
            label: String,
            data: Any?,
        ): Boolean {
            if (!settled.compareAndSet(false, true)) return false
            Calls.pending.remove(call.id)
            if (!drawingHere) return true
            guarded(Unit) {
                call.scenario.ingest(
                    Interaction(
                        kind = InteractionKind.REQUEST,
                        from = local,
                        to = remote,
                        label = Calls.label(handshake),
                        interactionId = call.id,
                        trace = Trace(call.scenario.correlationId, call.id, call.parent),
                        source = Calls.SOURCE,
                        startedAt = started,
                        headers = Calls.headers(handshake),
                    ),
                )
                call.scenario.ingest(
                    Interaction(
                        kind = InteractionKind.RESPONSE,
                        from = remote,
                        to = local,
                        label = label,
                        status = status,
                        replyTo = call.id,
                        source = Calls.SOURCE,
                        durationMs = Calls.elapsedMs(t0),
                        data = data,
                    ),
                )
            }
            return true
        }

        /** The socket as the app sees it; ours listen first, so a message is drawn before the app reacts. */
        fun tapped(ws: Websocket): Websocket {
            if (listening.compareAndSet(false, true)) {
                ws.onMessage { if (drawingSocket) drawing.message(remote, local, it) }
                ws.onClose { if (drawingSocket) drawing.close(remote, local, it) }
                ws.onError { if (drawingSocket) drawing.error(remote, local, it) }
            }
            return tappedWs?.takeIf { it.ws === ws } ?: Tapped(ws).also { tappedWs = it }
        }

        /** Runs an app handler with the scenario bound, so what it does lands in this test. */
        private fun <T> within(block: () -> T): T = call.scenario.bind().use { block() }

        private inner class Tapped(
            val ws: Websocket,
        ) : Websocket {
            /** Before the handshake is drawn, only a send that went is drawn, after it. */
            override fun send(message: WsMessage) {
                if (open) {
                    if (drawingHere) drawing.message(local, remote, message)
                    ws.send(message)
                } else {
                    ws.send(message)
                    if (drawingSocket) drawing.message(local, remote, message)
                }
            }

            override fun close(status: WsStatus) {
                if (drawingSocket) drawing.close(local, remote, status)
                ws.close(status)
            }

            override fun onMessage(fn: (WsMessage) -> Unit) = ws.onMessage { within { fn(it) } }

            override fun onClose(fn: (WsStatus) -> Unit) = ws.onClose { within { fn(it) } }

            override fun onError(fn: (Throwable) -> Unit) = ws.onError { within { fn(it) } }
        }

        /**
         * The blocking client: what it sends, and each message as the app takes it from
         * [received]. A close from the other end is not drawn (the sequence only ends).
         */
        inner class Client(
            private val client: WsClient,
        ) : WsClient {
            override fun received(): Sequence<WsMessage> =
                sequence {
                    val messages = client.received().iterator()
                    while (true) {
                        val next =
                            try {
                                if (!messages.hasNext()) break
                                messages.next()
                            } catch (e: Throwable) {
                                if (drawingHere) drawing.error(remote, local, e)
                                throw e
                            }
                        if (drawingHere) drawing.message(remote, local, next)
                        yield(next)
                    }
                }

            override fun send(message: WsMessage) {
                if (drawingHere) drawing.message(local, remote, message)
                client.send(message)
            }

            override fun close(status: WsStatus) {
                if (drawingHere) drawing.close(local, remote, status)
                client.close(status)
            }
        }
    }
}
