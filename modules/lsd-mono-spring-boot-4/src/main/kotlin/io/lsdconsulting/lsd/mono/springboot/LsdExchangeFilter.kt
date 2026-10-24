package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.reactivestreams.Publisher
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.context.EnvironmentAware
import org.springframework.core.env.Environment
import org.springframework.core.io.buffer.DataBuffer
import org.springframework.http.HttpHeaders
import org.springframework.http.client.reactive.ClientHttpRequest
import org.springframework.http.client.reactive.ClientHttpRequestDecorator
import org.springframework.web.reactive.function.client.ClientRequest
import org.springframework.web.reactive.function.client.ClientResponse
import org.springframework.web.reactive.function.client.ExchangeFilterFunction
import org.springframework.web.reactive.function.client.ExchangeFunction
import org.springframework.web.reactive.function.client.WebClient
import org.springframework.web.reactive.function.client.WebClientRequestException
import reactor.core.publisher.Flux
import reactor.core.publisher.Mono
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The `WebClient` twin of [LsdClientInterceptor]: draws every call a `WebClient` makes during a
 * test, `Shop → Pricing: POST /quotes` and the reply, and sends `lsd-scenario` to loopback hosts
 * (or `lsd.mono.propagation.allowedHosts`) so a second instrumented app joins the same diagram.
 *
 * Its scenario comes from Reactor's context when the call is part of a request [LsdWebFilter] is
 * serving, so a call made after any number of scheduler hops still lands in the right scenario.
 * Bodies are copied as they stream past, so the app reads them as it always would.
 */
internal class LsdExchangeFilter(
    private val names: ParticipantNames,
) : ExchangeFilterFunction {
    override fun filter(
        request: ClientRequest,
        next: ExchangeFunction,
    ): Mono<ClientResponse> =
        Mono.deferContextual { context ->
            val serving = guarded(null) { LsdReactor.read(context) }
            val scenario = serving?.scenario ?: guarded(null) { SpringScenarios.resolve() }
            if (scenario == null) {
                next.exchange(request)
            } else {
                exchange(request, next, scenario, serving?.parent ?: guarded(null) { SpringScenarios.parentOf(scenario) })
            }
        }

    private fun exchange(
        request: ClientRequest,
        next: ExchangeFunction,
        scenario: LsdScenario,
        parent: String?,
    ): Mono<ClientResponse> {
        val uri = request.url()
        // Inside a request or a listener the app is the caller; otherwise it is the test calling the app.
        val caller = if (parent == null) names.client else names.app
        val propagated =
            guarded(request) {
                val allowed = scenario.bind().use { LsdContext.instance.scenarioHeaderValue(uri) } ?: return@guarded request
                ClientRequest
                    .from(request)
                    .headers {
                        it.set(LsdHeaders.SCENARIO, allowed)
                        it.set(SpringScenarios.CALLER_HEADER, caller)
                        parent?.let { span -> it.set(LsdInboundFilter.PARENT_SPAN_HEADER, span) }
                    }.build()
            }
        // A call into this app's own server is drawn once, by its inbound filter.
        if (guarded(false) { names.isSelf(uri) }) return next.exchange(propagated)

        val call = Call(scenario, caller, guarded(uri.host ?: "?") { names.of(uri) }, parent, request)
        val tapped =
            guarded(propagated) {
                ClientRequest
                    .from(propagated)
                    .body { message, context -> propagated.body().insert(TappedRequest(message, call), context) }
                    .build()
            }
        return next
            .exchange(tapped)
            .doOnError { e ->
                call.request(null, null)
                val cause = if (e is WebClientRequestException) e.cause ?: e else e
                call.reply("error", cause.javaClass.simpleName, cause.message, null)
            }.doOnCancel { call.request(null, null) }
            .map { response -> guarded(response) { call.response(response) } }
    }

    /** One call: its request drawn once the body is written (or it fails), its reply once the body is read. */
    private inner class Call(
        val scenario: LsdScenario,
        val caller: String,
        val target: String,
        val parent: String?,
        val original: ClientRequest,
    ) {
        val id = SpringScenarios.newId()
        private val started = Instant.now()
        private val t0 = System.nanoTime()
        private val requested = AtomicBoolean()
        private val replied = AtomicBoolean()

        fun request(
            body: ByteArray?,
            headers: HttpHeaders?,
        ) {
            if (!requested.compareAndSet(false, true)) return
            guarded(Unit) {
                val uri = original.url()
                val query = uri.rawQuery?.let { "?$it" } ?: ""
                val sent = headers ?: original.headers()
                scenario.ingest(
                    Interaction(
                        kind = InteractionKind.REQUEST,
                        from = caller,
                        to = target,
                        label = "${original.method().name()} ${uri.rawPath.ifEmpty { "/" }}$query",
                        interactionId = id,
                        trace = Trace(scenario.correlationId, id, parent),
                        source = SpringScenarios.SOURCE,
                        startedAt = started,
                        data = body?.let { Bodies.read(it, sent.contentType?.toString()) },
                        headers = flatten(sent),
                    ),
                )
            }
        }

        fun response(response: ClientResponse): ClientResponse {
            request(null, null)
            val code = response.statusCode().value()
            val headers = response.headers().asHttpHeaders()
            val type = headers.contentType
            if (type != null && (type.subtype == "event-stream" || type.type == "multipart")) {
                reply(code.toString(), statusLabel(code), null, flatten(headers))
                return response
            }
            val tap = BodyTap()
            val drawn = { reply(code.toString(), statusLabel(code), tap.bytes()?.let { Bodies.read(it, type?.toString()) }, flatten(headers)) }
            return response
                .mutate()
                .body { body ->
                    body
                        .doOnNext(tap::copy)
                        .doOnComplete(drawn)
                        .doOnCancel(drawn)
                        .doOnError { drawn() }
                }.build()
        }

        fun reply(
            status: String,
            label: String,
            data: Any?,
            headers: Map<String, String>?,
        ) {
            if (!replied.compareAndSet(false, true)) return
            guarded(Unit) {
                scenario.ingest(
                    Interaction(
                        kind = InteractionKind.RESPONSE,
                        from = target,
                        to = caller,
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
        }
    }

    /** The outgoing request, copying the body the encoder writes; drawn once it is all written. */
    private class TappedRequest(
        delegate: ClientHttpRequest,
        private val call: Call,
    ) : ClientHttpRequestDecorator(delegate) {
        private val tap = BodyTap()

        override fun writeWith(body: Publisher<out DataBuffer>): Mono<Void> =
            super.writeWith(
                Flux
                    .from(body)
                    .doOnNext(tap::copy)
                    .doOnComplete { call.request(tap.bytes(), headers) },
            )

        override fun writeAndFlushWith(body: Publisher<out Publisher<out DataBuffer>>): Mono<Void> {
            call.request(null, headers)
            return super.writeAndFlushWith(body)
        }

        override fun setComplete(): Mono<Void> {
            call.request(null, headers)
            return super.setComplete()
        }
    }
}

/**
 * Adds [LsdExchangeFilter], once, to every `WebClient.Builder` bean (Spring Boot's own included)
 * and every `WebClient` bean, so a client the app builds itself with `WebClient.builder()` is drawn
 * too. A `WebClient` built inline, never a bean and not from Boot's builder, is not seen.
 */
internal class LsdWebClientPostProcessor :
    BeanPostProcessor,
    EnvironmentAware {
    private lateinit var env: Environment
    private val filter by lazy { LsdExchangeFilter(ParticipantNames(env)) }

    override fun setEnvironment(environment: Environment) {
        env = environment
    }

    override fun postProcessAfterInitialization(
        bean: Any,
        beanName: String,
    ): Any =
        guarded(bean) {
            when (bean) {
                is WebClient.Builder -> bean.also(::add)
                is WebClient -> if (has(bean.mutate())) bean else bean.mutate().also(::add).build()
                else -> bean
            }
        }

    private fun has(builder: WebClient.Builder): Boolean {
        var found = false
        builder.filters { filters -> found = filters.any { it is LsdExchangeFilter } }
        return found
    }

    private fun add(builder: WebClient.Builder) {
        builder.filters { filters -> if (filters.none { it is LsdExchangeFilter }) filters.add(filter) }
    }
}
