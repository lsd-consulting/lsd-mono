@file:JvmName("LsdServer")

package io.lsdconsulting.lsd.mono.ktor

import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.ApplicationPlugin
import io.ktor.server.application.Hook
import io.ktor.server.application.PipelineCall
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.application.hooks.ResponseBodyReadyForSend
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.request.queryString
import io.ktor.util.AttributeKey
import io.ktor.util.pipeline.PipelinePhase
import io.ktor.utils.io.ByteChannel
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.InternalAPI
import io.ktor.utils.io.KtorDsl
import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.ktor.Calls.guarded
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException

/** Settings for the [Lsd] server plugin. */
@KtorDsl
public class LsdConfig {
    /** The app on the diagram: requests are drawn to it, and its own calls from it. */
    public var app: String = LsdKtor.DEFAULT_APP

    /** Who a request comes from when no client plugin in this JVM says (a test, say). */
    public var client: String = LsdKtor.DEFAULT_CLIENT

    /** How many messages each WebSocket draws; the rest are counted in a note when it closes. */
    public var messagesShown: Int = LsdKtor.DEFAULT_MESSAGES_SHOWN
}

/**
 * Draws each call the app serves, from its caller to [LsdConfig.app], with the request and reply
 * bodies, the status, and an exception that fails the call; and each WebSocket the app serves,
 * from the handshake to the close. The call belongs to the scenario a client plugin in this JVM
 * is calling from, the one named by the `lsd-scenario` header, or the only one running; with
 * none it passes through untouched. While the app serves it the scenario is bound to the
 * coroutine, so calls through an `HttpClient` with [LsdClient] are drawn from the app, nested
 * under this one.
 *
 * ```kotlin
 * install(Lsd) { app = "Shop" }
 * ```
 */
public val Lsd: ApplicationPlugin<LsdConfig> =
    createApplicationPlugin("Lsd", ::LsdConfig) {
        require(pluginConfig.messagesShown >= 0) { "messagesShown must not be negative" }
        val server = ServerCapture(pluginConfig.app, pluginConfig.client, pluginConfig.messagesShown)
        on(ServeHook) { call, proceed -> server.serve(call, proceed) }
        on(ResponseBodyReadyForSend) { call, content -> server.ready(call, content)?.let { transformBodyTo(it) } }
    }

/**
 * Runs the rest of the call (routing, the handler, other plugins) inside the handler given, in a
 * phase before every other: before StatusPages' whichever was installed first, so an exception
 * reaches it only when nothing inside turned it into a reply.
 */
private object ServeHook : Hook<suspend (PipelineCall, suspend () -> Unit) -> Unit> {
    private val phase = PipelinePhase("LsdServe")

    override fun install(
        pipeline: ApplicationCallPipeline,
        handler: suspend (PipelineCall, suspend () -> Unit) -> Unit,
    ) {
        pipeline.insertPhaseBefore(pipeline.items.first(), phase)
        pipeline.intercept(phase) { handler(context) { proceed() } }
    }
}

internal class ServerCapture(
    private val app: String,
    private val client: String,
    private val shown: Int,
) {
    internal class Inbound(
        val scenario: LsdScenario,
        val id: String,
        val caller: String,
        val parent: String?,
        /** Shared with the client plugin of a call it took, so exactly one of them draws the reply. */
        val replied: AtomicBoolean = AtomicBoolean(),
    ) {
        val t0: Long = System.nanoTime()
    }

    suspend fun serve(
        call: PipelineCall,
        proceed: suspend () -> Unit,
    ) {
        val inbound = guarded(null) { inbound(call) } ?: return proceed()
        call.attributes.put(INBOUND, inbound)
        val started = Instant.now()
        val data = guarded(null) { requestBody(call) }
        guarded(Unit) {
            inbound.scenario.ingest(
                Interaction(
                    kind = InteractionKind.REQUEST,
                    from = inbound.caller,
                    to = app,
                    label = Calls.label(call.request.httpMethod.value, call.request.path(), call.request.queryString()),
                    interactionId = inbound.id,
                    trace = Trace(inbound.scenario.correlationId, inbound.id, inbound.parent),
                    source = Calls.SOURCE,
                    startedAt = started,
                    data = data,
                    headers = Calls.headers(call.request.headers),
                ),
            )
        }
        try {
            withContext(ServingElement(Serving(inbound.scenario, app) { inbound.id })) { proceed() }
        } catch (e: Throwable) {
            // Nothing inside the plugin (StatusPages, say) turned it into a reply: the exception is
            // the reply. A cancelled call (the caller went away) has none here: a client plugin in
            // this JVM draws the failure it saw instead.
            if (e !is CancellationException && inbound.replied.compareAndSet(false, true)) {
                reply(inbound, Calls.elapsedMs(inbound.t0), "error", e.javaClass.simpleName, e.toString(), null)
            }
            throw e
        }
    }

    private fun inbound(call: ApplicationCall): Inbound? {
        val headers = call.request.headers
        val pending = headers[Calls.CALL_HEADER]?.let { Calls.pending[it] }?.takeIf { it.take(app) }
        if (pending != null) return Inbound(pending.scenario, pending.id, pending.caller, pending.parent, pending.replied)
        val scenario =
            Calls.lsd.findScenarioByHeader(headers[LsdHeaders.SCENARIO])
                ?: Calls.lsd.runningScenario()
                ?: return null
        val caller = headers[Calls.CALLER_HEADER]?.takeIf { it.isNotBlank() } ?: client
        return Inbound(scenario, Calls.newId(), caller, headers[Calls.PARENT_SPAN_HEADER])
    }

    /**
     * The request body as drawn. One of known length up to the limit is read now, and the app is
     * handed the same bytes; anything else is summarised and left for the app to read.
     */
    @OptIn(InternalAPI::class)
    private suspend fun requestBody(call: PipelineCall): Any? {
        val headers = call.request.headers
        val contentType = headers[HttpHeaders.ContentType]
        val length = headers[HttpHeaders.ContentLength]?.toLongOrNull()
        val encoding = Bodies.encoding(headers)
        Bodies.summary(contentType, encoding, length)?.let { return it.value }
        if (length == null) return if (headers[HttpHeaders.TransferEncoding] == null) null else Bodies.unknownLength(contentType)
        val head = Bodies.readHead(call.request.receiveChannel(), length.toInt())
        // Hand the app the same bytes, or the same failure, as if it had read them itself.
        call.request.setReceiveChannel(head.fold({ ByteReadChannel(it) }, { e -> ByteChannel().also { it.cancel(e) } }))
        return head.getOrNull()?.let { Bodies.show(it, null, contentType) }
    }

    /** The reply, drawn once: now, or once a streamed body has been written. */
    fun ready(
        call: ApplicationCall,
        content: OutgoingContent,
    ): OutgoingContent? {
        val inbound = call.attributes.getOrNull(INBOUND) ?: return null
        if (!inbound.replied.compareAndSet(false, true)) return null
        val durationMs = Calls.elapsedMs(inbound.t0)
        val status = call.response.status() ?: content.status ?: HttpStatusCode.OK
        val headers = guarded(null) { Calls.headers(call.response.headers.allValues(), content.headers, contentHeaders(content)) }
        val label = Calls.statusLabel(status)
        if (content is OutgoingContent.ProtocolUpgrade) {
            reply(inbound, durationMs, status.value.toString(), label, null, headers)
            if (content.javaClass.name != WEB_SOCKET_UPGRADE) return null
            return guarded(null) { ServerSockets.tap(content, inbound, app, shown) }
        }
        val encoding = Bodies.encoding(content.headers) ?: Bodies.encoding(call.response.headers[HttpHeaders.ContentEncoding])
        return Bodies.respond(content, encoding) { data -> reply(inbound, durationMs, status.value.toString(), label, data, headers) }
    }

    private fun contentHeaders(content: OutgoingContent): Headers =
        Headers.build {
            content.contentType?.let { append(HttpHeaders.ContentType, it.toString()) }
            content.contentLength?.let { append(HttpHeaders.ContentLength, it.toString()) }
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
            Interaction(
                kind = InteractionKind.RESPONSE,
                from = app,
                to = inbound.caller,
                label = label,
                status = status,
                replyTo = inbound.id,
                source = Calls.SOURCE,
                durationMs = durationMs,
                data = data,
                headers = headers,
            ),
        )
    }

    companion object {
        val INBOUND: AttributeKey<Inbound> = AttributeKey("lsd-mono.inbound")

        /** By name, so an app without Ktor's WebSockets never loads [ServerSockets]. */
        const val WEB_SOCKET_UPGRADE: String = "io.ktor.server.websocket.WebSocketUpgrade"
    }
}
