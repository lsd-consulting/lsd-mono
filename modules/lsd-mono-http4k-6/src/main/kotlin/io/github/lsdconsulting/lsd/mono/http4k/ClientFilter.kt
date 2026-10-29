package io.github.lsdconsulting.lsd.mono.http4k

import io.github.lsdconsulting.lsd.mono.http4k.Calls.guarded
import io.github.lsdconsulting.lsd.mono.jvm.Interaction
import io.github.lsdconsulting.lsd.mono.jvm.InteractionKind
import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.Trace
import org.http4k.core.Filter
import org.http4k.core.HttpHandler
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.Uri
import java.time.Instant

/**
 * Draws each call made through the handler it wraps, from the app serving the request on this
 * thread (else [caller]) to [target], with the reply or the exception. A call that reaches a
 * server filter in this JVM, in memory or over a socket, is drawn by that filter instead, under
 * the name it serves as, so it is drawn once. Calls with no host (an in-memory handler) or to an
 * allowed host (`lsd.mono.propagation.allowedHosts`, loopback by default) carry the scenario in
 * the `lsd-scenario` header; calls to anyone else carry nothing of ours.
 */
internal class ClientFilter(
    private val target: String?,
    private val caller: String,
) : Filter {
    override fun invoke(next: HttpHandler): HttpHandler = { request -> call(next, request) }

    private fun call(
        next: HttpHandler,
        request: Request,
    ): Response {
        // A request already through a client filter (the filter applied twice) is drawn once.
        if (request.header(Calls.CALL_HEADER) != null) return next(request)
        val serving = Calls.serving.get()
        val scenario = guarded(null) { serving?.scenario ?: Calls.lsd.runningScenario() } ?: return next(request)
        val from = serving?.app ?: caller
        val call = PendingCall(Calls.newId(), scenario, from, serving?.spanId)
        val tagged = guarded(request) { tag(request, call) }
        val sent = guarded(Captured(tagged, null)) { Bodies.capture(tagged) }
        val previous = Calls.pendingHere.get()
        Calls.pendingHere.set(call)
        val started = Instant.now()
        val t0 = System.nanoTime()
        val response =
            try {
                next(sent.message)
            } catch (e: Throwable) {
                if (!call.isTaken) {
                    draw(call, request, started, sent.data)
                    reply(call, request, Calls.elapsedMs(t0), "error", e.javaClass.simpleName, e.toString(), null)
                }
                throw e
            } finally {
                Calls.pendingHere.set(previous)
                Calls.pending.remove(call.id)
            }
        if (call.isTaken) return response
        val durationMs = Calls.elapsedMs(t0)
        draw(call, request, started, sent.data)
        val headers = guarded(null) { Calls.headers(response) }
        // A streamed reply is drawn once it has been read (see Bodies), so it is never held up.
        return Bodies.capture(response) { data ->
            reply(call, request, durationMs, response.status.code.toString(), Calls.statusLabel(response.status), data, headers)
        }
    }

    private fun tag(
        request: Request,
        call: PendingCall,
    ): Request {
        val host = request.uri.host
        val allowed = host.isEmpty() || call.scenario.bind().use { Calls.lsd.scenarioHeaderValue(host) } != null
        if (!allowed) return request
        Calls.pending[call.id] = call
        val tagged =
            request
                .header(LsdHeaders.SCENARIO, call.scenario.correlationId)
                .header(Calls.CALLER_HEADER, call.caller)
                .header(Calls.CALL_HEADER, call.id)
        return call.parent?.let { tagged.header(Calls.PARENT_SPAN_HEADER, it) } ?: tagged
    }

    private fun to(uri: Uri): String = target ?: nameOf(uri)

    private fun draw(
        call: PendingCall,
        request: Request,
        started: Instant,
        data: Any?,
    ) = guarded(Unit) {
        call.scenario.ingest(
            Interaction
                .builder(InteractionKind.REQUEST, call.caller, to(request.uri), Calls.label(request))
                .interactionId(call.id)
                .trace(Trace(call.scenario.correlationId, call.id, call.parent))
                .source(Calls.SOURCE)
                .startedAt(started)
                .data(data)
                .headers(Calls.headers(request))
                .build(),
        )
    }

    private fun reply(
        call: PendingCall,
        request: Request,
        durationMs: Double,
        status: String,
        label: String,
        data: Any?,
        headers: Map<String, String>?,
    ) = guarded(Unit) {
        call.scenario.ingest(
            Interaction
                .builder(InteractionKind.RESPONSE, to(request.uri), call.caller, label)
                .status(status)
                .replyTo(call.id)
                .source(Calls.SOURCE)
                .durationMs(durationMs)
                .data(data)
                .headers(headers)
                .build(),
        )
    }

    companion object {
        /** A loopback service is `localhost:8081`; any other host is named as it is. */
        fun nameOf(uri: Uri): String {
            val host = uri.host
            if (host.isEmpty()) return "Downstream"
            val loopback = host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
            return if (loopback && uri.port != null) "$host:${uri.port}" else host
        }
    }
}
