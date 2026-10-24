package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.reactivestreams.Publisher
import org.springframework.core.io.buffer.DataBuffer
import org.springframework.http.server.reactive.HttpHandler
import org.springframework.http.server.reactive.ServerHttpResponse
import org.springframework.http.server.reactive.ServerHttpResponseDecorator
import reactor.core.publisher.Flux
import reactor.core.publisher.Mono
import java.util.concurrent.atomic.AtomicReference

/**
 * Wraps the server's response, ahead of every WebFlux filter and exception handler, for a request
 * made during a test, so the reply a failed handler gets from the app's error handling (Spring
 * Boot's error attributes, a `ProblemDetail`, a `@ControllerAdvice`) can be drawn as it is
 * written. [LsdWebFilter] arms it when the handler fails; until then, and for any request outside
 * a test, it only passes things through.
 */
internal class ErrorCapturingResponse(
    delegate: ServerHttpResponse,
) : ServerHttpResponseDecorator(delegate) {
    private val armed = AtomicReference<((Int, Any?, Map<String, String>) -> Unit)?>()
    private val tap = BodyTap()

    /** Draw the reply, with [draw], once the error is written. */
    fun arm(draw: (Int, Any?, Map<String, String>) -> Unit) = armed.set(draw)

    /** Draws the armed reply with its status and what was written of its body; once. */
    fun fire() {
        val draw = armed.getAndSet(null) ?: return
        guarded(Unit) { draw(statusCode?.value() ?: 500, tap.read(headers.contentType?.toString()), flatten(headers)) }
    }

    override fun writeWith(body: Publisher<out DataBuffer>): Mono<Void> {
        if (armed.get() == null) return super.writeWith(body)
        return super.writeWith(Flux.from(body).doOnNext(tap::copy).doOnComplete(::fire)).doFinally { fire() }
    }

    override fun writeAndFlushWith(body: Publisher<out Publisher<out DataBuffer>>): Mono<Void> {
        if (armed.get() == null) return super.writeAndFlushWith(body)
        return super.writeAndFlushWith(Flux.from(body).map { chunk -> Flux.from(chunk).doOnNext(tap::copy) }).doFinally { fire() }
    }

    override fun setComplete(): Mono<Void> {
        fire()
        return super.setComplete()
    }

    companion object {
        /** Ours, under whatever decorators came after it; null when the response was not wrapped. */
        fun of(response: ServerHttpResponse): ErrorCapturingResponse? {
            var current: ServerHttpResponse? = response
            while (current != null) {
                if (current is ErrorCapturingResponse) return current
                current = (current as? ServerHttpResponseDecorator)?.delegate
            }
            return null
        }

        /** The server's handler, wrapping the response of each request made during a test. */
        fun decorate(handler: HttpHandler): HttpHandler =
            HttpHandler { request, response ->
                val scenario = guarded(null) { SpringScenarios.resolve(request.headers.getFirst(LsdHeaders.SCENARIO)) }
                if (scenario == null) {
                    handler.handle(request, response)
                } else {
                    val capture = ErrorCapturingResponse(response)
                    // Whatever the app's error handling did or did not write, the reply is drawn by the end.
                    handler.handle(request, capture).doFinally { capture.fire() }
                }
            }
    }
}
