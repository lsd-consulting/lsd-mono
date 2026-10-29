package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.Interaction
import io.github.lsdconsulting.lsd.mono.jvm.InteractionKind
import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.Trace
import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import jakarta.servlet.AsyncEvent
import jakarta.servlet.AsyncListener
import jakarta.servlet.DispatcherType
import jakarta.servlet.FilterChain
import jakarta.servlet.ReadListener
import jakarta.servlet.ServletInputStream
import jakarta.servlet.ServletOutputStream
import jakarta.servlet.ServletRequest
import jakarta.servlet.ServletRequestEvent
import jakarta.servlet.ServletRequestListener
import jakarta.servlet.ServletRequestWrapper
import jakarta.servlet.WriteListener
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import jakarta.servlet.http.HttpServletResponseWrapper
import org.springframework.web.filter.OncePerRequestFilter
import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.InputStreamReader
import java.io.PrintWriter
import java.io.Writer
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Draws every request the app serves during a test: `Client → Orders: POST /orders`, and the
 * reply with its status and latency. Outside a test (no scenario running) it passes straight through.
 *
 * The response is written through to the client as the app writes it, with the first
 * [Bodies.LIMIT] bytes copied for the diagram, so a stream (SSE, a `ResponseBodyEmitter`) reaches
 * the client as it is sent and is drawn, once it ends, as a count of its events and the first few.
 * A request the app serves asynchronously is answered when it completes. A multipart request is
 * drawn as its parts (names, file names, types and sizes), read through the servlet's own part
 * parsing, never their contents.
 *
 * When the handler fails, by an exception or `sendError`, the reply is what the app's error page
 * (Spring Boot's `/error`) writes: the filter also sees that error dispatch, and draws the reply
 * once it is written.
 */
internal class LsdInboundFilter(
    private val names: ParticipantNames,
    private val readParts: Boolean = true,
) : OncePerRequestFilter() {
    override fun shouldNotFilterErrorDispatch(): Boolean = false

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        if (request.dispatcherType == DispatcherType.ERROR) {
            errorPage(request, response, chain)
            return
        }
        val scenario = guarded(null) { SpringScenarios.resolve(request.getHeader(LsdHeaders.SCENARIO)) }
        if (scenario == null) {
            chain.doFilter(request, response)
            return
        }
        val cached = guarded(request) { CachedBodyRequest.of(request) }
        val tee = TeeResponse(response)
        val id = SpringScenarios.newId()
        val caller = request.getHeader(SpringScenarios.CALLER_HEADER)?.takeIf { it.isNotBlank() } ?: names.client
        val started = Instant.now()
        val t0 = System.nanoTime()
        guarded(Unit) {
            val query = request.queryString?.let { "?$it" } ?: ""
            scenario.ingest(
                Interaction
                    .builder(InteractionKind.REQUEST, caller, names.app, "${request.method} ${request.requestURI}$query")
                    .interactionId(id)
                    .trace(Trace(scenario.correlationId, id, request.getHeader(PARENT_SPAN_HEADER)))
                    .source(SpringScenarios.SOURCE)
                    .startedAt(started)
                    .data((cached as? CachedBodyRequest)?.let { Bodies.read(it.body, request.contentType) } ?: parts(request))
                    .headers(
                        request.headerNames
                            .toList()
                            .filterNot(SpringScenarios::isOwnHeader)
                            .associateWith { request.getHeader(it) ?: "" },
                    ).build(),
            )
        }
        val reply = Reply(scenario, id, caller, t0, tee)
        SpringScenarios.enter(scenario, id)
        var failure: Throwable? = null
        try {
            // On this thread, and on any pool its work is handed to, calls are this request's.
            SpringScenarios.within(SpringScenarios.Current(scenario, id)) { chain.doFilter(cached, tee) }
        } catch (e: Throwable) {
            failure = e
            throw e
        } finally {
            SpringScenarios.leave(scenario, id)
            guarded(Unit) { finish(request, reply, failure) }
        }
    }

    /** Draws the reply now, or says when it will be: once an async request completes, or once the error page is written. */
    private fun finish(
        request: HttpServletRequest,
        reply: Reply,
        failure: Throwable?,
    ) {
        val tee = reply.tee
        if (failure == null && request.isAsyncStarted) {
            request.asyncContext.addListener(reply)
            return
        }
        // After a sendError the container reports the response committed, but its error page is still to come.
        val toErrorPage = tee.errorSent || (failure != null && !tee.isCommitted)
        if (toErrorPage && !Mock.isMock(request)) {
            // The container sends the request to the error page next; the reply is drawn from there.
            reply.failure = failure
            request.setAttribute(PENDING_REPLY, reply)
            return
        }
        reply.draw(failure)
    }

    /** The error page for a request whose handler failed: its reply is drawn once the page is written. */
    private fun errorPage(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        val pending = request.getAttribute(PENDING_REPLY) as? Reply
        if (pending == null) {
            chain.doFilter(request, response)
            return
        }
        request.removeAttribute(PENDING_REPLY)
        val tee = guarded<HttpServletResponse>(response) { TeeResponse(response) }
        try {
            chain.doFilter(request, tee)
        } finally {
            guarded(Unit) { if (tee is TeeResponse) pending.draw(null, tee) else pending.draw(pending.failure) }
        }
    }

    /** The parts of a multipart request, through the servlet's own parsing (which the app's then reuses). */
    private fun parts(request: HttpServletRequest): Any? {
        if (!readParts || request.contentType?.let(Streams::isMultipart) != true) return null
        return guarded(null) {
            val parts = request.parts.map { Streams.part(it.name, it.submittedFileName, it.contentType, it.size) }
            Streams.parts(parts, truncated = false)
        }
    }

    /** One request's reply: drawn once, from wherever the request ends. */
    private inner class Reply(
        val scenario: LsdScenario,
        val id: String,
        val caller: String,
        val t0: Long,
        val tee: TeeResponse,
    ) : AsyncListener {
        private val drawn = AtomicBoolean()

        @Volatile var failure: Throwable? = null

        @Volatile private var asyncFailure: Throwable? = null

        fun draw(
            failure: Throwable?,
            written: TeeResponse = tee,
        ) {
            if (!drawn.compareAndSet(false, true)) return
            guarded(Unit) {
                val status = if (failure != null && written.status < 400) 500 else written.status
                scenario.ingest(
                    Interaction
                        .builder(InteractionKind.RESPONSE, names.app, caller, statusLabel(status))
                        .status(status.toString())
                        .replyTo(id)
                        .source(SpringScenarios.SOURCE)
                        .durationMs((System.nanoTime() - t0) / 1_000_000.0)
                        .data(failure?.toString() ?: written.body())
                        .headers(written.headerNames.associateWith { written.getHeader(it) ?: "" })
                        .build(),
                )
            }
        }

        override fun onComplete(event: AsyncEvent) = draw(asyncFailure)

        override fun onTimeout(event: AsyncEvent) = Unit

        override fun onError(event: AsyncEvent) {
            asyncFailure = event.throwable
        }

        override fun onStartAsync(event: AsyncEvent) {
            event.asyncContext.addListener(this)
        }
    }

    /**
     * Draws a reply that was waiting for an error page the container never rendered (one with no
     * error page at all), as the request ends.
     */
    internal class PendingReplies : ServletRequestListener {
        override fun requestDestroyed(event: ServletRequestEvent) {
            guarded(Unit) { (event.servletRequest.getAttribute(PENDING_REPLY) as? Reply)?.let { it.draw(it.failure) } }
        }
    }

    internal companion object {
        /** Sent by our client interceptor, so a call into another instrumented app nests under its caller. */
        const val PARENT_SPAN_HEADER: String = LsdHeaders.PARENT_SPAN

        /** A failed request's reply, waiting for the error page. */
        val PENDING_REPLY: String = LsdInboundFilter::class.java.name + ".pendingReply"
    }
}

/** MockMvc runs no error page and no request listeners: what the handler left is the reply. */
private object Mock {
    fun isMock(request: ServletRequest): Boolean {
        var current: ServletRequest? = request
        while (current != null) {
            if (current.javaClass.name.startsWith("org.springframework.mock.web.")) return true
            current = (current as? ServletRequestWrapper)?.request
        }
        return false
    }
}

/**
 * The response, written through to the client as the app writes it, with the first [Bodies.LIMIT]
 * bytes copied (an event stream is only counted, with its first few events). It notes a
 * `sendError`, so the reply can wait for the error page.
 */
internal class TeeResponse(
    response: HttpServletResponse,
) : HttpServletResponseWrapper(response) {
    private val head = java.io.ByteArrayOutputStream()
    private var overflowed = false
    private val sse = SseTap()
    private var stream: ServletOutputStream? = null
    private var writer: PrintWriter? = null

    @Volatile var errorSent: Boolean = false
        private set

    private val streaming: Boolean get() = Streams.isEventStream(contentType)

    /** The body as it should be drawn. */
    fun body(): Any? {
        if (streaming) return sse.summary()
        val bytes = synchronized(head) { head.toByteArray() }
        return if (overflowed) Bodies.head(bytes, contentType) else Bodies.read(bytes, contentType)
    }

    private fun copy(
        bytes: ByteArray,
        offset: Int,
        length: Int,
    ) = guarded(Unit) {
        if (streaming) {
            sse.copy(bytes, offset, length)
            return@guarded
        }
        synchronized(head) {
            val take = minOf(length, Bodies.LIMIT - head.size())
            if (take > 0) head.write(bytes, offset, take)
            if (take < length) overflowed = true
        }
    }

    override fun getOutputStream(): ServletOutputStream {
        stream?.let { return it }
        val delegate = super.getOutputStream()
        return object : ServletOutputStream() {
            override fun write(b: Int) {
                delegate.write(b)
                copy(byteArrayOf(b.toByte()), 0, 1)
            }

            override fun write(
                b: ByteArray,
                off: Int,
                len: Int,
            ) {
                delegate.write(b, off, len)
                copy(b, off, len)
            }

            override fun flush() = delegate.flush()

            override fun close() = delegate.close()

            override fun isReady(): Boolean = delegate.isReady

            override fun setWriteListener(listener: WriteListener) = delegate.setWriteListener(listener)
        }.also { stream = it }
    }

    override fun getWriter(): PrintWriter {
        writer?.let { return it }
        // The container's own writer buffers, encodes and flushes; what it is given is copied as it goes.
        val delegate = super.getWriter()
        val tee =
            object : Writer() {
                override fun write(
                    cbuf: CharArray,
                    off: Int,
                    len: Int,
                ) {
                    delegate.write(cbuf, off, len)
                    guarded(Unit) {
                        val bytes = String(cbuf, off, len).toByteArray(charset(characterEncoding ?: Charsets.ISO_8859_1.name()))
                        copy(bytes, 0, bytes.size)
                    }
                }

                override fun flush() = delegate.flush()

                override fun close() = delegate.close()
            }
        return PrintWriter(tee).also { writer = it }
    }

    override fun sendError(
        sc: Int,
        msg: String?,
    ) {
        super.sendError(sc, msg)
        errorSent = true
    }

    override fun sendError(sc: Int) {
        super.sendError(sc)
        errorSent = true
    }

    override fun resetBuffer() {
        super.resetBuffer()
        synchronized(head) {
            head.reset()
            overflowed = false
        }
    }

    override fun reset() {
        super.reset()
        synchronized(head) {
            head.reset()
            overflowed = false
        }
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
