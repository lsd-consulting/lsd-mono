@file:JvmName("LsdClientPlugin")

package io.lsdconsulting.lsd.mono.ktor

import io.ktor.client.HttpClient
import io.ktor.client.call.HttpClientCall
import io.ktor.client.call.replaceResponse
import io.ktor.client.plugins.api.ClientPlugin
import io.ktor.client.plugins.api.Send
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.statement.HttpResponseContainer
import io.ktor.client.statement.HttpResponsePipeline
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.content.OutgoingContent
import io.ktor.http.contentLength
import io.ktor.http.contentType
import io.ktor.util.AttributeKey
import io.ktor.utils.io.ByteChannel
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.InternalAPI
import io.ktor.utils.io.KtorDsl
import io.ktor.websocket.DefaultWebSocketSession
import io.ktor.websocket.WebSocketSession
import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.ktor.Calls.guarded
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch
import java.time.Instant

/** Settings for the [LsdClient] plugin. */
@KtorDsl
public class LsdClientConfig {
    /** Who the calls go to on the diagram; by default the host, or `localhost:8081` for loopback. */
    public var target: String? = null

    /** Who the calls come from when the app is not serving a call with [Lsd] (a test, say). */
    public var caller: String = LsdKtor.DEFAULT_CLIENT

    /** How many messages each WebSocket draws; the rest are counted in a note when it closes. */
    public var messagesShown: Int = LsdKtor.DEFAULT_MESSAGES_SHOWN
}

/**
 * Draws each call made through the `HttpClient`, from the app serving the call it is made in
 * (else [LsdClientConfig.caller]) to the target, with the bodies and the reply or the exception;
 * and each WebSocket it opens, from the handshake to the close. A call that reaches the [Lsd]
 * server plugin in this JVM, in memory or over a socket, is drawn by that plugin instead, under
 * the name it serves as, so it is drawn once. Calls that stay in memory (a `testApplication`
 * client's) or go to an allowed host (`lsd.mono.propagation.allowedHosts`, loopback by default)
 * carry the scenario in the `lsd-scenario` header; calls to anyone else carry nothing of ours.
 *
 * ```kotlin
 * val client = HttpClient(CIO) { install(LsdClient) { target = "Payments" } }
 * ```
 */
public val LsdClient: ClientPlugin<LsdClientConfig> =
    createClientPlugin("LsdClient", ::LsdClientConfig) {
        require(pluginConfig.messagesShown >= 0) { "messagesShown must not be negative" }
        val capture = ClientCapture(pluginConfig.target, pluginConfig.caller, pluginConfig.messagesShown, ClientCapture.inMemory(client))
        on(Send) { request -> capture.send(request) { proceed(it) } }
        // Before the WebSockets plugin turns the session into the one the app gets.
        client.responsePipeline.intercept(HttpResponsePipeline.Receive) { container ->
            capture.socket(context, container)?.let { proceedWith(it) }
        }
    }

internal class ClientCapture(
    private val target: String?,
    private val caller: String,
    private val shown: Int,
    private val inMemory: Boolean,
) {
    suspend fun send(
        request: HttpRequestBuilder,
        proceed: suspend (HttpRequestBuilder) -> HttpClientCall,
    ): HttpClientCall {
        // A request already through this plugin (installed twice) is drawn once.
        if (request.headers.contains(Calls.CALL_HEADER)) return proceed(request)
        val serving = currentCoroutineContext()[ServingElement]?.serving
        val scenario = guarded(null) { serving?.scenario ?: Calls.lsd.runningScenario() } ?: return proceed(request)
        val call = PendingCall(Calls.newId(), scenario, serving?.app ?: caller, serving?.spanId)
        val url = request.url.build()
        val sent = guarded(Sent(request.method.value, url, null, null)) {
            Sent(request.method.value, url, requestData(request.body), requestHeaders(request))
        }
        guarded(Unit) { tag(request, url, call) }
        val started = Instant.now()
        val t0 = System.nanoTime()
        val response =
            try {
                proceed(request)
            } catch (e: Throwable) {
                if (!call.isTaken) {
                    draw(call, sent, started)
                    reply(call, sent, Calls.elapsedMs(t0), "error", e.javaClass.simpleName, e.toString(), null)
                }
                throw e
            } finally {
                Calls.pending.remove(call.id)
            }
        if (call.isTaken) return response
        val durationMs = Calls.elapsedMs(t0)
        draw(call, sent, started)
        val status = response.response.status
        val headers = guarded(null) { Calls.headers(response.response.headers) }
        val replied = Bodies.Once { data -> reply(call, sent, durationMs, status.value.toString(), Calls.statusLabel(status), data, headers) }
        if (status == HttpStatusCode.SwitchingProtocols) {
            replied(null)
            guarded(Unit) { response.attributes.put(SOCKET, Socket(call, to(url))) }
            return response
        }
        return guarded(null) { body(response, replied) } ?: response.also { replied(null) }
    }

    /** What a request carries, as drawn. */
    private class Sent(
        val method: String,
        val url: Url,
        val data: Any?,
        val headers: Map<String, String>?,
    )

    /** A WebSocket handshake this plugin drew, for the session it opens to be drawn too. */
    class Socket(
        val call: PendingCall,
        val to: String,
    )

    private fun requestData(body: Any): Any? {
        val content = body as? OutgoingContent ?: return null
        val contentType = content.contentType?.toString()
        val encoding = Bodies.encoding(content.headers)
        return when (content) {
            is OutgoingContent.ByteArrayContent -> {
                val bytes = content.bytes()
                if (bytes.size > Bodies.LIMIT) Bodies.tooLarge(bytes.size.toLong()) else Bodies.show(bytes, encoding, contentType)
            }
            is OutgoingContent.ReadChannelContent, is OutgoingContent.WriteChannelContent ->
                Bodies.summary(contentType, encoding, content.contentLength)?.value ?: Bodies.unknownLength(contentType)
            else -> null
        }
    }

    private fun requestHeaders(request: HttpRequestBuilder): Map<String, String> {
        val content = request.body as? OutgoingContent
        val own =
            Headers.build {
                content?.contentType?.let { append(HttpHeaders.ContentType, it.toString()) }
                content?.contentLength?.let { append(HttpHeaders.ContentLength, it.toString()) }
            }
        return Calls.headers(request.headers.build(), content?.headers ?: Headers.Empty, own)
    }

    private fun tag(
        request: HttpRequestBuilder,
        url: Url,
        call: PendingCall,
    ) {
        val allowed = inMemory || call.scenario.bind().use { Calls.lsd.scenarioHeaderValue(url.host) } != null
        if (!allowed) return
        Calls.pending[call.id] = call
        request.headers.append(LsdHeaders.SCENARIO, call.scenario.correlationId)
        request.headers.append(Calls.CALLER_HEADER, call.caller)
        request.headers.append(Calls.CALL_HEADER, call.id)
        call.parent?.let { request.headers.append(Calls.PARENT_SPAN_HEADER, it) }
    }

    /**
     * The call as the app gets it, with its body drawn: one of known length up to the limit is
     * read now and handed on as the same bytes; one of unknown length is copied as it is read,
     * and drawn when it ends or is closed. Null to hand on the call as it is.
     */
    @OptIn(InternalAPI::class)
    private suspend fun body(
        call: HttpClientCall,
        replied: (Any?) -> Unit,
    ): HttpClientCall? {
        val response = call.response
        val contentType = response.contentType()?.toString()
        val length = response.contentLength()
        Bodies.summary(contentType, Bodies.encoding(response.headers), length)?.let {
            replied(it.value)
            return null
        }
        val raw = response.rawContent
        if (length != null) {
            val head = Bodies.readHead(raw, length.toInt())
            replied(head.getOrNull()?.let { Bodies.show(it, null, contentType) })
            val channel = head.fold({ ByteReadChannel(it) }, { e -> ByteChannel().also { it.cancel(e) } })
            return call.replaceResponse { channel }
        }
        val pipe = ByteChannel()
        response.launch {
            try {
                Bodies.Keeper(contentType, replied).copy(raw, pipe)
                pipe.flushAndClose()
            } catch (e: Throwable) {
                pipe.cancel(e)
            }
        }
        return call.replaceResponse { pipe }
    }

    /** The raw session of a WebSocket this plugin drew the handshake of, drawn as it is used. */
    fun socket(
        call: HttpClientCall,
        container: HttpResponseContainer,
    ): HttpResponseContainer? =
        guarded(null) {
            val socket = call.attributes.getOrNull(SOCKET) ?: return@guarded null
            val session = container.response as? WebSocketSession ?: return@guarded null
            call.attributes.remove(SOCKET)
            // An engine that hands over a session with its own pings and close (OkHttp, Java):
            // the handshake is drawn, the messages are not.
            if (session is DefaultWebSocketSession) return@guarded null
            val from = socket.call.caller
            val tap = WsTap(WsDrawing(socket.call.scenario, from, shown), from, socket.to)
            HttpResponseContainer(container.expectedType, tap.wrap(session))
        }

    private fun to(url: Url): String = target ?: nameOf(url)

    private fun draw(
        call: PendingCall,
        sent: Sent,
        started: Instant,
    ) = guarded(Unit) {
        call.scenario.ingest(
            Interaction(
                kind = InteractionKind.REQUEST,
                from = call.caller,
                to = to(sent.url),
                label = Calls.label(sent.method, sent.url.encodedPath, sent.url.encodedQuery),
                interactionId = call.id,
                trace = Trace(call.scenario.correlationId, call.id, call.parent),
                source = Calls.SOURCE,
                startedAt = started,
                data = sent.data,
                headers = sent.headers,
            ),
        )
    }

    private fun reply(
        call: PendingCall,
        sent: Sent,
        durationMs: Double,
        status: String,
        label: String,
        data: Any?,
        headers: Map<String, String>?,
    ) = guarded(Unit) {
        call.scenario.ingest(
            Interaction(
                kind = InteractionKind.RESPONSE,
                from = to(sent.url),
                to = call.caller,
                label = label,
                status = status,
                replyTo = call.id,
                source = Calls.SOURCE,
                durationMs = durationMs,
                data = data,
                headers = headers,
            ),
        )
    }

    companion object {
        val SOCKET: AttributeKey<Socket> = AttributeKey("lsd-mono.socket")

        /** A loopback service is `localhost:8081`; any other host is named as it is. */
        fun nameOf(url: Url): String {
            val host = url.host
            val loopback = host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
            return if (loopback && url.specifiedPort != 0) "$host:${url.specifiedPort}" else host
        }

        /** Where the engines of `testApplication`'s clients are: their calls never leave this JVM. */
        private const val TEST_ENGINES = "io.ktor.server.testing.client."

        fun inMemory(client: HttpClient): Boolean = client.engine.javaClass.name
            .startsWith(TEST_ENGINES)
    }
}
