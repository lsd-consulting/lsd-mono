package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.Interaction
import io.github.lsdconsulting.lsd.mono.jvm.InteractionKind
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.Trace
import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpRequest
import org.springframework.http.HttpStatusCode
import org.springframework.http.client.ClientHttpRequestExecution
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.http.client.ClientHttpResponse
import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Draws every call a `RestClient` or `RestTemplate` built by Spring Boot makes during a test:
 * `Orders → Payments: POST /charges` and the reply. It also sends `lsd-scenario` to loopback hosts
 * (or `lsd.mono.propagation.allowedHosts`), so a second instrumented app joins the same diagram.
 */
internal class LsdClientInterceptor(
    private val names: ParticipantNames,
) : ClientHttpRequestInterceptor {
    override fun intercept(
        request: HttpRequest,
        body: ByteArray,
        execution: ClientHttpRequestExecution,
    ): ClientHttpResponse {
        val scenario = guarded(null) { SpringScenarios.resolve() } ?: return execution.execute(request, body)
        val uri = request.uri
        // Inside a request or a listener the app is the caller; otherwise it is the test calling the app.
        val parent = SpringScenarios.parentOf(scenario)
        val caller = if (parent == null) names.client else names.app
        guarded(Unit) {
            val allowed = scenario.bind().use { LsdContext.instance.scenarioHeaderValue(uri) }
            if (allowed != null) {
                request.headers.set(LsdHeaders.SCENARIO, allowed)
                request.headers.set(SpringScenarios.CALLER_HEADER, caller)
                parent?.let { request.headers.set(LsdInboundFilter.PARENT_SPAN_HEADER, it) }
            }
        }
        // A call into this app's own server is drawn once, by its inbound filter.
        if (names.isSelf(uri)) return execution.execute(request, body)

        val id = SpringScenarios.newId()
        val target = guarded(uri.host ?: "?") { names.of(uri) }
        val started = Instant.now()
        val t0 = System.nanoTime()
        guarded(Unit) {
            val query = uri.rawQuery?.let { "?$it" } ?: ""
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.REQUEST,
                    from = caller,
                    to = target,
                    label = "${request.method} ${uri.rawPath.ifEmpty { "/" }}$query",
                    interactionId = id,
                    trace = Trace(scenario.correlationId, id, parent),
                    source = SpringScenarios.SOURCE,
                    startedAt = started,
                    data = Bodies.read(body, request.headers.contentType?.toString()),
                    headers = flatten(request.headers),
                ),
            )
        }
        val response =
            try {
                execution.execute(request, body)
            } catch (e: IOException) {
                reply(scenario, id, target, caller, t0, "error", e.javaClass.simpleName, e.message)
                throw e
            }
        // An event stream is drawn as the app reads it, so the call still streams (see TappedEvents).
        val events = guarded(false) { Streams.isEventStream(response.headers.contentType?.toString()) }
        if (events) {
            return guarded<ClientHttpResponse>(response) {
                val code = response.statusCode.value()
                val headers = flatten(response.headers)
                TappedEvents(response) { summary ->
                    reply(scenario, id, target, caller, t0, code.toString(), statusLabel(code), summary, headers)
                }
            }
        }
        val buffered = guarded<ClientHttpResponse>(response) { BufferedResponse.of(response) }
        guarded(Unit) {
            val code = buffered.statusCode.value()
            val data = (buffered as? BufferedResponse)?.let { Bodies.read(it.bytes, it.headers.contentType?.toString()) }
            reply(scenario, id, target, caller, t0, code.toString(), statusLabel(code), data, flatten(buffered.headers))
        }
        return buffered
    }

    private fun reply(
        scenario: io.github.lsdconsulting.lsd.mono.jvm.LsdScenario,
        id: String,
        from: String,
        to: String,
        t0: Long,
        status: String,
        label: String,
        data: Any?,
        headers: Map<String, String>? = null,
    ) = guarded(Unit) {
        scenario.ingest(
            Interaction(
                kind = InteractionKind.RESPONSE,
                from = from,
                to = to,
                label = label,
                status = status,
                replyTo = id,
                source = SpringScenarios.SOURCE,
                durationMs = (System.nanoTime() - t0) / 1_000_000.0,
                data = data,
                headers = headers,
            ),
        )
    }

    private fun flatten(headers: HttpHeaders): Map<String, String> =
        headers
            .headerNames()
            .filterNot(SpringScenarios::isOwnHeader)
            .associateWith { headers.getValuesAsList(it).joinToString(", ") }
}

/** The response with its (small) body read once, so the diagram and the caller can both read it. */
internal class BufferedResponse(
    private val delegate: ClientHttpResponse,
    val bytes: ByteArray,
) : ClientHttpResponse {
    override fun getStatusCode(): HttpStatusCode = delegate.statusCode

    override fun getStatusText(): String = delegate.statusText

    override fun getHeaders(): HttpHeaders = delegate.headers

    override fun getBody(): InputStream = ByteArrayInputStream(bytes)

    override fun close() = delegate.close()

    companion object {
        fun of(response: ClientHttpResponse): ClientHttpResponse {
            val length = response.headers.contentLength
            if (length > Bodies.LIMIT) return response
            if (response.headers.contentType?.let { it.subtype == "event-stream" || it.type == "multipart" } == true) return response
            val bytes = response.body.readNBytes(Bodies.LIMIT + 1)
            if (bytes.size > Bodies.LIMIT) {
                return ConcatResponse(response, bytes)
            }
            return BufferedResponse(response, bytes)
        }
    }
}

/** A body too large to capture: hand back what was read, then the rest of the stream. */
private class ConcatResponse(
    private val delegate: ClientHttpResponse,
    private val head: ByteArray,
) : ClientHttpResponse by delegate {
    override fun getBody(): InputStream = java.io.SequenceInputStream(ByteArrayInputStream(head), delegate.body)
}

/**
 * An event stream, counted as the app reads it, with its first few events (see [SseTap]); never
 * held. The reply is drawn once: when the stream ends, or when the app closes it first (then it is
 * marked `truncated`, as the rest went unread). One the app never closes is never drawn.
 */
private class TappedEvents(
    private val delegate: ClientHttpResponse,
    private val draw: (Any?) -> Unit,
) : ClientHttpResponse by delegate {
    private val tap = SseTap()
    private val drawn = AtomicBoolean()

    @Volatile private var ended = false
    private var stream: InputStream? = null

    override fun getBody(): InputStream =
        synchronized(this) {
            stream ?: Tapped(delegate.body).also { stream = it }
        }

    override fun close() {
        try {
            finish()
        } finally {
            delegate.close()
        }
    }

    private fun finish() {
        if (drawn.compareAndSet(false, true)) guarded(Unit) { draw(tap.summary(cut = !ended)) }
    }

    private inner class Tapped(
        input: InputStream,
    ) : FilterInputStream(input) {
        override fun read(): Int {
            val b = super.read()
            if (b < 0) end() else guarded(Unit) { tap.copy(byteArrayOf(b.toByte())) }
            return b
        }

        override fun read(
            b: ByteArray,
            off: Int,
            len: Int,
        ): Int {
            val n = super.read(b, off, len)
            if (n < 0)
                end()
            else if (n > 0)
                guarded(Unit) { tap.copy(b, off, n) }
            return n
        }

        override fun close() {
            try {
                finish()
            } finally {
                super.close()
            }
        }

        private fun end() {
            ended = true
            finish()
        }
    }
}
