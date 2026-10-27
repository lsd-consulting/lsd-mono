package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.core.io.buffer.DataBuffer
import org.springframework.core.io.buffer.DataBufferUtils
import org.springframework.http.server.reactive.ServerHttpRequest
import org.springframework.http.server.reactive.ServerHttpRequestDecorator
import reactor.core.publisher.Flux
import reactor.core.publisher.Mono
import java.util.concurrent.atomic.AtomicBoolean

/**
 * A reactive multipart request whose first [Bodies.LIMIT] bytes were read before the app saw it,
 * so [LsdWebFilter] can draw its parts (name, file name, type and size, never the contents). The
 * app reads the whole body as sent: what was read is handed over first, then the rest as it comes.
 *
 * It wraps the request ahead of the exchange, from [ErrorCapturingResponse.decorate], because
 * `@RequestPart` and `ServerRequest.multipartData()` parse the exchange's original request, not
 * one a filter swaps in.
 */
internal class InboundParts private constructor(
    delegate: ServerHttpRequest,
    private val replay: Flux<DataBuffer>,
    /** The parts, as drawn; null when none could be read. */
    val parts: Map<String, Any>?,
) : ServerHttpRequestDecorator(delegate) {
    override fun getBody(): Flux<DataBuffer> = replay

    companion object {
        fun isMultipart(request: ServerHttpRequest): Boolean = guarded(false) { request.headers.contentType?.type == "multipart" }

        /** Ours, under whatever decorators came after it; null when the request was not wrapped. */
        fun of(request: ServerHttpRequest): InboundParts? {
            var current: ServerHttpRequest? = request
            while (current != null) {
                if (current is InboundParts) return current
                current = (current as? ServerHttpRequestDecorator)?.delegate
            }
            return null
        }

        /**
         * Reads the head of [request]'s body, then hands [serve] the request with its parts and the
         * whole body to read. A body the app never reads is released here, as far as it was read.
         */
        fun read(
            request: ServerHttpRequest,
            serve: (ServerHttpRequest) -> Mono<Void>,
        ): Mono<Void> {
            val contentType = request.headers.contentType.toString()
            return Flux
                .defer {
                    var seen = 0L
                    request.body.bufferUntil { buffer ->
                        seen += buffer.readableByteCount()
                        seen >= Bodies.LIMIT
                    }
                }.switchOnFirst(
                    { first, groups ->
                        val head = first.get().orEmpty()
                        val bytes = guarded(ByteArray(0)) { copy(head) }
                        val parts =
                            guarded(null) {
                                if (bytes.isEmpty()) null else Multipart.summary(bytes, contentType, truncated = bytes.size >= Bodies.LIMIT)
                            }
                        val replayed = AtomicBoolean()
                        val body = groups.doOnSubscribe { replayed.set(true) }.concatMapIterable { it }
                        serve(InboundParts(request, body, parts)).doFinally {
                            if (!replayed.get()) head.forEach { DataBufferUtils.release(it) }
                        }
                    },
                    false,
                ).then()
        }

        /** The bytes of [buffers], read without moving them, so the app still reads them all. */
        private fun copy(buffers: List<DataBuffer>): ByteArray {
            val out = java.io.ByteArrayOutputStream(buffers.sumOf { it.readableByteCount() })
            for (buffer in buffers) {
                buffer.readableByteBuffers().use { iterator ->
                    iterator.forEach { view ->
                        val chunk = ByteArray(view.remaining())
                        view.get(chunk)
                        out.write(chunk)
                    }
                }
            }
            return out.toByteArray()
        }
    }
}
