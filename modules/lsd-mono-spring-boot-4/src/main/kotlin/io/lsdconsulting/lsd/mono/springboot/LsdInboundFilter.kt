package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import jakarta.servlet.FilterChain
import jakarta.servlet.ReadListener
import jakarta.servlet.ServletInputStream
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.util.ContentCachingResponseWrapper
import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.InputStreamReader
import java.time.Instant

/**
 * Draws every request the app serves during a test: `Client → Orders: POST /orders`, and the
 * reply with its status and latency. Outside a test (no scenario running) it passes straight through.
 */
internal class LsdInboundFilter(
    private val names: ParticipantNames,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        val scenario = guarded(null) { SpringScenarios.resolve(request.getHeader(LsdHeaders.SCENARIO)) }
        if (scenario == null) {
            chain.doFilter(request, response)
            return
        }
        val cached = guarded(request) { CachedBodyRequest.of(request) }
        val wrapped = ContentCachingResponseWrapper(response)
        val id = SpringScenarios.newId()
        val caller = request.getHeader(SpringScenarios.CALLER_HEADER)?.takeIf { it.isNotBlank() } ?: names.client
        val started = Instant.now()
        val t0 = System.nanoTime()
        guarded(Unit) {
            val query = request.queryString?.let { "?$it" } ?: ""
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.REQUEST,
                    from = caller,
                    to = names.app,
                    label = "${request.method} ${request.requestURI}$query",
                    interactionId = id,
                    trace = Trace(scenario.correlationId, id, request.getHeader(PARENT_SPAN_HEADER)),
                    source = SpringScenarios.SOURCE,
                    startedAt = started,
                    data = (cached as? CachedBodyRequest)?.let { Bodies.read(it.body, request.contentType) },
                    headers = request.headerNames
                        .toList()
                        .filterNot(SpringScenarios::isOwnHeader)
                        .associateWith { request.getHeader(it) ?: "" },
                ),
            )
        }
        SpringScenarios.enter(scenario, id)
        var failure: Throwable? = null
        try {
            // On this thread, and on any pool its work is handed to, calls are this request's.
            SpringScenarios.within(SpringScenarios.Current(scenario, id)) { chain.doFilter(cached, wrapped) }
        } catch (e: Throwable) {
            failure = e
            throw e
        } finally {
            SpringScenarios.leave(scenario, id)
            guarded(Unit) {
                val status = if (failure != null && wrapped.status < 400) 500 else wrapped.status
                val body = wrapped.contentAsByteArray
                scenario.ingest(
                    Interaction(
                        kind = InteractionKind.RESPONSE,
                        from = names.app,
                        to = caller,
                        label = statusLabel(status),
                        status = status.toString(),
                        replyTo = id,
                        source = SpringScenarios.SOURCE,
                        durationMs = (System.nanoTime() - t0) / 1_000_000.0,
                        data = failure?.toString() ?: Bodies.read(body, wrapped.contentType),
                        headers = wrapped.headerNames.associateWith { wrapped.getHeader(it) ?: "" },
                    ),
                )
            }
            wrapped.copyBodyToResponse()
        }
    }

    internal companion object {
        /** Sent by our client interceptor, so a call into another instrumented app nests under its caller. */
        const val PARENT_SPAN_HEADER: String = "lsd-parent-span"
    }
}

/** The request with its (small) body read up front, so both the diagram and the app can read it. */
private class CachedBodyRequest(
    request: HttpServletRequest,
    val body: ByteArray,
) : HttpServletRequestWrapper(request) {
    override fun getInputStream(): ServletInputStream {
        val input = ByteArrayInputStream(body)
        return object : ServletInputStream() {
            override fun read(): Int = input.read()

            override fun read(
                b: ByteArray,
                off: Int,
                len: Int,
            ): Int = input.read(b, off, len)

            override fun isFinished(): Boolean = input.available() == 0

            override fun isReady(): Boolean = true

            override fun setReadListener(listener: ReadListener) {
                listener.onDataAvailable()
                listener.onAllDataRead()
            }
        }
    }

    override fun getReader(): BufferedReader =
        BufferedReader(InputStreamReader(inputStream, characterEncoding ?: Charsets.UTF_8.name()))

    companion object {
        fun of(request: HttpServletRequest): HttpServletRequest {
            val length = request.contentLengthLong
            if (length <= 0 || length > Bodies.LIMIT || request.contentType?.startsWith("multipart/") == true) return request
            return CachedBodyRequest(request, request.inputStream.readAllBytes())
        }
    }
}
