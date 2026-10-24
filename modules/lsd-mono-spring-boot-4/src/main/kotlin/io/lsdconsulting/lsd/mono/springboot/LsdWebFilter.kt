package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.reactivestreams.Publisher
import org.springframework.core.Ordered
import org.springframework.core.io.buffer.DataBuffer
import org.springframework.core.io.buffer.DataBufferUtils
import org.springframework.http.HttpHeaders
import org.springframework.http.server.reactive.ServerHttpRequest
import org.springframework.http.server.reactive.ServerHttpRequestDecorator
import org.springframework.http.server.reactive.ServerHttpResponse
import org.springframework.http.server.reactive.ServerHttpResponseDecorator
import org.springframework.web.ErrorResponse
import org.springframework.web.server.ServerWebExchange
import org.springframework.web.server.WebFilter
import org.springframework.web.server.WebFilterChain
import reactor.core.publisher.Flux
import reactor.core.publisher.Mono
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The WebFlux twin of [LsdInboundFilter]: draws every request a reactive app serves during a test,
 * annotated controllers and router functions alike, `Client → Shop: POST /orders`, and the reply
 * with its status, body and latency. The request it is serving goes into Reactor's context (see
 * [LsdReactor]) so its outbound `WebClient` calls nest under it on whatever thread they run.
 * Outside a test (no scenario running) it passes straight through.
 *
 * Nothing is drawn or entered until the server subscribes: a filter chain that is assembled but
 * never run leaves no request behind, and the request is served from subscription to its end.
 */
internal class LsdWebFilter(
    private val names: ParticipantNames,
) : WebFilter,
    Ordered {
    override fun getOrder(): Int = Ordered.HIGHEST_PRECEDENCE + 10

    override fun filter(
        exchange: ServerWebExchange,
        chain: WebFilterChain,
    ): Mono<Void> {
        val request = exchange.request
        val scenario =
            guarded(null) { SpringScenarios.resolve(request.headers.getFirst(LsdHeaders.SCENARIO)) }
                ?: return chain.filter(exchange)
        // A small body of known length is read up front and handed to the app again, as the servlet filter does.
        val cache =
            guarded(false) {
                request.headers.contentLength in 1..Bodies.LIMIT.toLong() && request.headers.contentType?.type != "multipart"
            }
        if (!cache) return Mono.defer { serve(exchange, chain, scenario, null) }
        return DataBufferUtils
            .join(request.body)
            .map { joined ->
                try {
                    ByteArray(joined.readableByteCount()).also { joined.read(it) }
                } finally {
                    DataBufferUtils.release(joined)
                }
            }.defaultIfEmpty(ByteArray(0))
            .flatMap { serve(exchange, chain, scenario, it) }
    }

    /** Called once the server subscribes (from [Mono.defer] or once the body is read), never before. */
    private fun serve(
        exchange: ServerWebExchange,
        chain: WebFilterChain,
        scenario: LsdScenario,
        body: ByteArray?,
    ): Mono<Void> {
        val request = exchange.request
        val id = SpringScenarios.newId()
        val caller = request.headers.getFirst(SpringScenarios.CALLER_HEADER)?.takeIf { it.isNotBlank() } ?: names.client
        val t0 = System.nanoTime()
        guarded(Unit) {
            val query = request.uri.rawQuery?.let { "?$it" } ?: ""
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.REQUEST,
                    from = caller,
                    to = names.app,
                    label = "${request.method.name()} ${request.path.value()}$query",
                    interactionId = id,
                    trace = Trace(scenario.correlationId, id, request.headers.getFirst(LsdInboundFilter.PARENT_SPAN_HEADER)),
                    source = SpringScenarios.SOURCE,
                    startedAt = Instant.now(),
                    data = body?.let { Bodies.read(it, request.headers.contentType?.toString()) },
                    headers = flatten(request.headers),
                ),
            )
        }
        val response = TappedResponse(exchange.response)
        val served =
            guarded(exchange) {
                exchange
                    .mutate()
                    .request(if (body == null) request else ReplayedRequest(request, body))
                    .response(response)
                    .build()
            }
        val done = AtomicBoolean()

        fun finish(
            failure: Throwable?,
            cancelled: Boolean = false,
        ) {
            if (!done.compareAndSet(false, true)) return
            SpringScenarios.leave(scenario, id)
            guarded(Unit) {
                val set = response.statusCode?.value() ?: 200
                val status =
                    when {
                        failure is ErrorResponse -> failure.statusCode.value()
                        failure != null && set < 400 -> 500
                        else -> set
                    }
                // The client went away (or the test stopped waiting) before the app answered: no
                // status was sent, so none is made up. "cancelled" is not an HTTP code or an error
                // word, so it is neither drawn red nor counted as an error; a test that gave up
                // fails on its own.
                val shown = if (cancelled) CANCELLED else status.toString()
                scenario.ingest(
                    Interaction(
                        kind = InteractionKind.RESPONSE,
                        from = names.app,
                        to = caller,
                        label = if (cancelled) CANCELLED else statusLabel(status),
                        status = shown,
                        replyTo = id,
                        source = SpringScenarios.SOURCE,
                        durationMs = (System.nanoTime() - t0) / 1_000_000.0,
                        data =
                            when {
                                cancelled -> null
                                failure != null -> failure.toString()
                                else -> response.tap.bytes()?.let { Bodies.read(it, response.headers.contentType?.toString()) }
                            },
                        headers = flatten(response.headers),
                    ),
                )
            }
        }

        SpringScenarios.enter(scenario, id)
        // A chain that throws instead of returning a Mono still gets its reply and leaves the request.
        val handled =
            try {
                chain.filter(served)
            } catch (e: Exception) {
                Mono.error(e)
            }
        return handled
            .contextWrite { LsdReactor.write(it, LsdReactor.Serving(scenario, id)) }
            .doOnSuccess { finish(null) }
            .doOnError { finish(it) }
            .doOnCancel { finish(null, cancelled = true) }
    }

    private companion object {
        /** The status and label of a reply the client never waited for. */
        const val CANCELLED = "cancelled"
    }
}

internal fun flatten(headers: HttpHeaders): Map<String, String> =
    headers
        .headerNames()
        .filterNot(SpringScenarios::isOwnHeader)
        .associateWith { headers.getValuesAsList(it).joinToString(", ") }

/** The request with the body read up front, handed to the app again as one buffer. */
private class ReplayedRequest(
    delegate: ServerHttpRequest,
    private val bytes: ByteArray,
) : ServerHttpRequestDecorator(delegate) {
    override fun getBody(): Flux<DataBuffer> =
        Flux.defer {
            if (bytes.isEmpty())
                Flux.empty()
            else
                Flux.just(
                    org.springframework.core.io.buffer.DefaultDataBufferFactory.sharedInstance
                        .wrap(bytes),
                )
        }
}

/** The response, copying what the app writes on its way to the client; a stream (SSE) is left alone. */
private class TappedResponse(
    delegate: ServerHttpResponse,
) : ServerHttpResponseDecorator(delegate) {
    val tap = BodyTap()

    override fun writeWith(body: Publisher<out DataBuffer>): Mono<Void> = super.writeWith(Flux.from(body).doOnNext(tap::copy))
}
