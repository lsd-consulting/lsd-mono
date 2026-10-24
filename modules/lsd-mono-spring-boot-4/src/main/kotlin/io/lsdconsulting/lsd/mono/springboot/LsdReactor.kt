package io.lsdconsulting.lsd.mono.springboot

import org.springframework.core.io.buffer.DataBuffer
import reactor.util.context.ContextView
import java.io.ByteArrayOutputStream

/**
 * A reactive request hops threads (Netty event loop, `publishOn`, `subscribeOn`, a timer), so the
 * thread-bound scenario core keeps is not there when its calls go out. The inbound [LsdWebFilter]
 * writes the request it is serving into Reactor's context instead, and [LsdExchangeFilter] reads it
 * back on whichever thread the call is subscribed: the call joins the right scenario, under the
 * right request, even with several scenarios running at once. With Micrometer context-propagation
 * on the classpath, [LsdContextPropagation] also restores it onto each thread the chain hops to,
 * so a repository call or Kafka send made there (which cannot see Reactor's context) finds it too.
 */
internal object LsdReactor {
    /** The key the request being served is kept under, in Reactor's context and for context-propagation. */
    val KEY: String = SpringScenarios.Current::class.java.name

    fun write(
        context: reactor.util.context.Context,
        serving: SpringScenarios.Current,
    ): reactor.util.context.Context = context.put(KEY, serving)

    fun read(context: ContextView): SpringScenarios.Current? =
        context.getOrDefault<SpringScenarios.Current>(KEY, null)?.takeIf { SpringScenarios.isRunning(it.scenario) }
}

/**
 * Copies what passes through a body stream, up to [Bodies.LIMIT], without moving the stream's
 * read position: the app (or the server) still gets every byte. Past the limit it keeps nothing.
 */
internal class BodyTap {
    private val out = ByteArrayOutputStream()

    @Volatile var overflowed: Boolean = false
        private set

    fun copy(buffer: DataBuffer) {
        if (overflowed) return
        SpringScenarios.guarded(Unit) {
            val count = buffer.readableByteCount()
            if (out.size() + count > Bodies.LIMIT) {
                overflowed = true
                out.reset()
                return@guarded
            }
            buffer.readableByteBuffers().use { buffers ->
                for (bytes in buffers) {
                    val chunk = ByteArray(bytes.remaining())
                    bytes.get(chunk)
                    synchronized(out) { out.write(chunk) }
                }
            }
        }
    }

    /** What was copied, or null when the body was too large to keep. */
    fun bytes(): ByteArray? = if (overflowed) null else synchronized(out) { out.toByteArray() }
}
