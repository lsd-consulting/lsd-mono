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
import java.time.Instant

/**
 * Draws each request the app serves, from its caller to [app], and the reply (or the exception
 * it threw), in the scenario the request belongs to: the one a client filter in this JVM is
 * calling from, the one named by the `lsd-scenario` header, the scenario bound to the thread
 * (a test calling the handler directly), or the only one running (a server's own thread). With
 * none, the request passes through untouched. While the app serves the request the scenario is
 * bound to the thread, and the app's client filters draw their calls from [app], nested under it.
 */
internal class ServerFilter(
    private val app: String,
    private val client: String,
) : Filter {
    override fun invoke(next: HttpHandler): HttpHandler = { request -> serve(next, request) }

    private class Inbound(
        val scenario: LsdScenario,
        val id: String,
        val caller: String,
        val parent: String?,
    )

    private fun serve(
        next: HttpHandler,
        request: Request,
    ): Response {
        // The same filter twice in one chain draws the request once.
        if (Calls.serving.get()?.passed === request) return next(request)
        val inbound = guarded(null) { inbound(request) } ?: return next(request)
        val started = Instant.now()
        val sent = guarded(Captured(request, null)) { Bodies.capture(request) }
        guarded(Unit) {
            inbound.scenario.ingest(
                Interaction
                    .builder(InteractionKind.REQUEST, inbound.caller, app, Calls.label(request))
                    .interactionId(inbound.id)
                    .trace(Trace(inbound.scenario.correlationId, inbound.id, inbound.parent))
                    .source(Calls.SOURCE)
                    .startedAt(started)
                    .data(sent.data)
                    .headers(Calls.headers(request))
                    .build(),
            )
        }
        val previousServing = Calls.serving.get()
        val previousPending = Calls.pendingHere.get()
        Calls.serving.set(Serving(inbound.scenario, app, inbound.id, sent.message))
        Calls.pendingHere.set(null)
        val binding = inbound.scenario.bind()
        val t0 = System.nanoTime()
        val response =
            try {
                next(sent.message)
            } catch (e: Throwable) {
                reply(inbound, Calls.elapsedMs(t0), "error", e.javaClass.simpleName, e.toString(), null)
                throw e
            } finally {
                binding.close()
                Calls.serving.set(previousServing)
                Calls.pendingHere.set(previousPending)
            }
        val durationMs = Calls.elapsedMs(t0)
        val headers = guarded(null) { Calls.headers(response) }
        // A streamed reply is drawn once it has been read (see Bodies), so it is never held up.
        return Bodies.capture(response) { data ->
            reply(inbound, durationMs, response.status.code.toString(), Calls.statusLabel(response.status), data, headers)
        }
    }

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

    private fun reply(
        inbound: Inbound,
        durationMs: Double,
        status: String,
        label: String,
        data: Any?,
        headers: Map<String, String>?,
    ) = guarded(Unit) {
        inbound.scenario.ingest(
            Interaction
                .builder(InteractionKind.RESPONSE, app, inbound.caller, label)
                .status(status)
                .replyTo(inbound.id)
                .source(Calls.SOURCE)
                .durationMs(durationMs)
                .data(data)
                .headers(headers)
                .build(),
        )
    }
}
